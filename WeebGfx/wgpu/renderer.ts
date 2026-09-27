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
import type { Actor, SkinData } from "../actor.js";
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

const BUFFER_USAGE_STORAGE_COPY_DST =
    typeof GPUBufferUsage !== "undefined"
        ? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        : 0x0080 | 0x0008; // 136

const IDENTITY_MAT4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

let _nextStateId = 1;
const _stateIdMap = new WeakMap<object, number>();
function getStateId(obj: object | null | undefined): number {
    if (!obj) return 0;
    let id = _stateIdMap.get(obj);
    if (id === undefined) {
        id = _nextStateId++;
        _stateIdMap.set(obj, id);
    }
    return id;
}

/**
 * Submesh draw dispatcher operating within caller-provided render passes.
 * Uses a four-frequency WebGPU bind group layout:
 * - Slot 0 (PerFrame): Camera projection uniforms.
 * - Slot 1 (PerBatch): Material parameters, textures, and samplers.
 * - Slot 2 (PerInstance): Storage buffer instances with 256-byte dynamic offsets.
 * - Slot 3 (PerInstance): Skeletal joint uniform array.
 */
export class MeshRendererWGPU {
    device?: GPUDevice;
    readonly uniformPool: BufferPool;
    readonly bindTableCache: BindTableCache;

    // Camera uniform buffer and cached bind tables
    private _cameraBuffer?: Buffer;
    private _lastCameraData = new Float32Array(52);
    private _cameraInitialized = false;

    // Instance transform storage buffer & CPU staging array
    private _instanceBuffer?: Buffer;
    private _instanceStaging = new Float32Array(1024 * 64);

    // Deferred submission queue
    private _queue: Actor[] = [];

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
     * Submits single Actor to draw queue for deferred rendering.
     */
    submit(actor: Actor): this {
        this._queue.push(actor);
        return this;
    }

    /**
     * Submits multiple Actors to draw queue for deferred rendering.
     */
    submitBatch(actors: Iterable<Actor>): this {
        for (const actor of actors) {
            this._queue.push(actor);
        }
        return this;
    }

    /**
     * Clears pending Actor submission queue.
     */
    clearQueue(): void {
        this._queue.length = 0;
    }

    /**
     * Executes draw calls for all submitted Actors in queue, then clears queue.
     */
    flush(target: RenderTarget): void {
        if (this._queue.length > 0) {
            this.render(target, this._queue);
            this.clearQueue();
        }
    }

    /**
     * Draws single Actor inside render pass.
     */
    draw(target: RenderTarget, actor: Actor): void {
        this.render(target, [actor]);
    }

    /**
     * Executes draw calls across iterable of Actors inside render pass.
     * Groups draws by shader pipeline and mesh to minimize GPU state switches.
     */
    render(
        targetOrOptions: RenderOptions | RenderTarget,
        actorsArg?: Iterable<Actor>
    ): void {
        const target = targetOrOptions as RenderTarget;
        const options = targetOrOptions as RenderOptions;

        const pass = target.pass;
        const camera = target.camera;
        const device = target.device ?? this.device;

        if (!pass) {
            throw new Error(
                "[MeshRendererWGPU] Render pass was not provided. Pass valid GPURenderPassEncoder in options: { pass, ... }."
            );
        }
        if (!camera) {
            throw new Error(
                "[MeshRendererWGPU] Camera was not provided. Pass valid Camera instance in options: { camera, ... }."
            );
        }
        if (!device) {
            throw new Error(
                "[MeshRendererWGPU] GPUDevice was not provided. Pass device to new RendererWGPU(device) or in render options: { device, ... }."
            );
        }

        const actors = actorsArg ?? options.actors ?? this._queue;
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

        // 2. State sorting to minimize pipeline and mesh switches
        activeActors.sort((a, b) => {
            const sA = a.shaders[0];
            const sB = b.shaders[0];
            const pipeA = getStateId(sA instanceof ShaderWGPU ? sA.pipeline.native : sA);
            const pipeB = getStateId(sB instanceof ShaderWGPU ? sB.pipeline.native : sB);
            if (pipeA !== pipeB) return pipeA - pipeB;

            const meshA = getStateId(a.mesh);
            const meshB = getStateId(b.mesh);
            return meshA - meshB;
        });

        // 3. Compute 256-byte aligned dynamic offsets for each actor
        const actorOffsets = new Uint32Array(count);
        let totalBytes = 0;
        for (let i = 0; i < count; i++) {
            actorOffsets[i] = totalBytes;
            const instCount = Math.max(1, activeActors[i].instances.count);
            const bytesNeeded = instCount * 128; // 32 floats = 128 bytes per instance
            totalBytes += Math.ceil(bytesNeeded / 256) * 256;
        }

        const totalFloats = totalBytes / 4;
        if (this._instanceStaging.length < totalFloats) {
            this._instanceStaging = new Float32Array(Math.max(totalFloats, this._instanceStaging.length * 2));
        }

        if (!this._instanceBuffer || this._instanceBuffer.size < totalBytes) {
            this._instanceBuffer?.destroy();
            const allocSize = Math.max(totalBytes, 65536);
            this._instanceBuffer = Buffer.create(device, {
                size: allocSize,
                usage: BUFFER_USAGE_STORAGE_COPY_DST,
                label: "MeshRenderer_InstanceStorageBuffer",
            });
        }

        // 4. Pack instance matrices into CPU staging buffer
        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const instCount = Math.max(1, actor.instances.count);
            const baseFloatOffset = actorOffsets[i] / 4;
            const matrices = actor.instances.matrices;
            const normalMatrices = actor.instances.normalMatrices;

            for (let inst = 0; inst < instCount; inst++) {
                const srcMatOffset = inst * 16;
                const dstOffset = baseFloatOffset + inst * 32;

                if (srcMatOffset + 16 <= matrices.length) {
                    this._instanceStaging.set(matrices.subarray(srcMatOffset, srcMatOffset + 16), dstOffset);
                } else {
                    this._instanceStaging.set(IDENTITY_MAT4, dstOffset);
                }

                if (normalMatrices && srcMatOffset + 16 <= normalMatrices.length) {
                    this._instanceStaging.set(normalMatrices.subarray(srcMatOffset, srcMatOffset + 16), dstOffset + 16);
                } else if (srcMatOffset + 16 <= matrices.length) {
                    this._instanceStaging.set(matrices.subarray(srcMatOffset, srcMatOffset + 16), dstOffset + 16);
                } else {
                    this._instanceStaging.set(IDENTITY_MAT4, dstOffset + 16);
                }
            }
        }

        // Upload packed instances in single transfer
        this._instanceBuffer.write(device, this._instanceStaging.subarray(0, totalFloats), 0);

        // 5. Update pass camera buffer once
        this._updateCameraBuffer(device, camera);

        // 6. Render loop with state filtering
        let lastBoundPipeline: GPURenderPipeline | undefined;
        let lastBoundMesh: MeshWGPU | undefined;
        let lastBoundMaterial: BindTable | undefined;
        let lastBoundCameraTable: BindTable | undefined;

        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const mesh = actor.mesh as MeshWGPU;
            const submeshes = mesh.submeshes;
            const dynamicOffset = actorOffsets[i];
            const instanceCount = Math.max(1, actor.instances.count);

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
                    lastBoundCameraTable = undefined;
                }

                // Check layout architecture: multi-group vs combined legacy 2-group
                const isLegacyLayout = (shader.meta.instanceGroupIndex ?? shader.meta.entityGroupIndex) === shader.meta.cameraGroupIndex;

                if (isLegacyLayout) {
                    // Combined Group 0: Instance Transform and Camera
                    const legacyGroup0 = this._createLegacyGroup0(
                        device,
                        shader,
                        camera,
                        actor.transform,
                        actor.normalMatrix
                    );
                    if (legacyGroup0) pass.setBindGroup(0, legacyGroup0);
                } else {
                    // Slot 0: Camera (PerFrame)
                    if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                        if (!lastBoundCameraTable) {
                            const cameraTable = this._getCameraBindTable(device, shader);
                            if (cameraTable) {
                                pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                                lastBoundCameraTable = cameraTable;
                            }
                        }
                    }

                    // Slot 2: Instance Transform Storage Buffer (PerInstance dynamic offset)
                    if (shader.meta.hasTransform && shader.bindGroupLayouts.length > 2) {
                        const instanceTable = this._getInstanceBindTable(device, shader);
                        if (instanceTable) {
                            pass.setBindGroup(
                                shader.meta.instanceGroupIndex ?? 2,
                                instanceTable.native,
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

                // Slot 3: Skin Joints (PerInstance)
                if (shader.meta.hasSkin && actor.skin) {
                    const skinGroupIdx = shader.meta.skinGroupIndex ?? 3;
                    if (shader.bindGroupLayouts.length > skinGroupIdx) {
                        const skinTable = this._getSkinBindTable(device, shader, actor.skin);
                        if (skinTable) {
                            pass.setBindGroup(skinGroupIdx, skinTable.native);
                        }
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

        const isLegacyLayout = (shader.meta.instanceGroupIndex ?? shader.meta.entityGroupIndex) === shader.meta.cameraGroupIndex;

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

            // Instance Transform (Slot 2)
            if (shader.meta.hasTransform && shader.bindGroupLayouts.length > 2) {
                if (!this._instanceBuffer || this._instanceBuffer.size < 256) {
                    this._instanceBuffer?.destroy();
                    this._instanceBuffer = Buffer.create(device, {
                        size: 65536,
                        usage: BUFFER_USAGE_STORAGE_COPY_DST,
                        label: "MeshRenderer_InstanceStorageBuffer",
                    });
                }

                const world = (options.worldMatrix as Float32Array) ?? IDENTITY_MAT4;
                const normal = (options.normalMatrix as Float32Array) ?? world;
                this._instanceStaging.set(world, 0);
                this._instanceStaging.set(normal, 16);
                this._instanceBuffer.write(device, this._instanceStaging.subarray(0, 32), 0);

                const instanceTable = this._getInstanceBindTable(device, shader);
                if (instanceTable) {
                    pass.setBindGroup(shader.meta.instanceGroupIndex ?? 2, instanceTable.native, [0]);
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

    private _getInstanceBindTable(device: GPUDevice, shader: ShaderWGPU): BindTable | null {
        const instanceGroupIdx = shader.meta.instanceGroupIndex ?? shader.meta.entityGroupIndex ?? 2;
        const layout = shader.bindGroupLayouts[instanceGroupIdx];
        if (!layout || !this._instanceBuffer) return null;

        const entries: BindingEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: this._instanceBuffer.native,
                    offset: 0,
                    size: 128,
                },
            },
        ];

        return this.bindTableCache.getOrCreate(device, layout, entries, {
            slot: SlotFrequency.PerInstance,
            label: "InstanceTransform_BindTable",
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

    private _getSkinBindTable(
        device: GPUDevice,
        shader: ShaderWGPU,
        skin: SkinData
    ): BindTable | null {
        const skinGroupIdx = shader.meta.skinGroupIndex ?? 3;
        const layout = shader.bindGroupLayouts[skinGroupIdx];
        if (!layout) return null;

        const byteSize = Math.max(4096, skin.jointMatrices.byteLength);
        const skinBuf = this.uniformPool.acquire(device, byteSize);
        skinBuf.write(device, skin.jointMatrices);

        return this.bindTableCache.getOrCreate(
            device,
            layout,
            [{
                binding: 0,
                resource: {
                    buffer: skinBuf.native,
                    offset: 0,
                    size: byteSize,
                },
            }],
            {
                slot: SlotFrequency.PerInstance,
                label: "Skin_BindTable",
            }
        );
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
        const transformBytes = 128;
        const transformBuf = this.uniformPool.acquire(device, transformBytes);
        const transformData = new Float32Array(32);

        if (worldMatrix) {
            transformData.set(worldMatrix as ArrayLike<number>, 0);
            if (normalMatrixOverride) {
                transformData.set(normalMatrixOverride as ArrayLike<number>, 16);
            } else {
                transformData.set(worldMatrix as ArrayLike<number>, 16);
            }
        } else {
            transformData.set(IDENTITY_MAT4, 0);
            transformData.set(IDENTITY_MAT4, 16);
        }
        transformBuf.write(device, transformData);

        entries.push({
            binding: bindingIndex++,
            resource: { buffer: transformBuf.native, offset: 0, size: transformBytes },
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
        this._instanceBuffer?.destroy();
        this._fallbackTexture?.destroy();
        this.uniformPool.destroy();
        this.bindTableCache.clear();
        this.clearQueue();
    }
}

export {
    MeshRendererWGPU as RendererWGPU,
};
