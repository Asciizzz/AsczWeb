import {
    RasterPipeline,
    BindLayout,
    BindLayoutBuilder,
    SlotFrequency,
} from "@asciiz/atoolkit/awgpu";
import type {
    VertexLayout,
    VertexAttribute,
    VertexFormat,
    ShaderParams,
} from "../../types.js";
import { VERTEX_FORMAT_SIZES } from "../../types.js";
import {
    ShaderWGPU,
    type ParamBindingsWGPU,
    type ShaderGroupMetaWGPU,
    type PipelineConfigWGPU,
} from "../shader.js";
import type { Node, Connection, WgslDataType } from "./types.js";
import {
    InputVertexNode,
    OutputVertexNode,
    OutputFragmentNode,
    FullscreenTriangleNode,
    WorldTransformNode,
    EntityTransformNode,
    SkinTransformNode,
    SampleTextureNode,
    SampleTextureCompareNode,
    TextureFetchNode,
    AddNode,
    MultiplyNode,
    UniformMatrixNode,
    CameraNode,
    FloatNode,
    Vec2Node,
    Vec3Node,
    Vec4Node,
    TextureNode,
    SamplerNode,
    DiscardNode,
    CompareNode,
    LogicNode,
    SplitVec4Node,
} from "./nodes/index.js";

const STAGE_VERTEX = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.VERTEX : 1;
const STAGE_FRAGMENT = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.FRAGMENT : 2;

const RESERVED_WGSL_KEYWORDS = new Set([
    "array", "atomic", "bool", "f32", "f16", "i32", "u32", "mat2x2", "mat3x3", "mat4x4",
    "vec2", "vec3", "vec4", "ptr", "sampler", "sampler_comparison", "texture_2d", "texture_depth_2d",
    "textureSampleCompare", "struct", "fn", "var", "let",
    "const", "if", "else", "for", "while", "loop", "break", "continue", "return", "discard",
    "true", "false", "uniform", "storage", "read", "write", "read_write",
    "in", "out", "u_entity", "u_instances", "InstanceData", "u_camera", "u_material",
]);

interface VaryingInfo {
    varyingName: string;
    location: number;
    dataType: WgslDataType;
    fromNodeId: string;
    fromSocketId: string;
}

export interface ShaderSourceWGPU {
    wgslCode: string;
    vertexLayout: VertexLayout;
    defaultParams: ShaderParams;
    paramBindings: ParamBindingsWGPU;
    meta: ShaderGroupMetaWGPU;
}

export type ShaderGraphConfigWGPU = PipelineConfigWGPU;

export interface CompileOptionsWGPU {
    targetFormat?: GPUTextureFormat | null;
    depthFormat?: GPUTextureFormat;
    hasFragment?: boolean;
    cullMode?: GPUCullMode;
    frontFace?: GPUFrontFace;
    topology?: GPUPrimitiveTopology;
    blend?: GPUBlendState;
    depthWriteEnabled?: boolean;
    depthCompare?: GPUCompareFunction;
    order?: number;
}

/**
 * Compiles a vertex-fragment node graph into WGSL source and initializes RasterPipeline.
 * Uses a four-frequency binding layout:
 * - Group 0: Frame and camera uniforms (PerFrame).
 * - Group 1: Material parameters and textures (PerBatch).
 * - Group 2: Instance storage buffer transforms (PerInstance).
 * - Group 3: Skeletal joint uniform array (PerInstance).
 */
export class ShaderGraphWGPU {
    nodes: Map<string, Node> = new Map();
    connections: Connection[] = [];

    cullMode: GPUCullMode = "back";
    frontFace: GPUFrontFace = "ccw";
    topology: GPUPrimitiveTopology = "triangle-list";
    blend?: GPUBlendState;
    depthWriteEnabled: boolean = true;
    depthCompare: GPUCompareFunction = "greater-equal";
    order: number = 0;

    constructor(config: ShaderGraphConfigWGPU = {}) {
        if (config.cullMode !== undefined) this.cullMode = config.cullMode;
        if (config.frontFace !== undefined) this.frontFace = config.frontFace;
        if (config.topology !== undefined) this.topology = config.topology;
        if (config.blend !== undefined) this.blend = config.blend;
        if (config.depthWriteEnabled !== undefined) this.depthWriteEnabled = config.depthWriteEnabled;
        if (config.depthCompare !== undefined) this.depthCompare = config.depthCompare;
        if (config.order !== undefined) this.order = config.order;
    }

    setCullMode(cullMode: GPUCullMode): this {
        this.cullMode = cullMode;
        return this;
    }

    setFrontFace(frontFace: GPUFrontFace): this {
        this.frontFace = frontFace;
        return this;
    }

    setTopology(topology: GPUPrimitiveTopology): this {
        this.topology = topology;
        return this;
    }

    setBlend(blend?: GPUBlendState): this {
        this.blend = blend;
        return this;
    }

    setDepthWriteEnabled(enabled: boolean): this {
        this.depthWriteEnabled = enabled;
        return this;
    }

    setDepthCompare(compare: GPUCompareFunction): this {
        this.depthCompare = compare;
        return this;
    }

    setOrder(order: number): this {
        this.order = order;
        return this;
    }

    addNode(node: Node): this {
        this.nodes.set(node.id, node);
        return this;
    }

    connect(
        fromNodeId: string,
        fromSocketId: string,
        toNodeId: string,
        toSocketId: string
    ): this {
        // Enforce single connection per input socket
        this.connections = this.connections.filter(
            (c) => !(c.toNodeId === toNodeId && c.toSocketId === toSocketId)
        );
        this.connections.push({ fromNodeId, fromSocketId, toNodeId, toSocketId });
        return this;
    }

    disconnect(toNodeId: string, toSocketId: string): this {
        this.connections = this.connections.filter(
            (c) => !(c.toNodeId === toNodeId && c.toSocketId === toSocketId)
        );
        return this;
    }

    removeNode(nodeId: string): this {
        this.nodes.delete(nodeId);
        this.connections = this.connections.filter(
            (c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId
        );
        return this;
    }

    /**
     * Ergonomic helper to chain a sequence of InputVertex nodes into a linear layout.
     */
    chainVertexInputs(...inputNodes: InputVertexNode[]): this {
        for (let i = 0; i < inputNodes.length; i++) {
            this.addNode(inputNodes[i]);
            if (i > 0) {
                this.connect(inputNodes[i - 1].id, "layoutOut", inputNodes[i].id, "layoutIn");
            }
        }
        return this;
    }

    /**
     * Resolves the ordered vertex layout by walking the InputVertex chain.
     */
    resolveVertexLayout(): VertexLayout {
        const inputNodes = Array.from(this.nodes.values()).filter(
            (n): n is InputVertexNode => n.type === "InputVertex"
        );

        if (inputNodes.length === 0) {
            return { arrayStride: 0, attributes: [] };
        }

        const targets = new Set(
            this.connections
                .filter((c) => c.toSocketId === "layoutIn")
                .map((c) => c.toNodeId)
        );
        const roots = inputNodes.filter((n) => !targets.has(n.id));
        const root = roots[0] ?? inputNodes[0];

        const ordered: InputVertexNode[] = [root];
        let current = root;
        while (true) {
            const nextConn = this.connections.find(
                (c) => c.fromNodeId === current.id && c.fromSocketId === "layoutOut"
            );
            if (!nextConn) break;
            const nextNode = this.nodes.get(nextConn.toNodeId) as InputVertexNode | undefined;
            if (!nextNode || ordered.includes(nextNode)) break;
            ordered.push(nextNode);
            current = nextNode;
        }

        let currentOffset = 0;
        const attributes: VertexAttribute[] = [];
        for (let i = 0; i < ordered.length; i++) {
            const node = ordered[i];
            attributes.push({
                name: node.attributeName,
                format: node.format,
                offset: currentOffset,
                shaderLocation: i,
            });
            const size = VERTEX_FORMAT_SIZES[node.format] ?? 4;
            currentOffset += size;
        }

        const arrayStride = Math.max(4, Math.ceil(currentOffset / 4) * 4);
        return { arrayStride, attributes, stepMode: "vertex" };
    }

    /**
     * Synthesizes WGSL source code and parameter metadata.
     */
    generateShaderSource(): ShaderSourceWGPU {
        const layout = this.resolveVertexLayout();

        // 1. Stage Inference
        const nodeStages = new Map<string, "vertex" | "fragment">();
        const incoming = new Map<string, Connection[]>();
        for (const conn of this.connections) {
            let list = incoming.get(conn.toNodeId);
            if (!list) {
                list = [];
                incoming.set(conn.toNodeId, list);
            }
            list.push(conn);
        }

        // Trace backward from OutputVertex
        const vertexQueue: string[] = [];
        for (const n of this.nodes.values()) {
            if (n.type === "OutputVertex" || n.type === "InputVertex" || n.type === "WorldTransform" || n.type === "EntityTransform" || n.type === "SkinTransform") {
                vertexQueue.push(n.id);
                nodeStages.set(n.id, "vertex");
            }
        }
        while (vertexQueue.length > 0) {
            const currId = vertexQueue.shift()!;
            const conns = incoming.get(currId) ?? [];
            for (const c of conns) {
                if (c.toSocketId === "layoutIn" || c.toSocketId === "layoutOut") continue;
                if (!nodeStages.has(c.fromNodeId)) {
                    nodeStages.set(c.fromNodeId, "vertex");
                    vertexQueue.push(c.fromNodeId);
                }
            }
        }

        // Trace backward from OutputFragment and Discard
        const fragmentQueue: string[] = [];
        for (const n of this.nodes.values()) {
            if (n.type === "OutputFragment" || n.type === "Discard") {
                fragmentQueue.push(n.id);
                nodeStages.set(n.id, "fragment");
            }
        }
        while (fragmentQueue.length > 0) {
            const currId = fragmentQueue.shift()!;
            const conns = incoming.get(currId) ?? [];
            for (const c of conns) {
                if (c.toSocketId === "layoutIn" || c.toSocketId === "layoutOut") continue;
                if (!nodeStages.has(c.fromNodeId)) {
                    nodeStages.set(c.fromNodeId, "fragment");
                    fragmentQueue.push(c.fromNodeId);
                }
            }
        }

        // 2. Identify Cross-Stage Connections (Auto-Varyings)
        const varyings: VaryingInfo[] = [];
        let nextVaryingLoc = 0;
        const varyingLookup = new Map<string, VaryingInfo>();

        for (const c of this.connections) {
            if (c.toSocketId === "layoutIn" || c.toSocketId === "layoutOut") continue;
            const fromStage = nodeStages.get(c.fromNodeId) ?? "vertex";
            const toStage = nodeStages.get(c.toNodeId) ?? "fragment";

            if (fromStage === "vertex" && toStage === "fragment") {
                const key = `${c.fromNodeId}_${c.fromSocketId}`;
                if (!varyingLookup.has(key)) {
                    const fromNode = this.nodes.get(c.fromNodeId)!;
                    const sock = fromNode.outputs.find((s) => s.id === c.fromSocketId);
                    const dataType = sock?.dataType ?? "vec4<f32>";
                    const info: VaryingInfo = {
                        varyingName: `v_${fromNode.id}_${c.fromSocketId}`,
                        location: nextVaryingLoc++,
                        dataType,
                        fromNodeId: c.fromNodeId,
                        fromSocketId: c.fromSocketId,
                    };
                    varyings.push(info);
                    varyingLookup.set(key, info);
                }
            }
        }

        const hasSkin = Array.from(this.nodes.values()).some((n) => n.type === "SkinTransform");
        const hasTransform = hasSkin || Array.from(this.nodes.values()).some((n) => n.type === "WorldTransform" || n.type === "EntityTransform");
        const hasEntityTransform = hasTransform;
        const hasCamera = Array.from(this.nodes.values()).some(
            (n) => n instanceof CameraNode || n instanceof UniformMatrixNode
        );

        const paramNames = new Map<string, { nodeId: string; type: string }>();
        const paramFloats: string[] = [];
        const paramVec4s: string[] = [];
        const paramTextures: TextureNode[] = [];
        const paramSamplers: SamplerNode[] = [];
        const defaultParams: ShaderParams = {
            floats: {},
            vectors: {},
            textures: {},
            samplers: {},
        };

        for (const n of this.nodes.values()) {
            if (!n.isParam) continue;
            const name = n.paramName ?? n.id;

            // 1. Parameter name cannot be empty
            if (!name || name.trim().length === 0) {
                throw new Error(
                    `[ShaderGraphWGPU] Parameter node '${n.id}' (${n.type}) has an empty parameter name!`
                );
            }

            // 2. Parameter name must be a valid WGSL identifier
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
                throw new Error(
                    `[ShaderGraphWGPU] Invalid parameter name '${name}' on node '${n.id}' (${n.type})! Parameter names must be alphanumeric identifiers (letters, digits, underscores) and cannot start with a digit.`
                );
            }

            // 3. Reserved keyword check
            if (RESERVED_WGSL_KEYWORDS.has(name)) {
                throw new Error(
                    `[ShaderGraphWGPU] Reserved keyword conflict! Parameter name '${name}' on node '${n.id}' (${n.type}) is a reserved keyword in WGSL. Choose a different name.`
                );
            }

            // 4. Strict Uniqueness Check across the entire shader graph
            const existing = paramNames.get(name);
            if (existing) {
                throw new Error(
                    `[ShaderGraphWGPU] Duplicate parameter name '${name}' detected! Node '${n.id}' (${n.type}) collides with node '${existing.nodeId}' (${existing.type}). All parameter names across floats, vectors, textures, and samplers must be strictly unique.`
                );
            }
            paramNames.set(name, { nodeId: n.id, type: n.type });

            if (n instanceof FloatNode) {
                paramFloats.push(name);
                defaultParams.floats![name] = n.value;
            } else if (n instanceof Vec4Node) {
                paramVec4s.push(name);
                defaultParams.vectors![name] = n.value;
            } else if (n instanceof TextureNode) {
                paramTextures.push(n);
                if (n.defaultValue) {
                    defaultParams.textures![name] = n.defaultValue;
                }
            } else if (n instanceof SamplerNode) {
                paramSamplers.push(n);
                if (n.defaultValue) {
                    defaultParams.samplers![name] = n.defaultValue as any;
                }
            }
        }

        // 3. Generate WGSL
        const codeLines: string[] = [];
        codeLines.push("// --- Generated by WeebGfx WebGPU Shader Compiler ---");

        // VertexInput struct
        if (layout.attributes.length > 0) {
            codeLines.push("struct VertexInput {");
            for (const attr of layout.attributes) {
                codeLines.push(`    @location(${attr.shaderLocation}) ${attr.name}: ${this._formatToWGSL(attr.format)},`);
            }
            codeLines.push("};");
            codeLines.push("");
        }

        // VertexOutput struct
        codeLines.push("struct VertexOutput {");
        codeLines.push("    @builtin(position) clipPosition: vec4<f32>,");
        for (const v of varyings) {
            codeLines.push(`    @location(${v.location}) ${v.varyingName}: ${v.dataType},`);
        }
        codeLines.push("};");
        codeLines.push("");

        // Group 0: Frame & Camera Uniforms (SlotFrequency.PerFrame)
        if (hasCamera) {
            codeLines.push("struct CameraUniforms {");
            codeLines.push("    viewMatrix: mat4x4<f32>,");
            codeLines.push("    projMatrix: mat4x4<f32>,");
            codeLines.push("    viewProjMatrix: mat4x4<f32>,");
            codeLines.push("    cameraPosition: vec3<f32>,");
            codeLines.push("    _pad: f32,");
            codeLines.push("};");
            codeLines.push("@group(0) @binding(0) var<uniform> u_camera: CameraUniforms;");
            codeLines.push("");
        }

        // Group 1: Material & Parameter Bindings (SlotFrequency.PerBatch)
        let group1Bindings = 0;
        const hasMaterialUniform = paramFloats.length > 0 || paramVec4s.length > 0;
        if (hasMaterialUniform) {
            codeLines.push("struct MaterialParams {");
            for (const v of paramVec4s) {
                codeLines.push(`    ${v}: vec4<f32>,`);
            }
            for (const f of paramFloats) {
                codeLines.push(`    ${f}: f32,`);
            }
            codeLines.push("};");
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var<uniform> u_material: MaterialParams;`);
        }

        for (const tex of paramTextures) {
            const texType = tex.isDepth ? "texture_depth_2d" : "texture_2d<f32>";
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var u_${tex.paramName}: ${texType};`);
        }
        for (const smp of paramSamplers) {
            const smpType = smp.isComparison ? "sampler_comparison" : "sampler";
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var u_${smp.paramName}: ${smpType};`);
        }
        if (group1Bindings > 0) {
            codeLines.push("");
        }

        // Group 2: Instance Transform Storage Buffer (SlotFrequency.PerInstance)
        if (hasTransform) {
            codeLines.push("struct InstanceData {");
            codeLines.push("    modelMatrix: mat4x4<f32>,");
            codeLines.push("    normalMatrix: mat4x4<f32>,");
            codeLines.push("};");
            codeLines.push("@group(2) @binding(0) var<storage, read> u_instances: array<InstanceData>;");
            codeLines.push("");
        }

        // Group 3: Skinning Joint Uniforms (SlotFrequency.PerInstance)
        if (hasSkin) {
            codeLines.push("struct SkinUniforms {");
            codeLines.push("    joints: array<mat4x4<f32>, 64>,");
            codeLines.push("};");
            codeLines.push("@group(3) @binding(0) var<uniform> u_skin: SkinUniforms;");
            codeLines.push("");
        }

        const getNodeOutputExpr = (nodeId: string, socketId: string): string => {
            const fromNode = this.nodes.get(nodeId);
            if (!fromNode) return "vec4<f32>(1.0, 1.0, 1.0, 1.0)";

            if (fromNode instanceof InputVertexNode) {
                return `in.${fromNode.attributeName}`;
            }
            if (fromNode instanceof WorldTransformNode || fromNode instanceof SkinTransformNode) {
                return socketId === "out_position" ? `${fromNode.id}_pos` : `${fromNode.id}_norm`;
            }
            if (fromNode instanceof FloatNode) {
                return fromNode.isParam ? `u_material.${fromNode.paramName}` : `${fromNode.value.toFixed(4)}`;
            }
            if (fromNode instanceof Vec4Node) {
                if (fromNode.isParam) return `u_material.${fromNode.paramName}`;
                const [r, g, b, a] = fromNode.value;
                return `vec4<f32>(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}, ${a.toFixed(4)})`;
            }
            if (fromNode instanceof TextureNode) {
                return `u_${fromNode.paramName}`;
            }
            if (fromNode instanceof SamplerNode) {
                return `u_${fromNode.paramName}`;
            }
            if (fromNode instanceof CameraNode) {
                switch (socketId) {
                    case "view":
                        return "u_camera.viewMatrix";
                    case "proj":
                        return "u_camera.projMatrix";
                    case "viewProj":
                        return "u_camera.viewProjMatrix";
                    case "position":
                        return "u_camera.cameraPosition";
                    default:
                        return "u_camera.viewProjMatrix";
                }
            }
            if (fromNode instanceof UniformMatrixNode) {
                return "u_camera.viewProjMatrix";
            }
            if (fromNode instanceof SplitVec4Node) {
                const ch = (socketId === "r" || socketId === "x") ? "x"
                    : (socketId === "g" || socketId === "y") ? "y"
                    : (socketId === "b" || socketId === "z") ? "z"
                    : "w";
                return `${fromNode.id}_out.${ch}`;
            }
            if (fromNode instanceof FullscreenTriangleNode) {
                return socketId === "clipPosition" ? `${fromNode.id}_pos` : `${fromNode.id}_uv`;
            }
            if (fromNode instanceof SampleTextureCompareNode) {
                return `${fromNode.id}_out`;
            }
            if (fromNode instanceof CompareNode || fromNode instanceof LogicNode) {
                return `${fromNode.id}_out`;
            }
            return `${fromNode.id}_out`;
        };

        const getExpr = (toNodeId: string, toSocketId: string, currentStage: "vertex" | "fragment"): string => {
            const conn = this.connections.find((c) => c.toNodeId === toNodeId && c.toSocketId === toSocketId);
            if (!conn) {
                const targetNode = this.nodes.get(toNodeId);
                const socket = targetNode?.inputs.find((s) => s.id === toSocketId);
                if (targetNode instanceof CompareNode && toSocketId === "b" && targetNode.defaultB !== undefined) {
                    return targetNode.defaultB.toFixed(4);
                }
                switch (socket?.dataType) {
                    case "bool":
                        return "false";
                    case "f32":
                        return "0.0";
                    case "vec2<f32>":
                        return "vec2<f32>(0.0, 0.0)";
                    case "vec3<f32>":
                        return "vec3<f32>(0.0, 0.0, 0.0)";
                    case "vec4<f32>":
                        return "vec4<f32>(1.0, 1.0, 1.0, 1.0)";
                    default:
                        return "vec4<f32>(1.0, 1.0, 1.0, 1.0)";
                }
            }

            const fromNode = this.nodes.get(conn.fromNodeId);
            if (fromNode instanceof CameraNode || fromNode instanceof UniformMatrixNode) {
                return getNodeOutputExpr(conn.fromNodeId, conn.fromSocketId);
            }

            const fromStage = nodeStages.get(conn.fromNodeId) ?? "vertex";
            if (currentStage === "fragment" && fromStage === "vertex") {
                const info = varyingLookup.get(`${conn.fromNodeId}_${conn.fromSocketId}`);
                if (info) return `in.${info.varyingName}`;
            }

            return getNodeOutputExpr(conn.fromNodeId, conn.fromSocketId);
        };

        const hasFullscreenTriangle = Array.from(this.nodes.values()).some(
            (n) => n instanceof FullscreenTriangleNode
        );

        // Emit vs_main
        codeLines.push("@vertex");
        if (hasFullscreenTriangle) {
            codeLines.push("fn vs_main(@builtin(vertex_index) vertex_idx: u32) -> VertexOutput {");
        } else if (layout.attributes.length > 0) {
            codeLines.push("fn vs_main(in: VertexInput, @builtin(instance_index) instance_idx: u32) -> VertexOutput {");
        } else {
            codeLines.push("fn vs_main(@builtin(instance_index) instance_idx: u32) -> VertexOutput {");
        }
        codeLines.push("    var out: VertexOutput;");

        const vertexNodes = this._getTopologicalStageNodes("vertex", nodeStages);
        for (const node of vertexNodes) {
            if (node instanceof WorldTransformNode) {
                const inPos = getExpr(node.id, "in_position", "vertex");
                codeLines.push(`    let ${node.id}_pos = (u_instances[instance_idx].modelMatrix * vec4<f32>(${inPos}, 1.0)).xyz;`);
                const hasNormConn = this.connections.some((c) => c.toNodeId === node.id && c.toSocketId === "in_normal");
                if (hasNormConn) {
                    const inNorm = getExpr(node.id, "in_normal", "vertex");
                    codeLines.push(`    let ${node.id}_norm = (u_instances[instance_idx].normalMatrix * vec4<f32>(${inNorm}, 0.0)).xyz;`);
                } else {
                    codeLines.push(`    let ${node.id}_norm = (u_instances[instance_idx].normalMatrix * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz;`);
                }
            } else if (node instanceof SkinTransformNode) {
                const inPos = getExpr(node.id, "in_position", "vertex");
                const inJoints = getExpr(node.id, "in_joints", "vertex");
                const inWeights = getExpr(node.id, "in_weights", "vertex");

                const connJoints = this.connections.find((c) => c.toNodeId === node.id && c.toSocketId === "in_joints");
                const fromJointsNode = connJoints ? this.nodes.get(connJoints.fromNodeId) : undefined;
                const isFloatJoints = fromJointsNode && fromJointsNode instanceof InputVertexNode && fromJointsNode.dataType === "vec4<f32>";
                const jx = isFloatJoints ? `u32(${inJoints}.x)` : `${inJoints}.x`;
                const jy = isFloatJoints ? `u32(${inJoints}.y)` : `${inJoints}.y`;
                const jz = isFloatJoints ? `u32(${inJoints}.z)` : `${inJoints}.z`;
                const jw = isFloatJoints ? `u32(${inJoints}.w)` : `${inJoints}.w`;

                codeLines.push(`    let ${node.id}_skin_mat =`);
                codeLines.push(`        ${inWeights}.x * u_skin.joints[${jx}] +`);
                codeLines.push(`        ${inWeights}.y * u_skin.joints[${jy}] +`);
                codeLines.push(`        ${inWeights}.z * u_skin.joints[${jz}] +`);
                codeLines.push(`        ${inWeights}.w * u_skin.joints[${jw}];`);
                codeLines.push(`    let ${node.id}_pos = (u_instances[instance_idx].modelMatrix * (${node.id}_skin_mat * vec4<f32>(${inPos}, 1.0))).xyz;`);

                const hasNormConn = this.connections.some((c) => c.toNodeId === node.id && c.toSocketId === "in_normal");
                if (hasNormConn) {
                    const inNorm = getExpr(node.id, "in_normal", "vertex");
                    codeLines.push(`    let ${node.id}_norm = (u_instances[instance_idx].normalMatrix * (${node.id}_skin_mat * vec4<f32>(${inNorm}, 0.0))).xyz;`);
                } else {
                    codeLines.push(`    let ${node.id}_norm = (u_instances[instance_idx].normalMatrix * (${node.id}_skin_mat * vec4<f32>(0.0, 1.0, 0.0, 0.0))).xyz;`);
                }
            } else if (node instanceof MultiplyNode) {
                const a = getExpr(node.id, "a", "vertex");
                const b = getExpr(node.id, "b", "vertex");
                const connB = this.connections.find((c) => c.toNodeId === node.id && c.toSocketId === "b");
                const fromB = connB ? this.nodes.get(connB.fromNodeId) : undefined;
                const bSocket = fromB?.outputs.find((s) => s.id === connB?.fromSocketId);
                const isBVec3 = fromB && (
                    bSocket?.dataType === "vec3<f32>" ||
                    fromB instanceof WorldTransformNode ||
                    fromB instanceof SkinTransformNode ||
                    (fromB instanceof InputVertexNode && fromB.dataType === "vec3<f32>") ||
                    (fromB instanceof AddNode && fromB.dataType === "vec3<f32>") ||
                    (fromB instanceof MultiplyNode && fromB.dataType === "vec3<f32>")
                );
                if (isBVec3 && node.dataType === "vec4<f32>") {
                    codeLines.push(`    let ${node.id}_out = ${a} * vec4<f32>(${b}, 1.0);`);
                } else {
                    codeLines.push(`    let ${node.id}_out = ${a} * ${b};`);
                }
            } else if (node instanceof AddNode) {
                const a = getExpr(node.id, "a", "vertex");
                const b = getExpr(node.id, "b", "vertex");
                codeLines.push(`    let ${node.id}_out = ${a} + ${b};`);
            } else if (node instanceof SampleTextureNode) {
                const tex = getExpr(node.id, "texture", "vertex");
                const smp = getExpr(node.id, "sampler", "vertex");
                const uv = getExpr(node.id, "uv", "vertex");
                codeLines.push(`    let ${node.id}_out = textureSampleLevel(${tex}, ${smp}, ${uv}, 0.0);`);
            } else if (node instanceof TextureFetchNode) {
                const tex = getExpr(node.id, "texture", "vertex");
                const coords = getExpr(node.id, "coords", "vertex");
                codeLines.push(`    let ${node.id}_out = textureLoad(${tex}, vec2<i32>(${coords}), 0);`);
            } else if (node instanceof SplitVec4Node) {
                const inVal = getExpr(node.id, "in", "vertex");
                codeLines.push(`    let ${node.id}_out = ${inVal};`);
            } else if (node instanceof CompareNode) {
                const a = getExpr(node.id, "a", "vertex");
                const b = getExpr(node.id, "b", "vertex");
                let opSymbol = "<";
                switch (node.op) {
                    case "less": opSymbol = "<"; break;
                    case "less_equal": opSymbol = "<="; break;
                    case "greater": opSymbol = ">"; break;
                    case "greater_equal": opSymbol = ">="; break;
                    case "equal": opSymbol = "=="; break;
                    case "not_equal": opSymbol = "!="; break;
                }
                codeLines.push(`    let ${node.id}_out = (${a} ${opSymbol} ${b});`);
            } else if (node instanceof LogicNode) {
                const a = getExpr(node.id, "a", "vertex");
                const b = getExpr(node.id, "b", "vertex");
                const opSym = node.op === "or" ? "||" : "&&";
                codeLines.push(`    let ${node.id}_out = (${a} ${opSym} ${b});`);
            } else if (node instanceof FullscreenTriangleNode) {
                codeLines.push(`    let ${node.id}_uv_raw = vec2<f32>(f32((vertex_idx << 1u) & 2u), f32(vertex_idx & 2u));`);
                codeLines.push(`    let ${node.id}_pos = vec4<f32>(${node.id}_uv_raw * 2.0 - 1.0, 0.0, 1.0);`);
                codeLines.push(`    let ${node.id}_uv = vec2<f32>(${node.id}_uv_raw.x, 1.0 - ${node.id}_uv_raw.y);`);
            } else if (node instanceof OutputVertexNode) {
                const conn = this.connections.find((c) => c.toNodeId === node.id && c.toSocketId === "clipPosition");
                if (!conn) {
                    throw new Error(`OutputVertexNode '${node.id}' has no incoming connection to 'clipPosition'!`);
                }
                const clipPos = getExpr(node.id, "clipPosition", "vertex");
                codeLines.push(`    out.clipPosition = ${clipPos};`);
            }
        }

        for (const v of varyings) {
            const expr = getNodeOutputExpr(v.fromNodeId, v.fromSocketId);
            codeLines.push(`    out.${v.varyingName} = ${expr};`);
        }

        codeLines.push("    return out;");
        codeLines.push("}");
        codeLines.push("");

        // Emit fs_main if OutputFragmentNode is present
        const fragmentNodes = this._getTopologicalStageNodes("fragment", nodeStages);
        let outputFragNode: OutputFragmentNode | undefined;
        for (const node of fragmentNodes) {
            if (node instanceof OutputFragmentNode) {
                outputFragNode = node;
                break;
            }
        }

        if (outputFragNode) {
            codeLines.push("@fragment");
            codeLines.push("fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {");

            for (const node of fragmentNodes) {
                if (node instanceof OutputFragmentNode) {
                    continue;
                } else if (node instanceof DiscardNode) {
                    const cond = getExpr(node.id, "condition", "fragment");
                    codeLines.push(`    if (${cond}) { discard; }`);
                } else if (node instanceof SplitVec4Node) {
                    const inVal = getExpr(node.id, "in", "fragment");
                    codeLines.push(`    let ${node.id}_out = ${inVal};`);
                } else if (node instanceof CompareNode) {
                    const a = getExpr(node.id, "a", "fragment");
                    const b = getExpr(node.id, "b", "fragment");
                    let opSymbol = "<";
                    switch (node.op) {
                        case "less": opSymbol = "<"; break;
                        case "less_equal": opSymbol = "<="; break;
                        case "greater": opSymbol = ">"; break;
                        case "greater_equal": opSymbol = ">="; break;
                        case "equal": opSymbol = "=="; break;
                        case "not_equal": opSymbol = "!="; break;
                    }
                    codeLines.push(`    let ${node.id}_out = (${a} ${opSymbol} ${b});`);
                } else if (node instanceof LogicNode) {
                    const a = getExpr(node.id, "a", "fragment");
                    const b = getExpr(node.id, "b", "fragment");
                    const opSym = node.op === "or" ? "||" : "&&";
                    codeLines.push(`    let ${node.id}_out = (${a} ${opSym} ${b});`);
                } else if (node instanceof SampleTextureNode) {
                    const tex = getExpr(node.id, "texture", "fragment");
                    const smp = getExpr(node.id, "sampler", "fragment");
                    const uv = getExpr(node.id, "uv", "fragment");
                    codeLines.push(`    let ${node.id}_out = textureSample(${tex}, ${smp}, ${uv});`);
                } else if (node instanceof SampleTextureCompareNode) {
                    const tex = getExpr(node.id, "texture", "fragment");
                    const smp = getExpr(node.id, "sampler", "fragment");
                    const uv = getExpr(node.id, "uv", "fragment");
                    const depthRef = getExpr(node.id, "depthRef", "fragment");
                    codeLines.push(`    let ${node.id}_out = textureSampleCompare(${tex}, ${smp}, ${uv}, ${depthRef});`);
                } else if (node instanceof MultiplyNode) {
                    const a = getExpr(node.id, "a", "fragment");
                    const b = getExpr(node.id, "b", "fragment");
                    codeLines.push(`    let ${node.id}_out = ${a} * ${b};`);
                } else if (node instanceof AddNode) {
                    const a = getExpr(node.id, "a", "fragment");
                    const b = getExpr(node.id, "b", "fragment");
                    codeLines.push(`    let ${node.id}_out = ${a} + ${b};`);
                }
            }

            const conn = this.connections.find((c) => c.toNodeId === outputFragNode!.id && c.toSocketId === "color");
            if (!conn) {
                throw new Error(`OutputFragmentNode '${outputFragNode.id}' has no incoming connection to 'color'!`);
            }
            const color = getExpr(outputFragNode.id, "color", "fragment");
            codeLines.push(`    return ${color};`);
            codeLines.push("}");
        }

        const paramBindings: ParamBindingsWGPU = {
            hasMaterialUniform,
            floats: paramFloats,
            vectors: paramVec4s,
            textures: paramTextures.map((t) => t.paramName),
            samplers: paramSamplers.map((s) => s.paramName),
        };

        const meta: ShaderGroupMetaWGPU = {
            hasCamera,
            hasMaterial: hasMaterialUniform || paramTextures.length > 0 || paramSamplers.length > 0,
            hasTransform,
            hasEntityTransform: hasTransform,
            hasSkin,
            hasFragment: !!outputFragNode,
            cameraGroupIndex: 0,
            materialGroupIndex: 1,
            instanceGroupIndex: 2,
            entityGroupIndex: 2,
            skinGroupIndex: 3,
        };

        return {
            wgslCode: codeLines.join("\n"),
            vertexLayout: layout,
            defaultParams,
            paramBindings,
            meta,
        };
    }

    private _getTopologicalStageNodes(
        stage: "vertex" | "fragment",
        nodeStages: Map<string, "vertex" | "fragment">
    ): Node[] {
        const stageNodes = Array.from(this.nodes.values()).filter((n) => nodeStages.get(n.id) === stage);
        const stageNodeIds = new Set(stageNodes.map((n) => n.id));

        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();

        for (const node of stageNodes) {
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
        }

        for (const conn of this.connections) {
            if (conn.toSocketId === "layoutIn" || conn.toSocketId === "layoutOut") continue;
            if (stageNodeIds.has(conn.fromNodeId) && stageNodeIds.has(conn.toNodeId)) {
                adj.get(conn.fromNodeId)!.push(conn.toNodeId);
                inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) ?? 0) + 1);
            }
        }

        const queue: string[] = [];
        for (const [id, deg] of inDegree.entries()) {
            if (deg === 0) {
                queue.push(id);
            }
        }

        const sorted: Node[] = [];
        while (queue.length > 0) {
            const currId = queue.shift()!;
            sorted.push(this.nodes.get(currId)!);

            for (const neighbor of adj.get(currId) ?? []) {
                const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) {
                    const neighborNode = this.nodes.get(neighbor);
                    if (neighborNode instanceof DiscardNode) {
                        queue.unshift(neighbor);
                    } else {
                        queue.push(neighbor);
                    }
                }
            }
        }

        for (const node of stageNodes) {
            if (!sorted.includes(node)) {
                sorted.push(node);
            }
        }

        return sorted;
    }

    /**
     * Compiles the graph into a ShaderWGPU pipeline utilizing Atoolkit/awgpu RasterPipeline.
     */
    compile(
        device: GPUDevice,
        options: CompileOptionsWGPU = {}
    ): ShaderWGPU {
        const { wgslCode, vertexLayout, defaultParams, paramBindings, meta } = this.generateShaderSource();
        const hasFragment = (options.hasFragment ?? (meta.hasFragment ?? true)) && options.targetFormat !== null;
        const targetFormat = (options.targetFormat ?? "bgra8unorm") as GPUTextureFormat;
        const cullMode = options.cullMode ?? this.cullMode;
        const frontFace = options.frontFace ?? this.frontFace;
        const topology = options.topology ?? this.topology;
        const blend = options.blend ?? this.blend;
        const depthWriteEnabled = options.depthWriteEnabled ?? this.depthWriteEnabled;
        const depthCompare = options.depthCompare ?? this.depthCompare;
        const order = options.order ?? this.order;

        // Derive WebGPU VertexBufferLayout
        const gpuVertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: vertexLayout.arrayStride,
            stepMode: vertexLayout.stepMode ?? "vertex",
            attributes: vertexLayout.attributes.map((a) => ({
                shaderLocation: a.shaderLocation,
                offset: a.offset,
                format: a.format as GPUVertexFormat,
            })),
        };

        const bindLayouts: BindLayout[] = [];

        // Group 0: Frame / Camera Uniforms (SlotFrequency.PerFrame)
        if (meta.hasCamera) {
            const cameraLayout = BindLayout.builder()
                .addUniform(0, STAGE_VERTEX | STAGE_FRAGMENT, { minBindingSize: 208 })
                .build(device, "WeebGfx_Group0_CameraLayout");
            bindLayouts.push(cameraLayout);
        } else {
            // Empty placeholder for slot 0 if unused but higher slots exist
            bindLayouts.push(BindLayout.builder().build(device, "WeebGfx_Group0_EmptyLayout"));
        }

        // Group 1: Material Parameters (SlotFrequency.PerBatch)
        const matBuilder = BindLayout.builder();
        let b1 = 0;
        if (paramBindings.hasMaterialUniform) {
            const numFloats = paramBindings.floats.length;
            const numVecs = paramBindings.vectors.length;
            const totalFloats = numFloats + numVecs * 4;
            const byteSize = Math.max(16, Math.ceil((totalFloats * 4) / 16) * 16);
            matBuilder.addUniform(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { minBindingSize: byteSize });
        }
        for (let i = 0; i < paramBindings.textures.length; i++) {
            const paramName = paramBindings.textures[i];
            const tNode = Array.from(this.nodes.values()).find(
                (n) => n instanceof TextureNode && n.paramName === paramName
            ) as TextureNode | undefined;
            const sampleType = tNode?.isDepth ? "depth" : "float";
            matBuilder.addTexture(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { sampleType });
        }
        for (let i = 0; i < paramBindings.samplers.length; i++) {
            const paramName = paramBindings.samplers[i];
            const sNode = Array.from(this.nodes.values()).find(
                (n) => n instanceof SamplerNode && n.paramName === paramName
            ) as SamplerNode | undefined;
            matBuilder.addSampler(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { comparison: sNode?.isComparison ?? false });
        }
        const materialLayout = matBuilder.build(device, "WeebGfx_Group1_MaterialLayout");
        bindLayouts.push(materialLayout);

        // Group 2: Instance Transform Storage Buffer (SlotFrequency.PerInstance with dynamic offset)
        if (meta.hasTransform) {
            const instanceLayout = BindLayout.builder()
                .addStorage(0, STAGE_VERTEX, { readOnly: true, hasDynamicOffset: true, minBindingSize: 128 })
                .build(device, "WeebGfx_Group2_InstanceLayout");
            bindLayouts.push(instanceLayout);
        }

        // Group 3: Skinning Joint Uniforms (SlotFrequency.PerInstance)
        if (meta.hasSkin) {
            const skinLayout = BindLayout.builder()
                .addUniform(0, STAGE_VERTEX, { minBindingSize: 64 * 64 })
                .build(device, "WeebGfx_Group3_SkinLayout");
            bindLayouts.push(skinLayout);
        }

        const rawBindGroupLayouts = bindLayouts.map((l) => l.native);

        const vertexBuffers: GPUVertexBufferLayout[] = vertexLayout.attributes.length > 0
            ? [gpuVertexBufferLayout]
            : [];

        // Instantiate pipeline via RasterPipeline from Atoolkit/awgpu
        const rasterPipeline = RasterPipeline.create(device, {
            label: "WeebGfx_RasterPipeline",
            layouts: bindLayouts,
            vertex: {
                code: wgslCode,
                entryPoint: "vs_main",
                buffers: vertexBuffers,
            },
            fragment: hasFragment
                ? {
                      code: wgslCode,
                      entryPoint: "fs_main",
                      targets: [{ format: targetFormat, blend }],
                  }
                : undefined,
            primitive: {
                topology,
                cullMode,
                frontFace,
            },
            depthStencil: options.depthFormat
                ? {
                      format: options.depthFormat,
                      depthWriteEnabled,
                      depthCompare,
                  }
                : undefined,
            onShaderMessage: (msg) => {
                if (msg.type === "error") {
                    console.error(`[ShaderGraphWGPU Error] ${msg.stage} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                } else if (msg.type === "warning") {
                    console.warn(`[ShaderGraphWGPU Warning] ${msg.stage} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                }
            },
        });

        return new ShaderWGPU(
            rasterPipeline,
            rawBindGroupLayouts,
            wgslCode,
            defaultParams,
            paramBindings,
            meta,
            bindLayouts,
            order,
            {
                cullMode,
                frontFace,
                topology,
                blend,
                depthWriteEnabled,
                depthCompare,
                order,
            }
        );
    }

    private _formatToWGSL(format: VertexFormat): string {
        switch (format) {
            case "float32":
                return "f32";
            case "float32x2":
                return "vec2<f32>";
            case "float32x3":
                return "vec3<f32>";
            case "float32x4":
                return "vec4<f32>";
            case "uint32":
                return "u32";
            case "uint32x2":
                return "vec2<u32>";
            case "uint32x4":
                return "vec4<u32>";
            case "sint32":
                return "i32";
            case "sint32x2":
                return "vec2<i32>";
            case "sint32x4":
                return "vec4<i32>";
            default:
                return "vec4<f32>";
        }
    }
}
