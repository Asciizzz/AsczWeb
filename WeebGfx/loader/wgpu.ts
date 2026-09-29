import { MeshWGPU } from "../wgpu/mesh.js";
import { TextureWGPU } from "../wgpu/texture.js";
import { ShaderWGPU } from "../wgpu/shader.js";
import { Actor, type ActorPass } from "../actor.js";
import type { ShaderGPU } from "../shader.js";
import type { ShaderParams } from "../types.js";
import type { SkeletonCPU } from "../skeleton.js";
import { ModelGPU, type ModelCPU, type MaterialData } from "./model.js";

export interface ModelWGPUOptions {
    /** Target render pass color format. */
    targetFormat?: GPUTextureFormat;
    /** Depth attachment format (e.g. "depth24plus"). */
    depthFormat?: GPUTextureFormat;
    /** Primitive face cull mode. */
    cullMode?: GPUCullMode;
    /** Custom shader(s) per submesh or single shader for all submeshes. */
    shaders?: ShaderWGPU | (ShaderWGPU | null)[];
    /** Custom sampler descriptor for loaded textures. */
    samplerDescriptor?: GPUSamplerDescriptor;
}

/**
 * WebGPU hardware implementation of ModelGPU.
 * Allocates native vertex/index buffers, textures, and stamps independent Actors.
 */
export class ModelWGPU extends ModelGPU {
    declare name?: string;
    mesh: MeshWGPU;
    textures: TextureWGPU[];
    materials: MaterialData[];
    shaders: (ShaderWGPU | null)[];
    params: ShaderParams[];
    declare skeleton?: SkeletonCPU;
    device: GPUDevice;

    constructor(
        device: GPUDevice,
        mesh: MeshWGPU,
        textures: TextureWGPU[],
        materials: MaterialData[],
        shaders: (ShaderWGPU | null)[],
        params: ShaderParams[],
        skeleton?: SkeletonCPU,
        name?: string
    ) {
        super();
        this.device = device;
        this.mesh = mesh;
        this.textures = textures;
        this.materials = materials;
        this.shaders = shaders;
        this.params = params;
        this.skeleton = skeleton;
        this.name = name;
    }

    /**
     * Uploads ModelCPU geometry and textures to WebGPU hardware.
     */
    static create(
        device: GPUDevice,
        modelCpu: ModelCPU,
        options?: ModelWGPUOptions
    ): ModelWGPU {
        const mesh = MeshWGPU.create(device, modelCpu.mesh);

        const textures: TextureWGPU[] = [];
        for (const tex of modelCpu.textures) {
            textures.push(TextureWGPU.create(device, tex, options?.samplerDescriptor));
        }

        const submeshCount = modelCpu.mesh.submeshes.length;
        const shaders: (ShaderWGPU | null)[] = [];
        const params: ShaderParams[] = [];

        for (let s = 0; s < submeshCount; s++) {
            const submesh = modelCpu.mesh.submeshes[s];
            const matIdx = submesh.materialIndex ?? s;
            const mat = modelCpu.materials[matIdx];

            const texIdx = mat?.baseColorTextureIndex;
            const hasTex = texIdx !== undefined && textures[texIdx] !== undefined;

            let shader: ShaderWGPU | null = null;
            if (options?.shaders) {
                if (Array.isArray(options.shaders)) {
                    shader = options.shaders[s] ?? null;
                } else {
                    shader = options.shaders;
                }
            }

            const p: ShaderParams = {};
            if (mat?.baseColorFactor) {
                let [r, g, b, a] = mat.baseColorFactor;
                if (a === undefined || a <= 0.001) a = 1.0;
                if (!hasTex && r < 0.12 && g < 0.12 && b < 0.12) {
                    r = Math.max(r, 0.65);
                    g = Math.max(g, 0.65);
                    b = Math.max(b, 0.65);
                }
                p.vectors = { baseColor: [r, g, b, a] };
            }
            if (hasTex && texIdx !== undefined) {
                p.textures = { albedo: textures[texIdx] };
                p.samplers = { albedoSmp: textures[texIdx].sampler };
            }

            shaders.push(shader);
            params.push(p);
        }

        return new ModelWGPU(
            device,
            mesh,
            textures,
            modelCpu.materials,
            shaders,
            params,
            modelCpu.skeleton,
            modelCpu.name
        );
    }

    /**
     * Stamped Actor factory creating independent render units with separate transform streams.
     */
    override createActor(shader?: ShaderGPU | ShaderGPU[] | ActorPass[]): Actor {
        if (Array.isArray(shader) && shader.length > 0 && "submeshIndices" in shader[0]) {
            const actor = new Actor(this.mesh, shader as ActorPass[]);
            if (this.skeleton) {
                const jointMatrices = this.skeleton.computeJointMatrices();
                actor.setSkin(jointMatrices, this.skeleton.joints.length);
            }
            return actor;
        }

        const actor = new Actor(this.mesh);
        const subCount = this.mesh.submeshes.length;
        const activeShaders = (shader as ShaderGPU | ShaderGPU[] | undefined) ?? this.shaders;

        for (let s = 0; s < subCount; s++) {
            const sh = (Array.isArray(activeShaders) ? activeShaders[s] : activeShaders) ?? this.shaders[s];
            if (!sh) continue;

            const p = this.params[s];
            const paramCopy = p ? {
                floats: p.floats ? { ...p.floats } : undefined,
                vectors: p.vectors ? { ...p.vectors } : undefined,
                textures: p.textures ? { ...p.textures } : undefined,
                samplers: p.samplers ? { ...p.samplers } : undefined,
            } : null;

            actor.addPass(sh, s, paramCopy);
        }

        if (this.skeleton) {
            const jointMatrices = this.skeleton.computeJointMatrices();
            actor.setSkin(jointMatrices, this.skeleton.joints.length);
        }

        return actor;
    }

    /**
     * Disposes underlying GPU mesh, texture, and pipeline resources.
     */
    override destroy(): void {
        this.mesh.destroy();
        for (const tex of this.textures) {
            tex.destroy();
        }
        for (const sh of this.shaders) {
            sh?.destroy();
        }
    }
}
