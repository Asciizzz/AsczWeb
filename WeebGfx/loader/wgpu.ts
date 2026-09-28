import { MeshWGPU } from "../wgpu/mesh.js";
import { TextureWGPU } from "../wgpu/texture.js";
import { ShaderWGPU } from "../wgpu/shader.js";
import {
    ShaderGraphWGPU,
    InputVertexNode,
    OutputVertexNode,
    OutputFragmentNode,
    WorldTransformNode,
    SkinTransformNode,
    CameraNode,
    Vec4Node,
    TextureNode,
    SamplerNode,
    SampleTextureNode,
    MultiplyNode,
} from "../wgpu/shadergraph/index.js";
import { Actor, type ActorOptions } from "../actor.js";
import type { ShaderParams } from "../types.js";
import type { SkeletonCPU } from "../skeleton.js";
import { ModelGPU, type ModelCPU, type MaterialData } from "./model.js";

export interface ModelWGPUOptions {
    /** Target render pass color format. Defaults to "bgra8unorm". */
    targetFormat?: GPUTextureFormat;
    /** Depth attachment format (e.g. "depth24plus"). If specified, enables depth testing and writes. */
    depthFormat?: GPUTextureFormat;
    /** Primitive face cull mode. Defaults to "none". */
    cullMode?: GPUCullMode;
    /** Custom shader per material index or single fallback shader. */
    shaders?: ShaderWGPU | (ShaderWGPU | null)[];
    /** Custom sampler descriptor for loaded textures. */
    samplerDescriptor?: GPUSamplerDescriptor;
}


/**
 * WebGPU hardware implementation of ModelGPU.
 * Allocates native vertex/index buffers, textures, compiled pipeline shaders, and stamps independent Actors.
 */
export class ModelWGPU extends ModelGPU {
    name?: string;
    mesh: MeshWGPU;
    textures: TextureWGPU[];
    materials: MaterialData[];
    shaders: ShaderWGPU[];
    params: ShaderParams[];
    skeleton?: SkeletonCPU;
    device: GPUDevice;

    constructor(
        device: GPUDevice,
        mesh: MeshWGPU,
        textures: TextureWGPU[],
        materials: MaterialData[],
        shaders: ShaderWGPU[],
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
     * Compiles standard shader graph pipeline for unskinned or skinned models.
     */
    private static _compileDefaultShader(
        device: GPUDevice,
        isSkinned: boolean,
        hasTexture: boolean,
        options?: ModelWGPUOptions
    ): ShaderWGPU {
        const graph = new ShaderGraphWGPU();

        const inPos = new InputVertexNode("in_pos", "position", "float32x3");
        const inNorm = new InputVertexNode("in_norm", "normal", "float32x3");
        const inUv = new InputVertexNode("in_uv", "uv", "float32x2");

        if (isSkinned) {
            const inJoints = new InputVertexNode("in_joints", "joints", "uint32x4");
            const inWeights = new InputVertexNode("in_weights", "weights", "float32x4");
            graph.chainVertexInputs(inPos, inNorm, inUv, inJoints, inWeights);

            const skinNode = new SkinTransformNode("skin_tx");
            graph.addNode(skinNode);
            graph.connect("in_pos", "data", "skin_tx", "in_position");
            graph.connect("in_norm", "data", "skin_tx", "in_normal");
            graph.connect("in_joints", "data", "skin_tx", "in_joints");
            graph.connect("in_weights", "data", "skin_tx", "in_weights");

            const cam = new CameraNode("cam");
            const mvp = new MultiplyNode("mvp", "vec4<f32>");
            const outV = new OutputVertexNode("out_v");

            graph.addNode(cam);
            graph.addNode(mvp);
            graph.addNode(outV);

            graph.connect("cam", "viewProj", "mvp", "a");
            graph.connect("skin_tx", "out_position", "mvp", "b");
            graph.connect("mvp", "res", "out_v", "clipPosition");
        } else {
            graph.chainVertexInputs(inPos, inNorm, inUv);

            const worldNode = new WorldTransformNode("world_tx");
            graph.addNode(worldNode);
            graph.connect("in_pos", "data", "world_tx", "in_position");
            graph.connect("in_norm", "data", "world_tx", "in_normal");

            const cam = new CameraNode("cam");
            const mvp = new MultiplyNode("mvp", "vec4<f32>");
            const outV = new OutputVertexNode("out_v");

            graph.addNode(cam);
            graph.addNode(mvp);
            graph.addNode(outV);

            graph.connect("cam", "viewProj", "mvp", "a");
            graph.connect("world_tx", "out_position", "mvp", "b");
            graph.connect("mvp", "res", "out_v", "clipPosition");
        }

        const colorNode = new Vec4Node("u_baseColor", [1, 1, 1, 1], true, "baseColor");
        const outF = new OutputFragmentNode("out_f");

        if (hasTexture) {
            const texNode = new TextureNode("u_albedo", undefined, "albedo");
            const smpNode = new SamplerNode("u_albedoSmp", undefined, "albedoSmp");
            const sampleNode = new SampleTextureNode("sample_albedo");
            const multColor = new MultiplyNode("mult_color", "vec4<f32>");

            graph.addNode(texNode);
            graph.addNode(smpNode);
            graph.addNode(sampleNode);
            graph.addNode(colorNode);
            graph.addNode(multColor);
            graph.addNode(outF);

            graph.connect("u_albedo", "texture", "sample_albedo", "texture");
            graph.connect("u_albedoSmp", "sampler", "sample_albedo", "sampler");
            graph.connect("in_uv", "data", "sample_albedo", "uv");
            graph.connect("sample_albedo", "color", "mult_color", "a");
            graph.connect("u_baseColor", "value", "mult_color", "b");
            graph.connect("mult_color", "res", "out_f", "color");
        } else {
            graph.addNode(colorNode);
            graph.addNode(outF);
            graph.connect("u_baseColor", "value", "out_f", "color");
        }

        return graph.compile(device, {
            targetFormat: options?.targetFormat ?? "bgra8unorm",
            depthFormat: options?.depthFormat,
            cullMode: options?.cullMode ?? "none",
        });
    }

    /**
     * Uploads ModelCPU geometry and textures to WebGPU hardware and compiles pipelines.
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

        const isSkinned = modelCpu.skeleton !== undefined;
        let cachedTexturedShader: ShaderWGPU | undefined;
        let cachedUntexturedShader: ShaderWGPU | undefined;

        const submeshCount = modelCpu.mesh.submeshes.length;
        const shaders: ShaderWGPU[] = [];
        const params: ShaderParams[] = [];

        for (let s = 0; s < submeshCount; s++) {
            const submesh = modelCpu.mesh.submeshes[s];
            const matIdx = submesh.materialIndex ?? s;
            const mat = modelCpu.materials[matIdx] ?? modelCpu.materials[0];

            const texIdx = mat?.baseColorTextureIndex;
            const hasTex = texIdx !== undefined && textures[texIdx] !== undefined;

            let shader: ShaderWGPU;
            if (options?.shaders) {
                if (Array.isArray(options.shaders)) {
                    shader = (options.shaders[matIdx] ?? options.shaders[s] ?? options.shaders[0]) as ShaderWGPU;
                } else {
                    shader = options.shaders;
                }
            } else {
                if (hasTex) {
                    if (!cachedTexturedShader) {
                        cachedTexturedShader = ModelWGPU._compileDefaultShader(device, isSkinned, true, options);
                    }
                    shader = cachedTexturedShader;
                } else {
                    if (!cachedUntexturedShader) {
                        cachedUntexturedShader = ModelWGPU._compileDefaultShader(device, isSkinned, false, options);
                    }
                    shader = cachedUntexturedShader;
                }
            }


            const baseColor = mat?.baseColorFactor ?? [1, 1, 1, 1];
            const p: ShaderParams = {
                vectors: { baseColor },
            };

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
    override createActor(options?: Partial<ActorOptions>): Actor {
        const actor = new Actor({
            mesh: this.mesh,
            shaders: this.shaders,
            params: this.params.map((p) => ({
                floats: p.floats ? { ...p.floats } : undefined,
                vectors: p.vectors ? { ...p.vectors } : undefined,
                textures: p.textures ? { ...p.textures } : undefined,
                samplers: p.samplers ? { ...p.samplers } : undefined,
            })),
            ...options,
        });

        if (this.skeleton && !options?.skin) {
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
            sh.destroy();
        }
    }
}
