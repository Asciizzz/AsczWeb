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
import type { ShaderGPU } from "../shader.js";
import type { ShaderParams, Submesh } from "../types.js";
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

/**
 * Options for executing a screen-space fullscreen blit pass.
 */
export interface BlitOptions {
    pass: GPURenderPassEncoder;
    shader: ShaderWGPU;
    /** Optional camera for shaders reconstructing view rays or depth projection. */
    camera?: Camera;
    /** Material parameters overriding shader defaults. */
    params?: ShaderParams;
    device?: GPUDevice;
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

interface RenderItemWGPU {
    actor: Actor;
    mesh: MeshWGPU;
    submesh: Submesh;
    dynamicOffset: number;
    instanceCount: number;
    params?: ShaderParams | null;
}

interface ShaderBucketWGPU {
    shader: ShaderWGPU;
    items: RenderItemWGPU[];
}

function isCameraLike(obj: unknown): obj is Camera {
    return Boolean(obj && typeof obj === "object" && "viewProjMatrix" in obj);
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

    // Instance transform storage buffer & running multi-pass offset
    private _instanceBuffer?: Buffer;
    private _instanceByteOffset = 0;
    private _instanceStaging = new Float32Array(1024 * 64);

    // Reusable pass bucket pools and offset cache
    private _bucketMap = new Map<ShaderWGPU, ShaderBucketWGPU>();
    private _bucketList: ShaderBucketWGPU[] = [];
    private _actorOffsetMap = new Map<Actor, number>();

    // Deferred submission queue
    private _queue: Actor[] = [];

    // Fallback assets
    private _fallbackTexture?: TextureWGPU;
    private _fallbackSampler?: GPUSampler;

    constructor(device?: GPUDevice, uniformPool?: BufferPool) {
        this.bindTableCache = new BindTableCache();
        this.device = device;
        this.uniformPool =
            uniformPool ??
            new BufferPool(
                BUFFER_USAGE_UNIFORM_COPY_DST,
                "WeebGfx_MeshRenderer_UniformPool"
            );
    }

    /**
     * Resets uniform buffer pool allocations and instance offsets at start of frame.
     */
    reset(): void {
        this.uniformPool.reset();
        this._instanceByteOffset = 0;
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
    flush(target: RenderTarget): void;
    flush(pass: GPURenderPassEncoder, camera: Camera): void;
    flush(passOrTarget: GPURenderPassEncoder | RenderTarget, camera?: Camera): void {
        if (this._queue.length > 0) {
            if ("pass" in passOrTarget) {
                this.render(passOrTarget, this._queue);
            } else {
                this.render(passOrTarget, camera!, this._queue);
            }
            this.clearQueue();
        }
    }

    /**
     * Draws single Actor inside render pass.
     */
    draw(target: RenderTarget, actor: Actor): void;
    draw(pass: GPURenderPassEncoder, camera: Camera, actor: Actor): void;
    draw(passOrTarget: GPURenderPassEncoder | RenderTarget, cameraOrActor: Camera | Actor, actor?: Actor): void {
        if ("pass" in passOrTarget) {
            this.render(passOrTarget, [cameraOrActor as Actor]);
        } else {
            this.render(passOrTarget, cameraOrActor as Camera, [actor!]);
        }
    }

    /**
     * Executes draw calls across iterable of Actors inside render pass.
     * Groups draws by shader pipeline and mesh to minimize GPU state switches.
     */
    render(target: RenderTarget | RenderOptions, actors?: Iterable<Actor>): void;
    render(pass: GPURenderPassEncoder, camera: Camera, actors?: Iterable<Actor>): void;
    render(
        passOrTarget: GPURenderPassEncoder | RenderOptions | RenderTarget,
        cameraOrActors?: Camera | Iterable<Actor>,
        actorsArg?: Iterable<Actor>
    ): void {
        let pass: GPURenderPassEncoder;
        let cam: Camera;
        let actors: Iterable<Actor> | undefined;

        if ("pass" in passOrTarget) {
            const target = passOrTarget as RenderTarget;
            const options = passOrTarget as RenderOptions;
            pass = target.pass;
            cam = target.camera;
            actors = (cameraOrActors as Iterable<Actor> | undefined) ?? options.actors ?? this._queue;
        } else {
            pass = passOrTarget as GPURenderPassEncoder;
            if (isCameraLike(cameraOrActors)) {
                cam = cameraOrActors;
                actors = (actorsArg as Iterable<Actor>) ?? this._queue;
            } else if (isCameraLike(actorsArg)) {
                cam = actorsArg;
                actors = (cameraOrActors as Iterable<Actor>) ?? this._queue;
            } else {
                cam = cameraOrActors as unknown as Camera;
                actors = (actorsArg as Iterable<Actor>) ?? this._queue;
            }
        }

        const device = ("device" in passOrTarget && passOrTarget.device) ? passOrTarget.device : this.device;

        if (!pass) {
            throw new Error(
                "[MeshRendererWGPU] Render pass was not provided."
            );
        }
        if (!cam) {
            throw new Error(
                "[MeshRendererWGPU] Camera was not provided."
            );
        }
        if (!device) {
            throw new Error(
                "[MeshRendererWGPU] GPUDevice was not provided. Pass device to new MeshRendererWGPU(device)."
            );
        }

        if (!actors) return;

        // 1. Collect active actors and filter valid hardware meshes
        const activeActors: Actor[] = [];
        let count = 0;

        for (const actor of actors) {
            if (!(actor.mesh instanceof MeshWGPU)) continue;
            activeActors.push(actor);
            count++;
        }

        if (count === 0) return;

        // 2. Compute 256-byte aligned dynamic offsets for each actor
        this._actorOffsetMap.clear();
        let passTotalBytes = 0;
        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            this._actorOffsetMap.set(actor, passTotalBytes);
            const instCount = Math.max(1, actor.instances.count);
            const bytesNeeded = instCount * 128; // 32 floats = 128 bytes per instance
            passTotalBytes += Math.ceil(bytesNeeded / 256) * 256;
        }

        const passTotalFloats = passTotalBytes / 4;
        if (this._instanceStaging.length < passTotalFloats) {
            this._instanceStaging = new Float32Array(Math.max(passTotalFloats, this._instanceStaging.length * 2));
        }

        const passBaseByteOffset = this._instanceByteOffset;
        const requiredBufferSize = passBaseByteOffset + passTotalBytes;

        if (!this._instanceBuffer || this._instanceBuffer.size < requiredBufferSize) {
            this._instanceBuffer?.destroy();
            const allocSize = Math.max(requiredBufferSize, 1048576);
            this._instanceBuffer = Buffer.create(device, {
                size: allocSize,
                usage: BUFFER_USAGE_STORAGE_COPY_DST,
                label: "MeshRenderer_InstanceStorageBuffer",
            });
        }

        // 3. Pack instance matrices into CPU staging buffer
        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const instCount = Math.max(1, actor.instances.count);
            const baseOffset = this._actorOffsetMap.get(actor) ?? 0;
            const baseFloatOffset = baseOffset / 4;
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

        // Upload packed instances in single transfer for this pass
        this._instanceBuffer.write(device, this._instanceStaging.subarray(0, passTotalFloats), passBaseByteOffset);
        this._instanceByteOffset += passTotalBytes;

        // 4. Acquire pass camera uniform buffer from pool
        const cameraBuffer = this.uniformPool.acquire(device, 256);
        cameraBuffer.write(device, cam.getUniformData(), 0);

        // 5. Populate shader pass buckets
        for (let b = 0; b < this._bucketList.length; b++) {
            this._bucketList[b].items.length = 0;
        }
        this._bucketList.length = 0;
        this._bucketMap.clear();

        for (let i = 0; i < count; i++) {
            const actor = activeActors[i];
            const mesh = actor.mesh as MeshWGPU;
            const dynamicOffset = this._actorOffsetMap.get(actor) ?? 0;
            const instanceCount = Math.max(1, actor.instances.count);

            for (let p = 0; p < actor.passes.length; p++) {
                const pass = actor.passes[p];
                const shader = pass.shader;
                if (!shader || !(shader instanceof ShaderWGPU)) continue;

                let bucket = this._bucketMap.get(shader);
                if (!bucket) {
                    bucket = { shader, items: [] };
                    this._bucketMap.set(shader, bucket);
                    this._bucketList.push(bucket);
                }

                const submeshIndices = pass.submeshIndices;
                const paramsList = pass.params;

                for (let idx = 0; idx < submeshIndices.length; idx++) {
                    const s = submeshIndices[idx];
                    const submesh = mesh.submeshes[s];
                    if (!submesh) continue;

                    const param = paramsList ? paramsList[idx] : null;

                    bucket.items.push({
                        actor,
                        mesh,
                        submesh,
                        dynamicOffset,
                        instanceCount,
                        params: param,
                    });
                }
            }
        }

        // 6. Sort buckets by global shader order
        this._bucketList.sort((a, b) => {
            const orderDiff = a.shader.order - b.shader.order;
            if (orderDiff !== 0) return orderDiff;
            return getStateId(a.shader.pipeline.native) - getStateId(b.shader.pipeline.native);
        });

        // 7. Render loop with state filtering across sorted buckets
        let lastBoundPipeline: GPURenderPipeline | undefined;
        let lastBoundMesh: MeshWGPU | undefined;
        let lastBoundMaterial: BindTable | undefined;
        let lastBoundCameraTable: BindTable | undefined;

        for (let b = 0; b < this._bucketList.length; b++) {
            const bucket = this._bucketList[b];
            const shader = bucket.shader;
            const items = bucket.items;
            if (items.length === 0) continue;

            // Sort intra-bucket items by mesh to minimize vertex and index buffer switches
            items.sort((itemA, itemB) => getStateId(itemA.mesh) - getStateId(itemB.mesh));

            // Set pipeline
            if (lastBoundPipeline !== shader.pipeline.native) {
                pass.setPipeline(shader.pipeline.native);
                lastBoundPipeline = shader.pipeline.native;
                lastBoundCameraTable = undefined;
            }

            const isLegacyLayout = (shader.meta.instanceGroupIndex ?? shader.meta.entityGroupIndex) === shader.meta.cameraGroupIndex;

            if (!isLegacyLayout) {
                // Slot 0: Camera (PerFrame)
                if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                    if (!lastBoundCameraTable) {
                        const cameraTable = this._getCameraBindTable(device, shader, cameraBuffer);
                        if (cameraTable) {
                            pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                            lastBoundCameraTable = cameraTable;
                        }
                    }
                }
            }

            for (let it = 0; it < items.length; it++) {
                const item = items[it];
                const actor = item.actor;
                const mesh = item.mesh;
                const submesh = item.submesh;

                // Bind vertex and index buffers once per mesh
                if (lastBoundMesh !== mesh) {
                    pass.setVertexBuffer(0, mesh.vertexBuffer.native);
                    if (mesh.indexBuffer) {
                        const indexFormat = mesh.cpu.indexBytes instanceof Uint32Array ? "uint32" : "uint16";
                        pass.setIndexBuffer(mesh.indexBuffer.native, indexFormat);
                    }
                    lastBoundMesh = mesh;
                }

                if (isLegacyLayout) {
                    const legacyGroup0 = this._createLegacyGroup0(
                        device,
                        shader,
                        cam,
                        actor.transform,
                        actor.normalMatrix
                    );
                    if (legacyGroup0) pass.setBindGroup(0, legacyGroup0);
                } else {
                    // Slot 2: Instance Transform Storage Buffer (PerInstance dynamic offset)
                    if (shader.meta.hasTransform && shader.bindGroupLayouts.length > 2) {
                        const instanceTable = this._getInstanceBindTable(device, shader);
                        if (instanceTable) {
                            pass.setBindGroup(
                                shader.meta.instanceGroupIndex ?? 2,
                                instanceTable.native,
                                [passBaseByteOffset + item.dynamicOffset]
                            );
                        }
                    }
                }

                // Slot 1: Material Parameters (PerBatch)
                const materialGroupIdx = shader.meta.materialGroupIndex ?? 1;
                if (shader.bindGroupLayouts.length > materialGroupIdx) {
                    const actorSubmeshParams = item.params;

                    let mergedParams: ShaderParams;
                    if (!actorSubmeshParams) {
                        mergedParams = shader.defaultParams;
                    } else {
                        mergedParams = {
                            floats: actorSubmeshParams.floats
                                ? { ...shader.defaultParams.floats, ...actorSubmeshParams.floats }
                                : shader.defaultParams.floats,
                            vectors: actorSubmeshParams.vectors
                                ? { ...shader.defaultParams.vectors, ...actorSubmeshParams.vectors }
                                : shader.defaultParams.vectors,
                            textures: actorSubmeshParams.textures
                                ? { ...shader.defaultParams.textures, ...actorSubmeshParams.textures }
                                : shader.defaultParams.textures,
                            samplers: actorSubmeshParams.samplers
                                ? { ...shader.defaultParams.samplers, ...actorSubmeshParams.samplers }
                                : shader.defaultParams.samplers,
                        };
                    }

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
                        item.instanceCount,
                        submesh.firstIndex,
                        submesh.baseVertex ?? 0,
                        0
                    );
                } else {
                    pass.draw(submesh.indexCount, item.instanceCount, submesh.firstIndex, 0);
                }
            }
        }
    }

    /**
     * Executes a screen-space fullscreen blit pass with 3 procedural vertices.
     * Binds material parameters and textures (Slot 1) without requiring vertex buffers.
     */
    blit(options: BlitOptions): void {
        const pass = options.pass;
        const shader = options.shader;
        const device = options.device ?? this.device;

        if (!pass) throw new Error("[MeshRendererWGPU.blit] Render pass was not provided.");
        if (!shader) throw new Error("[MeshRendererWGPU.blit] Shader was not provided.");
        if (!device) throw new Error("[MeshRendererWGPU.blit] GPUDevice was not provided.");

        pass.setPipeline(shader.pipeline.native);

        // Optional Camera Uniforms (Slot 0)
        if (options.camera && shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
            const cameraBuffer = this.uniformPool.acquire(device, 256);
            cameraBuffer.write(device, options.camera.getUniformData(), 0);
            const cameraTable = this._getCameraBindTable(device, shader, cameraBuffer);
            if (cameraTable) {
                pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
            }
        }

        // Material Parameters & Textures (Slot 1)
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

        // Draw 3 vertices for procedural fullscreen triangle
        pass.draw(3, 1, 0, 0);
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
            if (shader.meta.hasCamera && shader.bindGroupLayouts.length > 0) {
                const cameraBuffer = this.uniformPool.acquire(device, 256);
                cameraBuffer.write(device, camera.getUniformData(), 0);
                const cameraTable = this._getCameraBindTable(device, shader, cameraBuffer);
                if (cameraTable) {
                    pass.setBindGroup(shader.meta.cameraGroupIndex ?? 0, cameraTable.native);
                }
            }

            // Instance Transform (Slot 2)
            if (shader.meta.hasTransform && shader.bindGroupLayouts.length > 2) {
                const bytesNeeded = 256;
                const passBaseByteOffset = this._instanceByteOffset;
                const requiredBufferSize = passBaseByteOffset + bytesNeeded;

                if (!this._instanceBuffer || this._instanceBuffer.size < requiredBufferSize) {
                    this._instanceBuffer?.destroy();
                    const allocSize = Math.max(requiredBufferSize, 1048576);
                    this._instanceBuffer = Buffer.create(device, {
                        size: allocSize,
                        usage: BUFFER_USAGE_STORAGE_COPY_DST,
                        label: "MeshRenderer_InstanceStorageBuffer",
                    });
                }

                const world = (options.worldMatrix as Float32Array) ?? IDENTITY_MAT4;
                const normal = (options.normalMatrix as Float32Array) ?? world;
                this._instanceStaging.set(world, 0);
                this._instanceStaging.set(normal, 16);
                this._instanceBuffer.write(device, this._instanceStaging.subarray(0, 32), passBaseByteOffset);

                const instanceTable = this._getInstanceBindTable(device, shader);
                if (instanceTable) {
                    pass.setBindGroup(shader.meta.instanceGroupIndex ?? 2, instanceTable.native, [passBaseByteOffset]);
                }
                this._instanceByteOffset += bytesNeeded;
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

    private _getCameraBindTable(
        device: GPUDevice,
        shader: ShaderWGPU,
        cameraBuffer: Buffer
    ): BindTable | null {
        const layout = shader.bindGroupLayouts[shader.meta.cameraGroupIndex ?? 0];
        if (!layout || !cameraBuffer) return null;

        const entries: BindingEntry[] = [
            {
                binding: 0,
                resource: {
                    buffer: cameraBuffer.native,
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
                for (const v of bindings.vectors) {
                    const val = params.vectors?.[v] ?? (shader.defaultParams.vectors?.[v] ?? [0, 0, 0, 0]);
                    data.set(val, offset);
                    offset += 4;
                }
                for (const f of bindings.floats) {
                    data[offset++] = params.floats?.[f] ?? (shader.defaultParams.floats?.[f] ?? 0.0);
                }
                paramBuf.write(device, data);

                entries.push({
                    binding: bindingIndex++,
                    resource: { buffer: paramBuf.native, offset: 0, size: byteSize },
                });
            }

            // 2. Texture Parameters
            for (const texName of bindings.textures) {
                const rawTex = params.textures?.[texName];
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
                if (!sampler && params.textures?.[smpName] instanceof TextureWGPU) {
                    sampler = (params.textures[smpName] as TextureWGPU).sampler;
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
