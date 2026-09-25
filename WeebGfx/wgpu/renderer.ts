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
import type { MeshCmp, ShaderCmp, TransformCmp, SkinCmp } from "../components.js";
import type { ShaderParams } from "../types.js";
import type { Camera } from "../camera.js";
import { MeshWGPU } from "./mesh.js";
import { ShaderWGPU } from "./shader.js";
import { TextureWGPU } from "./texture.js";

export interface ComponentQuerySource<T> {
    get(entity: number): T | undefined;
    readonly entities?: readonly number[];
}

/**
 * Execution target containing the external render pass and camera.
 */
export interface RenderTarget {
    pass: GPURenderPassEncoder;
    camera: Camera;
    device?: GPUDevice;
}

/**
 * Scene component sources and optional entity filter.
 */
export interface RenderScene {
    /** Component set or query source for MeshCmp. */
    meshes: ComponentQuerySource<MeshCmp>;
    /** Component set or query source for ShaderCmp. */
    shaders: ComponentQuerySource<ShaderCmp>;
    /** Optional component set or query source for TransformCmp. */
    transforms?: ComponentQuerySource<TransformCmp>;
    /** Optional component set or query source for SkinCmp. */
    skins?: ComponentQuerySource<SkinCmp>;
    /**
     * Optional iterable of entity IDs to draw.
     * If omitted, automatically derived from meshes if it exposes an `entities` array.
     */
    entities?: Iterable<number>;
}

/**
 * Unified render options combining render target and scene context.
 */
export interface RenderOptions extends RenderTarget {
    /** Optional nested scene context, or specify meshes/shaders/transforms directly on this options object. */
    scene?: RenderScene;

    // Direct scene properties for convenience:
    meshes?: ComponentQuerySource<MeshCmp>;
    shaders?: ComponentQuerySource<ShaderCmp>;
    transforms?: ComponentQuerySource<TransformCmp>;
    skins?: ComponentQuerySource<SkinCmp>;
    entities?: Iterable<number>;
}

/**
 * Options for directly drawing a single mesh with a shader (zero ECS required).
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
 * WebGPU hardware mesh drawing operator powered by @asciiz/atoolkit/awgpu.
 * Does NOT own the GPU backend, canvas context, or render pass lifecycle.
 * Operates purely as a submesh drawing operator inside a caller-orchestrated render pass.
 *
 * Implements a frequency-slotted WebGPU binding model:
 *   Slot 0 (PerFrame): Camera uniforms (bound once per pass/camera)
 *   Slot 1 (PerBatch): Material parameters, textures, samplers (cached via BindTableCache)
 *   Slot 2 (PerInstance): Entity transforms with 256-byte aligned dynamic offsets
 */
export class MeshRendererWGPU {
    device?: GPUDevice;
    readonly uniformPool: BufferPool;
    readonly bindTableCache: BindTableCache;

    // Camera uniform buffer and cached bind tables
    private _cameraBuffer?: Buffer;
    private _lastCameraData = new Float32Array(52);
    private _cameraInitialized = false;

    // Entity dynamic uniform buffer & CPU staging array (aligned to 256 bytes = 64 floats per entity)
    private _transformBuffer?: Buffer;
    private _transformStaging = new Float32Array(1024 * 64);
    private _transformBindTable?: BindTable;

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
     * Resets internal uniform buffer pool allocations and staging offsets at the beginning of a frame.
     */
    reset(): void {
        this.uniformPool.reset();
    }

    /**
     * Executes render pass across active entities using an external render pass and Camera.
     */
    render(
        targetOrOptions: RenderOptions | RenderTarget,
        sceneArg?: RenderScene
    ): void {
        const isTwoArgs = sceneArg !== undefined;
        const target = targetOrOptions as RenderTarget;
        const options = targetOrOptions as RenderOptions;

        const pass = target.pass;
        const camera = target.camera;
        const device = target.device ?? this.device;

        if (!pass) {
            throw new Error(
                "[MeshRendererWGPU] Render pass was not provided! Pass a valid GPURenderPassEncoder in options: { pass, ... }."
            );
        }
        if (!camera) {
            throw new Error(
                "[MeshRendererWGPU] Camera was not provided! Pass a valid Camera instance in options: { camera, ... }."
            );
        }
        if (!device) {
            throw new Error(
                "[MeshRendererWGPU] GPUDevice was not provided! Pass device to new RendererWGPU(device) or in render options: { device, ... }."
            );
        }

        const scene = isTwoArgs ? sceneArg! : (options.scene ?? options);
        const meshSet = scene.meshes;
        const shaderSet = scene.shaders;
        const transformSet = scene.transforms;

        if (!meshSet) {
            throw new Error(
                "[MeshRendererWGPU] Scene meshes source was not provided! Pass meshes in options: { meshes: meshSet, ... }."
            );
        }
        if (!shaderSet) {
            throw new Error(
                "[MeshRendererWGPU] Scene shaders source was not provided! Pass shaders in options: { shaders: shaderSet, ... }."
            );
        }

        // Derive entities iterable
        const entities: Iterable<number> | undefined = scene.entities ?? (
            ("entities" in meshSet && Array.isArray((meshSet as any).entities))
                ? (meshSet as any).entities
                : undefined
        );
        if (!entities) {
            throw new Error(
                "[MeshRendererWGPU] Entities list could not be automatically determined from meshes. Please pass entities in options: { entities, ... }."
            );
        }

        // 1. Collect active entities and stage their transforms into _transformStaging
        const activeEntities: number[] = [];
        let entityCount = 0;

        for (const entity of entities) {
            const meshCmp = meshSet.get(entity);
            if (!meshCmp || !meshCmp.visible) continue;
            if (!(meshCmp.mesh instanceof MeshWGPU)) continue;
            const shaderCmp = shaderSet.get(entity);
            if (!shaderCmp) continue;

            activeEntities.push(entity);
            entityCount++;
        }

        if (entityCount === 0) return;

        // Ensure transform staging and GPU buffer capacity (256 bytes = 64 floats per entity)
        const requiredFloats = entityCount * 64;
        if (this._transformStaging.length < requiredFloats) {
            this._transformStaging = new Float32Array(Math.max(requiredFloats, this._transformStaging.length * 2));
        }

        const requiredBytes = entityCount * 256;
        if (!this._transformBuffer || this._transformBuffer.size < requiredBytes) {
            this._transformBuffer?.destroy();
            const allocSize = Math.max(requiredBytes, 65536);
            this._transformBuffer = Buffer.createUniform(device, allocSize, "MeshRenderer_TransformBuffer");
            this._transformBindTable = undefined;
        }

        // Write model and normal matrices into staging array
        for (let i = 0; i < entityCount; i++) {
            const entity = activeEntities[i];
            const transformCmp = transformSet?.get(entity);
            const floatOffset = i * 64;

            if (transformCmp) {
                this._transformStaging.set(transformCmp.worldMatrix, floatOffset);
                if (transformCmp.normalMatrix) {
                    this._transformStaging.set(transformCmp.normalMatrix, floatOffset + 16);
                } else {
                    this._transformStaging.set(transformCmp.worldMatrix, floatOffset + 16);
                }
            } else {
                this._transformStaging.set(IDENTITY_MAT4, floatOffset);
                this._transformStaging.set(IDENTITY_MAT4, floatOffset + 16);
            }
        }

        // Upload transforms in one single batch
        this._transformBuffer.write(device, this._transformStaging.subarray(0, requiredFloats), 0);

        // 2. Setup Camera Uniforms (Slot 0)
        this._updateCameraBuffer(device, camera);

        // 3. Render loop with state filtering
        let lastBoundPipeline: GPURenderPipeline | undefined;
        let lastBoundMesh: MeshWGPU | undefined;
        let lastBoundMaterial: BindTable | undefined;
        let lastBoundCameraTable: BindTable | undefined;

        for (let i = 0; i < entityCount; i++) {
            const entity = activeEntities[i];
            const meshCmp = meshSet.get(entity)!;
            const mesh = meshCmp.mesh as MeshWGPU;
            const shaderCmp = shaderSet.get(entity)!;
            const submeshes = mesh.submeshes;
            const dynamicOffset = i * 256;

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
                const shader = shaderCmp.shaders[s];
                if (!shader || !(shader instanceof ShaderWGPU)) continue;

                const submesh = submeshes[s];

                // Set pipeline
                if (lastBoundPipeline !== shader.pipeline.native) {
                    pass.setPipeline(shader.pipeline.native);
                    lastBoundPipeline = shader.pipeline.native;
                }

                // Check layout architecture: 3-group (modern) vs legacy 2-group
                const isLegacyLayout = shader.meta.entityGroupIndex === shader.meta.cameraGroupIndex;

                if (isLegacyLayout) {
                    // Legacy Group 0: Combined Entity + Camera
                    const transformCmp = transformSet?.get(entity);
                    const legacyGroup0 = this._createLegacyGroup0(device, shader, camera, transformCmp);
                    if (legacyGroup0) pass.setBindGroup(0, legacyGroup0);
                } else {
                    // Modern Slot 0: Camera (PerFrame)
                    if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                        const cameraTable = this._getCameraBindTable(device, shader);
                        if (cameraTable && lastBoundCameraTable !== cameraTable) {
                            pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                            lastBoundCameraTable = cameraTable;
                        }
                    }

                    // Modern Slot 2: Entity Transform (PerInstance dynamic offset)
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
                    const mergedParams: ShaderParams = {
                        floats: {
                            ...shader.defaultParams.floats,
                            ...shaderCmp.params[s]?.floats,
                        },
                        vectors: {
                            ...shader.defaultParams.vectors,
                            ...shaderCmp.params[s]?.vectors,
                        },
                        textures: {
                            ...shader.defaultParams.textures,
                            ...shaderCmp.params[s]?.textures,
                        },
                        samplers: {
                            ...shader.defaultParams.samplers,
                            ...shaderCmp.params[s]?.samplers,
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
    }

    /**
     * Draws a single mesh with a shader directly (zero ECS required).
     */
    drawMesh(options: DrawMeshOptions): void {
        const pass = options.pass;
        const camera = options.camera;
        const device = options.device ?? this.device;
        const mesh = options.mesh;
        const shader = options.shader;

        if (!pass) throw new Error("[MeshRendererWGPU.drawMesh] Render pass was not provided!");
        if (!camera) throw new Error("[MeshRendererWGPU.drawMesh] Camera was not provided!");
        if (!device) throw new Error("[MeshRendererWGPU.drawMesh] GPUDevice was not provided!");
        if (!mesh) throw new Error("[MeshRendererWGPU.drawMesh] Mesh was not provided!");
        if (!shader) throw new Error("[MeshRendererWGPU.drawMesh] Shader was not provided!");

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
                    this._transformBindTable = undefined;
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
     * Fallback creation for legacy 2-group shaders combining Entity and Camera into Group 0.
     */
    private _createLegacyGroup0(
        device: GPUDevice,
        shader: ShaderWGPU,
        camera: Camera,
        transformOrWorldMatrix?: TransformCmp | ArrayLike<number>,
        normalMatrixOverride?: ArrayLike<number>
    ): GPUBindGroup | null {
        const layout = shader.bindGroupLayouts[0];
        if (!layout) return null;

        const entries: GPUBindGroupEntry[] = [];
        let bindingIndex = 0;

        // Model & Normal matrices (128 bytes total: 2 x 64 bytes)
        const entityBytes = 128;
        const entityBuf = this.uniformPool.acquire(device, entityBytes);
        const entityData = new Float32Array(32);

        if (transformOrWorldMatrix) {
            if ("worldMatrix" in (transformOrWorldMatrix as any)) {
                const transform = transformOrWorldMatrix as TransformCmp;
                entityData.set(transform.worldMatrix, 0);
                if (transform.normalMatrix) {
                    entityData.set(transform.normalMatrix, 16);
                } else {
                    entityData.set(transform.worldMatrix, 16);
                }
            } else {
                entityData.set(transformOrWorldMatrix as ArrayLike<number>, 0);
                if (normalMatrixOverride) {
                    entityData.set(normalMatrixOverride, 16);
                } else {
                    entityData.set(transformOrWorldMatrix as ArrayLike<number>, 16);
                }
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
            label: "WeebGfx_Legacy_Group0",
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
