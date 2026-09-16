import { BufferPool } from "../../Atoolkit/awgpu_old/buffer.js";
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

/**
 * WebGPU hardware mesh drawing operator.
 * Does NOT own the GPU backend, canvas context, or render pass lifecycle.
 * Operates purely as a submesh drawing operator inside a caller-orchestrated render pass.
 * Strictly requires an externally managed GPURenderPassEncoder and Camera instance.
 */
const BUFFER_USAGE_UNIFORM_COPY_DST =
    typeof GPUBufferUsage !== "undefined"
        ? GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        : 0x0040 | 0x0008; // 72

export class MeshRendererWGPU {
    device?: GPUDevice;
    readonly uniformPool: BufferPool;
    private _fallbackTexture?: TextureWGPU;

    constructor(deviceOrOptions?: GPUDevice | BufferPool | MeshRendererOptions) {
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
     * Resets internal uniform buffer pool allocations at the beginning of a frame.
     */
    reset(): void {
        this.uniformPool.reset();
    }

    /**
     * Executes render pass across active entities using an external render pass and Camera.
     * 
     * Supported calling conventions:
     * 1. Unified options object:
     *    `renderer.render({ pass, camera, meshes, shaders, transforms })`
     * 2. Target + Scene separation:
     *    `renderer.render({ pass, camera }, { meshes, shaders, transforms })`
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
                "[MeshRendererWGPU] Render pass was not provided! The renderer does NOT own or create render passes. Pass a valid GPURenderPassEncoder in options: { pass, ... }."
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
        const _skinSet = scene.skins;

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

        // Derive entities: either explicitly passed, or extracted from meshSet
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

        for (const entity of entities) {
            const meshCmp = meshSet.get(entity);
            if (!meshCmp || !meshCmp.visible) continue;

            // Enforce WebGPU hardware mesh
            if (!(meshCmp.mesh instanceof MeshWGPU)) continue;
            const mesh = meshCmp.mesh;

            const shaderCmp = shaderSet.get(entity);
            if (!shaderCmp) continue; // Skip entities without shader component

            const submeshes = mesh.submeshes;
            const transformCmp = transformSet?.get(entity);

            // Bind vertex buffer and optional index buffer once per mesh
            pass.setVertexBuffer(0, mesh.vertexBuffer.gpuBuffer);
            if (mesh.indexBuffer) {
                pass.setIndexBuffer(mesh.indexBuffer.gpuBuffer, "uint16");
            }

            // Iterate submeshes
            for (let s = 0; s < submeshes.length; s++) {
                const shader = shaderCmp.shaders[s];
                if (!shader || !(shader instanceof ShaderWGPU)) continue; // Skip submesh without assigned WebGPU shader

                const submesh = submeshes[s];
                pass.setPipeline(shader.pipeline.gpuPipeline);

                // 1. Group 0 (Entity & Camera Uniforms)
                if (shader.bindGroupLayouts.length > 0) {
                    const group0 = this._createGroup0(
                        device,
                        shader,
                        camera,
                        transformCmp
                    );
                    if (group0) {
                        pass.setBindGroup(0, group0);
                    }
                }

                // 2. Group 1 (Material Parameters)
                if (shader.bindGroupLayouts.length > 1) {
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

                    const group1 = this._createGroup1(device, shader, mergedParams);
                    if (group1) {
                        pass.setBindGroup(1, group1);
                    }
                }

                // 3. Issue Draw Call
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

        pass.setVertexBuffer(0, mesh.vertexBuffer.gpuBuffer);
        if (mesh.indexBuffer) {
            pass.setIndexBuffer(mesh.indexBuffer.gpuBuffer, "uint16");
        }

        pass.setPipeline(shader.pipeline.gpuPipeline);

        // Group 0: Camera + World/Normal Transform
        if (shader.bindGroupLayouts.length > 0) {
            const group0 = this._createGroup0(
                device,
                shader,
                camera,
                options.worldMatrix,
                options.normalMatrix
            );
            if (group0) pass.setBindGroup(0, group0);
        }

        // Group 1: Material Params
        if (shader.bindGroupLayouts.length > 1) {
            const mergedParams: ShaderParams = {
                floats: { ...shader.defaultParams.floats, ...options.params?.floats },
                vectors: { ...shader.defaultParams.vectors, ...options.params?.vectors },
                textures: { ...shader.defaultParams.textures, ...options.params?.textures },
                samplers: { ...shader.defaultParams.samplers, ...options.params?.samplers },
            };
            const group1 = this._createGroup1(device, shader, mergedParams);
            if (group1) pass.setBindGroup(1, group1);
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

    private _createGroup0(
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
            // Identity matrices
            entityData[0] = 1; entityData[5] = 1; entityData[10] = 1; entityData[15] = 1;
            entityData[16] = 1; entityData[21] = 1; entityData[26] = 1; entityData[31] = 1;
        }
        entityBuf.write(device, entityData);

        entries.push({
            binding: bindingIndex++,
            resource: { buffer: entityBuf.gpuBuffer, offset: 0, size: entityBytes },
        });

        // Camera Uniforms (viewMatrix 64B, projMatrix 64B, viewProjMatrix 64B, cameraPosition 12B, pad 4B = 208B)
        const cameraBytes = 208;
        const cameraBuf = this.uniformPool.acquire(device, cameraBytes);
        cameraBuf.write(device, camera.getUniformData());
        entries.push({
            binding: bindingIndex++,
            resource: { buffer: cameraBuf.gpuBuffer, offset: 0, size: cameraBytes },
        });

        return device.createBindGroup({
            label: "WeebGfx_WebGPU_Group0",
            layout,
            entries,
        });
    }

    private _createGroup1(
        device: GPUDevice,
        shader: ShaderWGPU,
        params: ShaderParams
    ): GPUBindGroup | null {
        const layout = shader.bindGroupLayouts[1];
        if (!layout) return null;

        const entries: GPUBindGroupEntry[] = [];
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
                    resource: { buffer: paramBuf.gpuBuffer, offset: 0, size: byteSize },
                });
            }

            // 2. Texture Parameters
            for (const texName of bindings.textures) {
                const rawTex = params.textures?.[texName] ?? (params.textures ? Object.values(params.textures)[0] : undefined);
                let tex: TextureWGPU;
                if (rawTex instanceof TextureWGPU) {
                    tex = rawTex;
                } else {
                    if (!this._fallbackTexture) {
                        this._fallbackTexture = TextureWGPU.create1x1(device, 255, 255, 255, 255);
                    }
                    tex = this._fallbackTexture;
                }
                entries.push({
                    binding: bindingIndex++,
                    resource: tex.view,
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
                    sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
                }
                entries.push({
                    binding: bindingIndex++,
                    resource: sampler,
                });
            }
        } else {
            const floatEntries = Object.values(params.floats ?? {});
            const vecEntries = Object.values(params.vectors ?? {});

            if (floatEntries.length > 0 || vecEntries.length > 0) {
                const totalFloats = floatEntries.length + vecEntries.length * 4;
                const byteSize = Math.max(16, Math.ceil((totalFloats * 4) / 16) * 16);
                const paramBuf = this.uniformPool.acquire(device, byteSize);
                const data = new Float32Array(byteSize / 4);

                let offset = 0;
                for (const f of floatEntries) {
                    data[offset++] = f;
                }
                for (const v of vecEntries) {
                    data.set(v, offset);
                    offset += 4;
                }
                paramBuf.write(device, data);

                entries.push({
                    binding: bindingIndex++,
                    resource: { buffer: paramBuf.gpuBuffer, offset: 0, size: byteSize },
                });
            }

            if (params.textures) {
                for (const tex of Object.values(params.textures)) {
                    if (tex instanceof TextureWGPU) {
                        entries.push({
                            binding: bindingIndex++,
                            resource: tex.view,
                        });
                        entries.push({
                            binding: bindingIndex++,
                            resource: tex.sampler,
                        });
                    }
                }
            }
        }

        return device.createBindGroup({
            label: "WeebGfx_WebGPU_Group1",
            layout,
            entries,
        });
    }
}

export {
    MeshRendererWGPU as RendererWGPU,
};

