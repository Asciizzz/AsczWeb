import {
    Buffer,
    BufferPool,
    Texture,
    Sampler,
    BindTable,
    BindTableCache,
    SlotFrequency,
    type BindingEntry,
} from "@asciiz/atoolkit/awgpu";
import type { Actor } from "../actor.js";
import type { ShaderParams } from "../types.js";
import type { Camera } from "../camera.js";
import { MeshWGPU } from "./mesh.js";
import { ShaderWGPU } from "./shader.js";
import { TextureWGPU } from "./texture.js";

/**
 * Execution target containing render pass and camera.
 */
export interface RenderTarget {
    pass: GPURenderPassEncoder;
    camera: Camera;
    device?: GPUDevice;
}

/**
 * Render options combining render target and iterable Actors.
 */
export interface RenderOptions extends RenderTarget {
    actors?: Iterable<Actor>;
}

/**
 * Options for drawing a single mesh directly with a specified shader.
 */
export interface DrawMeshOptions extends RenderTarget {
    mesh: MeshWGPU;
    shader: ShaderWGPU;
    /** Model world matrix (16 floats). If omitted, identity is used. */
    worldMatrix?: ArrayLike<number>;
    /** Normal matrix (16 floats). If omitted, worldMatrix or identity is used. */
    normalMatrix?: ArrayLike<number>;
    /** Material parameters overriding shader defaults. */
    params?: ShaderParams;
    /** Specific submesh index to draw. If omitted, draws all submeshes. */
    submeshIndex?: number;
}

export interface MeshRendererOptions {
    device?: GPUDevice;
    uniformPool?: BufferPool;
}

const BUFFER_USAGE_UNIFORM_COPY_DST =
    typeof GPUBufferUsage !== "undefined"
        ? GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        : 0x0040 | 0x0008; // 72

const IDENTITY_MAT4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

/**
 * Submesh draw dispatcher operating within caller-provided render passes.
 * Uses a three-frequency WebGPU bind group layout:
 * - Slot 0 (PerFrame): Camera projection uniforms.
 * - Slot 1 (PerBatch): Material parameters, textures, and samplers.
 * - Slot 2 (PerInstance): Dynamic transform uniforms with 256-byte offsets.
 */
export class MeshRendererWGPU {
    device?: GPUDevice;
    readonly uniformPool: BufferPool;
    readonly bindTableCache: BindTableCache;

    // Camera uniform buffer and cached bind tables
    private _cameraBuffer?: Buffer;
    private _lastCameraData = new Float32Array(52);
    private _cameraInitialized = false;

    // Dynamic transform uniform buffer & CPU staging array (aligned to 256 bytes = 64 floats per instance)
    private _transformBuffer?: Buffer;
    private _transformStaging = new Float32Array(1024 * 64);

    // Fallback assets
    private _fallbackTexture?: TextureWGPU;
    private _fallbackSampler?: GPUSampler;

    constructor(deviceOrOptions?: GPUDevice | BufferPool | MeshRendererOptions) {
        this.bindTableCache = new BindTableCache();

        if (!deviceOrOptions) {
            this.uniformPool = new BufferPool(
                BUFFER_USAGE_UNIFORM_COPY_DST,
                "WeebGfx_MeshRenderer_UniformPool"
            );
        } else if ("queue" in deviceOrOptions) {
            this.device = deviceOrOptions as GPUDevice;
            this.uniformPool = new BufferPool(
                BUFFER_USAGE_UNIFORM_COPY_DST,
                "WeebGfx_MeshRenderer_UniformPool"
            );
        } else if ("acquire" in deviceOrOptions) {
            this.uniformPool = deviceOrOptions as BufferPool;
        } else {
            const opts = deviceOrOptions as MeshRendererOptions;
            this.device = opts.device;
            this.uniformPool = opts.uniformPool ?? new BufferPool(
                BUFFER_USAGE_UNIFORM_COPY_DST,
                "WeebGfx_MeshRenderer_UniformPool"
            );
        }
    }

    /**
     * Resets uniform buffer pool allocations at start of frame.
     */
    reset(): void {
        this.uniformPool.reset();
    }

    /**
     * Draws single Actor inside render pass.
     */
    draw(target: RenderTarget, actor: Actor): void {
        this.render(target, [actor]);
    }

    /**
     * Executes draw calls across iterable of Actors inside render pass.
     */
    render(
        targetOrOptions: RenderOptions | RenderTarget,
        actorsArg?: Iterable<Actor>
    ): void {
        const target = targetOrOptions as RenderTarget;
        const options = targetOrOptions as RenderOptions;

        const pass = target.pass;
        const defaultCamera = target.camera;
        const device = target.device ?? this.device;

        if (!pass) {
            throw new Error(
                "[MeshRendererWGPU] Render pass was not provided. Pass valid GPURenderPassEncoder in options: { pass, ... }."
            );
        }
        if (!defaultCamera) {
            throw new Error(
                "[MeshRendererWGPU] Camera was not provided. Pass valid Camera instance in options: { camera, ... }."
            );
        }
        if (!device) {
            throw new Error(
                "[MeshRendererWGPU] GPUDevice was not provided. Pass device to new RendererWGPU(device) or in render options: { device, ... }."
            );
        }

        const actors = actorsArg ?? options.actors;
        if (!actors) return;

        // 1. Collect active actors and filter valid hardware meshes
        const activeActors: Actor[] = [];
        let count = 0;

        for (const actor of actors) {
            if (!(actor.mesh instanceof MeshWGPU)) continue;
            if (actor.shaders.length === 0) continue;

            activeActors.push(actor);
            count++;
        }

        if (count === 0) return;

        // Ensure transform staging and GPU buffer capacity (256 bytes = 64 floats per instance)
        const requiredFloats = count * 64;
        if (this._transformStaging.length < requiredFloats) {
            this._transformStaging = new Float32Array(Math.max(requiredFloats, this._transformStaging.length * 2));
        }

        const requiredBytes = count * 256;
        if (!this._transformBuffer || this._transformBuffer.size < requiredBytes) {
            this._transformBuffer?.destroy();
            const allocSize = Math.max(requiredBytes, 65536);
            this._transformBuffer = Buffer.createUniform(device, allocSize, "MeshRenderer_TransformBuffer");
        }

        // Write model and normal matrices into staging array
        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const floatOffset = i * 64;

            this._transformStaging.set(actor.transform, floatOffset);
            if (actor.normalMatrix) {
                this._transformStaging.set(actor.normalMatrix, floatOffset + 16);
            } else {
                this._transformStaging.set(actor.transform, floatOffset + 16);
            }
        }

        // Upload transforms in one batch
        this._transformBuffer.write(device, this._transformStaging.subarray(0, requiredFloats), 0);

        // 2. Render loop with state filtering and per-Actor camera override
        let lastBoundPipeline: GPURenderPipeline | undefined;
        let lastBoundMesh: MeshWGPU | undefined;
        let lastBoundMaterial: BindTable | undefined;
        let lastBoundCameraTable: BindTable | undefined;
        let currentBoundCamera: Camera | undefined;

        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const mesh = actor.mesh as MeshWGPU;
            const submeshes = mesh.submeshes;
            const dynamicOffset = i * 256;
            const instanceCount = actor.instanceCount > 0 ? actor.instanceCount : 1;
            const effectiveCamera = actor.camera ?? defaultCamera;

            // Camera update (Slot 0): check if camera changed
            if (currentBoundCamera !== effectiveCamera) {
                this._updateCameraBuffer(device, effectiveCamera);
                currentBoundCamera = effectiveCamera;
                lastBoundCameraTable = undefined; // Force camera bind table re-evaluation
            }

            // Bind vertex and index buffers once per mesh
            if (lastBoundMesh !== mesh) {
                pass.setVertexBuffer(0, mesh.vertexBuffer.native);
                if (mesh.indexBuffer) {
                    const indexFormat = mesh.cpu.indexBytes instanceof Uint32Array ? "uint32" : "uint16";
                    pass.setIndexBuffer(mesh.indexBuffer.native, indexFormat);
                }
                lastBoundMesh = mesh;
            }

            // Iterate submeshes
            for (let s = 0; s < submeshes.length; s++) {
                const shader = actor.shaders[s] ?? actor.shaders[0];
                if (!shader || !(shader instanceof ShaderWGPU)) continue;

                const submesh = submeshes[s];

                // Set pipeline
                if (lastBoundPipeline !== shader.pipeline.native) {
                    pass.setPipeline(shader.pipeline.native);
                    lastBoundPipeline = shader.pipeline.native;
                }

                // Check layout architecture: 3-group vs combined 2-group
                const isLegacyLayout = shader.meta.entityGroupIndex === shader.meta.cameraGroupIndex;

                if (isLegacyLayout) {
                    // Combined Group 0: Entity and Camera
                    const legacyGroup0 = this._createLegacyGroup0(
                        device,
                        shader,
                        effectiveCamera,
                        actor.transform,
                        actor.normalMatrix
                    );
                    if (legacyGroup0) pass.setBindGroup(0, legacyGroup0);
                } else {
                    // Slot 0: Camera (PerFrame)
                    if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                        const cameraTable = this._getCameraBindTable(device, shader);
                        if (cameraTable && lastBoundCameraTable !== cameraTable) {
                            pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                            lastBoundCameraTable = cameraTable;
                        }
                    }

                    // Slot 2: Entity Transform (PerInstance dynamic offset)
                    if (shader.meta.hasEntityTransform && shader.bindGroupLayouts.length > 2) {
                        const entityTable = this._getEntityBindTable(device, shader);
                        if (entityTable) {
                            pass.setBindGroup(
                                shader.meta.entityGroupIndex ?? 2,
                                entityTable.native,
                                [dynamicOffset]
                            );
                        }
                    }
                }

                // Slot 1: Material Parameters (PerBatch)
                const materialGroupIdx = shader.meta.materialGroupIndex ?? 1;
                if (shader.bindGroupLayouts.length > materialGroupIdx) {
                    const actorParams = actor.params[s] ?? actor.params[0];
                    const mergedParams: ShaderParams = {
                        floats: {
                            ...shader.defaultParams.floats,
                            ...actorParams?.floats,
                        },
                        vectors: {
                            ...shader.defaultParams.vectors,
                            ...actorParams?.vectors,
                        },
                        textures: {
                            ...shader.defaultParams.textures,
                            ...actorParams?.textures,
                        },
                        samplers: {
                            ...shader.defaultParams.samplers,
                            ...actorParams?.samplers,
                        },
                    };

                    const materialTable = this._getMaterialBindTable(device, shader, mergedParams);
                    if (materialTable && lastBoundMaterial !== materialTable) {
                        pass.setBindGroup(materialGroupIdx, materialTable.native);
                        lastBoundMaterial = materialTable;
                    }
                }

                // Issue Draw Call
                if (mesh.indexBuffer) {
                    pass.drawIndexed(
                        submesh.indexCount,
                        instanceCount,
                        submesh.firstIndex,
                        submesh.baseVertex ?? 0,
                        0
                    );
                } else {
                    pass.draw(submesh.indexCount, instanceCount, submesh.firstIndex, 0);
                }
            }
        }
    }

    /**
     * Draws single mesh with shader inside render pass.
     */
    drawMesh(options: DrawMeshOptions): void {
        const pass = options.pass;
        const camera = options.camera;
        const device = options.device ?? this.device;
        const mesh = options.mesh;
        const shader = options.shader;

        if (!pass) throw new Error("[MeshRendererWGPU.drawMesh] Render pass was not provided.");
        if (!camera) throw new Error("[MeshRendererWGPU.drawMesh] Camera was not provided.");
        if (!device) throw new Error("[MeshRendererWGPU.drawMesh] GPUDevice was not provided.");
        if (!mesh) throw new Error("[MeshRendererWGPU.drawMesh] Mesh was not provided.");
        if (!shader) throw new Error("[MeshRendererWGPU.drawMesh] Shader was not provided.");

        // Bind vertex and index buffers
        pass.setVertexBuffer(0, mesh.vertexBuffer.native);
        if (mesh.indexBuffer) {
            const indexFormat = mesh.cpu.indexBytes instanceof Uint32Array ? "uint32" : "uint16";
            pass.setIndexBuffer(mesh.indexBuffer.native, indexFormat);
        }

        pass.setPipeline(shader.pipeline.native);

        const isLegacyLayout = shader.meta.entityGroupIndex === shader.meta.cameraGroupIndex;

        if (isLegacyLayout) {
            const legacyGroup0 = this._createLegacyGroup0(
                device,
                shader,
                camera,
                options.worldMatrix,
                options.normalMatrix
            );
            if (legacyGroup0) pass.setBindGroup(0, legacyGroup0);
        } else {
            // Camera (Slot 0)
            this._updateCameraBuffer(device, camera);
            if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                const cameraTable = this._getCameraBindTable(device, shader);
                if (cameraTable) {
                    pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                }
            }

            // Entity Transform (Slot 2)
            if (shader.meta.hasEntityTransform && shader.bindGroupLayouts.length > 2) {
                if (!this._transformBuffer || this._transformBuffer.size < 256) {
                    this._transformBuffer?.destroy();
                    this._transformBuffer = Buffer.createUniform(device, 65536, "MeshRenderer_TransformBuffer");
                }

                const world = (options.worldMatrix as Float32Array) ?? IDENTITY_MAT4;
                const normal = (options.normalMatrix as Float32Array) ?? world;
                this._transformStaging.set(world, 0);
                this._transformStaging.set(normal, 16);
                this._transformBuffer.write(device, this._transformStaging.subarray(0, 32), 0);

                const entityTable = this._getEntityBindTable(device, shader);
                if (entityTable) {
                    pass.setBindGroup(shader.meta.entityGroupIndex ?? 2, entityTable.native, [0]);
                }
            }
        }

        // Material Parameters (Slot 1)
        const materialGroupIdx = shader.meta.materialGroupIndex ?? 1;
        if (shader.bindGroupLayouts.length > materialGroupIdx) {
            const mergedParams: ShaderParams = {
                floats: { ...shader.defaultParams.floats, ...options.params?.floats },
                vectors: { ...shader.defaultParams.vectors, ...options.params?.vectors },
                textures: { ...shader.defaultParams.textures, ...options.params?.textures },
                samplers: { ...shader.defaultParams.samplers, ...options.params?.samplers },
            };
            const materialTable = this._getMaterialBindTable(device, shader, mergedParams);
            if (materialTable) {
                pass.setBindGroup(materialGroupIdx, materialTable.native);
            }
        }

        // Submesh drawing
        const submeshes = options.submeshIndex !== undefined
            ? [mesh.submeshes[options.submeshIndex]]
            : mesh.submeshes;

        for (const submesh of submeshes) {
            if (!submesh) continue;
            if (mesh.indexBuffer) {
                pass.drawIndexed(
                    submesh.indexCount,
                    1,
                    submesh.firstIndex,
                    submesh.baseVertex ?? 0,
                    0
                );
            } else {
                pass.draw(submesh.indexCount, 1, submesh.firstIndex, 0);
            }
        }
    }

    private _updateCameraBuffer(device: GPUDevice, camera: Camera): void {
        if (!this._cameraBuffer) {
            this._cameraBuffer = Buffer.createUniform(device, 256, "MeshRenderer_CameraBuffer");
        }

        const data = camera.getUniformData();
        let changed = !this._cameraInitialized;
        if (!changed) {
            for (let i = 0; i < 52; i++) {
                if (data[i] !== this._lastCameraData[i]) {
                    changed = true;
                    break;
                }
            }
        }

        if (changed) {
            this._cameraBuffer.write(device, data, 0);
            this._lastCameraData.set(data);
            this._cameraInitialized = true;
        }
    }

    private _getCameraBindTable(device: GPUDevice, shader: ShaderWGPU): BindTable | null {
        const layout = shader.bindGroupLayouts[shader.meta.cameraGroupIndex ?? 0];
        if (!layout || !this._cameraBuffer) return null;

        const entries: BindingEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this._cameraBuffer.native,
                    offset: 0,
                    size: 208,
                },
            },
        ];

        return this.bindTableCache.getOrCreate(device, layout, entries, {
            slot: SlotFrequency.PerFrame,
            label: "Camera_BindTable",
        });
    }

    private _getEntityBindTable(device: GPUDevice, shader: ShaderWGPU): BindTable | null {
        const entityGroupIdx = shader.meta.entityGroupIndex ?? 2;
        const layout = shader.bindGroupLayouts[entityGroupIdx];
        if (!layout || !this._transformBuffer) return null;

        const entries: BindingEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this._transformBuffer.native,
                    offset: 0,
                    size: 128,
                },
            },
        ];

        return this.bindTableCache.getOrCreate(device, layout, entries, {
            slot: SlotFrequency.PerInstance,
            label: "EntityTransform_BindTable",
        });
    }

    private _getMaterialBindTable(
        device: GPUDevice,
        shader: ShaderWGPU,
        params: ShaderParams
    ): BindTable | null {
        const materialGroupIdx = shader.meta.materialGroupIndex ?? 1;
        const layout = shader.bindGroupLayouts[materialGroupIdx];
        if (!layout) return null;

        const entries: BindingEntry[] = [];
        let bindingIndex = 0;
        const bindings = shader.paramBindings;

        if (bindings) {
            // 1. Material Uniform Buffer
            if (bindings.hasMaterialUniform) {
                const numFloats = bindings.floats.length;
                const numVecs = bindings.vectors.length;
                const totalFloats = numFloats + numVecs * 4;
                const byteSize = Math.max(16, Math.ceil((totalFloats * 4) / 16) * 16);
                const paramBuf = this.uniformPool.acquire(device, byteSize);
                const data = new Float32Array(byteSize / 4);

                let offset = 0;
                for (const f of bindings.floats) {
                    data[offset++] = params.floats?.[f] ?? (shader.defaultParams.floats?.[f] ?? 0.0);
                }
                for (const v of bindings.vectors) {
                    const val = params.vectors?.[v] ?? (shader.defaultParams.vectors?.[v] ?? [0, 0, 0, 0]);
                    data.set(val, offset);
                    offset += 4;
                }
                paramBuf.write(device, data);

                entries.push({
                    binding: bindingIndex++,
                    resource: { buffer: paramBuf.native, offset: 0, size: byteSize },
                });
            }

            // 2. Texture Parameters
            for (const texName of bindings.textures) {
                const rawTex = params.textures?.[texName] ?? (params.textures ? Object.values(params.textures)[0] : undefined);
                let texView: GPUTextureView;
                if (rawTex instanceof TextureWGPU) {
                    texView = rawTex.view;
                } else {
                    if (!this._fallbackTexture) {
                        this._fallbackTexture = TextureWGPU.create1x1(device, 255, 255, 255, 255);
                    }
                    texView = this._fallbackTexture.view;
                }
                entries.push({
                    binding: bindingIndex++,
                    resource: texView,
                });
            }

            // 3. Sampler Parameters
            for (const smpName of bindings.samplers) {
                let sampler: GPUSampler | undefined = params.samplers?.[smpName];
                if (!sampler && params.textures) {
                    const matchingTex = params.textures[smpName] ?? Object.values(params.textures)[0];
                    if (matchingTex instanceof TextureWGPU) {
                        sampler = matchingTex.sampler;
                    }
                }
                if (!sampler) {
                    if (!this._fallbackSampler) {
                        this._fallbackSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
                    }
                    sampler = this._fallbackSampler;
                }
                entries.push({
                    binding: bindingIndex++,
                    resource: sampler,
                });
            }
        }

        return this.bindTableCache.getOrCreate(device, layout, entries, {
            slot: SlotFrequency.PerBatch,
            label: "Material_BindTable",
        });
    }

    /**
     * Fallback creation for combined 2-group shaders binding transform and camera in Group 0.
     */
    private _createLegacyGroup0(
        device: GPUDevice,
        shader: ShaderWGPU,
        camera: Camera,
        worldMatrix?: Float32Array | ArrayLike<number>,
        normalMatrixOverride?: Float32Array | ArrayLike<number>
    ): GPUBindGroup | null {
        const layout = shader.bindGroupLayouts[0];
        if (!layout) return null;

        const entries: GPUBindGroupEntry[] = [];
        let bindingIndex = 0;

        // Model & Normal matrices (128 bytes total: 2 x 64 bytes)
        const entityBytes = 128;
        const entityBuf = this.uniformPool.acquire(device, entityBytes);
        const entityData = new Float32Array(32);

        if (worldMatrix) {
            entityData.set(worldMatrix as ArrayLike<number>, 0);
            if (normalMatrixOverride) {
                entityData.set(normalMatrixOverride as ArrayLike<number>, 16);
            } else {
                entityData.set(worldMatrix as ArrayLike<number>, 16);
            }
        } else {
            entityData.set(IDENTITY_MAT4, 0);
            entityData.set(IDENTITY_MAT4, 16);
        }
        entityBuf.write(device, entityData);

        entries.push({
            binding: bindingIndex++,
            resource: { buffer: entityBuf.native, offset: 0, size: entityBytes },
        });

        // Camera Uniforms (208 bytes)
        const cameraBytes = 208;
        const cameraBuf = this.uniformPool.acquire(device, cameraBytes);
        cameraBuf.write(device, camera.getUniformData());
        entries.push({
            binding: bindingIndex++,
            resource: { buffer: cameraBuf.native, offset: 0, size: cameraBytes },
        });

        return device.createBindGroup({
            label: "WeebGfx_Combined_Group0",
            layout,
            entries,
        });
    }

    destroy(): void {
        this._cameraBuffer?.destroy();
        this._transformBuffer?.destroy();
        this._fallbackTexture?.destroy();
        this.uniformPool.destroy();
        this.bindTableCache.clear();
    }
}

export {
    MeshRendererWGPU as RendererWGPU,
};
