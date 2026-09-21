import { RenderPipeline } from "@asciiz/atoolkit/awgpu_old/pipeline.js";
import type {
    VertexLayout,
    VertexAttribute,
    VertexFormat,
    ShaderParams,
} from "../../types.js";
import { VERTEX_FORMAT_SIZES } from "../../types.js";
import { ShaderWGPU, type ParamBindingsWGPU } from "../shader.js";
import type { Node, Connection, WgslDataType } from "./types.js";
import {
    InputVertexNode,
    OutputVertexNode,
    OutputFragmentNode,
    EntityTransformNode,
    SampleTextureNode,
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
} from "./nodes.js";

const STAGE_VERTEX = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.VERTEX : 1;
const STAGE_FRAGMENT = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.FRAGMENT : 2;

const RESERVED_WGSL_KEYWORDS = new Set([
    "array", "atomic", "bool", "f32", "f16", "i32", "u32", "mat2x2", "mat3x3", "mat4x4",
    "vec2", "vec3", "vec4", "ptr", "sampler", "texture_2d", "struct", "fn", "var", "let",
    "const", "if", "else", "for", "while", "loop", "break", "continue", "return", "discard",
    "true", "false", "uniform", "storage", "read", "write", "read_write",
    "in", "out", "u_entity", "u_camera", "u_material",
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
}

/**
 * WebGPU-specific unified shader graph compiler.
 * Directly compiles a vertex-fragment graph into WGSL and instantiates RenderPipeline.
 */
export class ShaderGraphWGPU {
    nodes: Map<string, Node> = new Map();
    connections: Connection[] = [];

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
            if (n.type === "OutputVertex" || n.type === "InputVertex" || n.type === "EntityTransform") {
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

        // Trace backward from OutputFragment
        const fragmentQueue: string[] = [];
        for (const n of this.nodes.values()) {
            if (n.type === "OutputFragment") {
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

        const hasEntityTransform = Array.from(this.nodes.values()).some((n) => n.type === "EntityTransform");
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
        codeLines.push("struct VertexInput {");
        for (const attr of layout.attributes) {
            codeLines.push(`    @location(${attr.shaderLocation}) ${attr.name}: ${this._formatToWGSL(attr.format)},`);
        }
        codeLines.push("};");
        codeLines.push("");

        // VertexOutput struct
        codeLines.push("struct VertexOutput {");
        codeLines.push("    @builtin(position) clipPosition: vec4<f32>,");
        for (const v of varyings) {
            codeLines.push(`    @location(${v.location}) ${v.varyingName}: ${v.dataType},`);
        }
        codeLines.push("};");
        codeLines.push("");

        // Group 0: Frame & Entity Bindings
        let group0Bindings = 0;
        if (hasEntityTransform) {
            codeLines.push("struct EntityUniforms {");
            codeLines.push("    modelMatrix: mat4x4<f32>,");
            codeLines.push("    normalMatrix: mat4x4<f32>,");
            codeLines.push("};");
            codeLines.push(`@group(0) @binding(${group0Bindings++}) var<uniform> u_entity: EntityUniforms;`);
        }
        if (hasCamera) {
            codeLines.push("struct CameraUniforms {");
            codeLines.push("    viewMatrix: mat4x4<f32>,");
            codeLines.push("    projMatrix: mat4x4<f32>,");
            codeLines.push("    viewProjMatrix: mat4x4<f32>,");
            codeLines.push("    cameraPosition: vec3<f32>,");
            codeLines.push("    _pad: f32,");
            codeLines.push("};");
            codeLines.push(`@group(0) @binding(${group0Bindings++}) var<uniform> u_camera: CameraUniforms;`);
        }
        codeLines.push("");

        // Group 1: Material & Parameter Bindings
        let group1Bindings = 0;
        const hasMaterialUniform = paramFloats.length > 0 || paramVec4s.length > 0;
        if (hasMaterialUniform) {
            codeLines.push("struct MaterialParams {");
            for (const f of paramFloats) {
                codeLines.push(`    ${f}: f32,`);
            }
            for (const v of paramVec4s) {
                codeLines.push(`    ${v}: vec4<f32>,`);
            }
            codeLines.push("};");
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var<uniform> u_material: MaterialParams;`);
        }

        for (const tex of paramTextures) {
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var u_${tex.paramName}: texture_2d<f32>;`);
        }
        for (const smp of paramSamplers) {
            codeLines.push(`@group(1) @binding(${group1Bindings++}) var u_${smp.paramName}: sampler;`);
        }
        codeLines.push("");

        const getNodeOutputExpr = (nodeId: string, socketId: string): string => {
            const fromNode = this.nodes.get(nodeId);
            if (!fromNode) return "vec4<f32>(1.0, 1.0, 1.0, 1.0)";

            if (fromNode instanceof InputVertexNode) {
                return `in.${fromNode.attributeName}`;
            }
            if (fromNode instanceof EntityTransformNode) {
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
            return `${fromNode.id}_out`;
        };

        const getExpr = (toNodeId: string, toSocketId: string, currentStage: "vertex" | "fragment"): string => {
            const conn = this.connections.find((c) => c.toNodeId === toNodeId && c.toSocketId === toSocketId);
            if (!conn) {
                return "vec4<f32>(1.0, 1.0, 1.0, 1.0)";
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

        // Emit vs_main
        codeLines.push("@vertex");
        codeLines.push("fn vs_main(in: VertexInput) -> VertexOutput {");
        codeLines.push("    var out: VertexOutput;");

        const vertexNodes = this._getTopologicalStageNodes("vertex", nodeStages);
        for (const node of vertexNodes) {
            if (node instanceof EntityTransformNode) {
                const inPos = getExpr(node.id, "in_position", "vertex");
                const inNorm = getExpr(node.id, "in_normal", "vertex");
                codeLines.push(`    let ${node.id}_pos = (u_entity.modelMatrix * vec4<f32>(${inPos}, 1.0)).xyz;`);
                codeLines.push(`    let ${node.id}_norm = (u_entity.normalMatrix * vec4<f32>(${inNorm}, 0.0)).xyz;`);
            } else if (node instanceof MultiplyNode) {
                const a = getExpr(node.id, "a", "vertex");
                const b = getExpr(node.id, "b", "vertex");
                const connB = this.connections.find((c) => c.toNodeId === node.id && c.toSocketId === "b");
                const fromB = connB ? this.nodes.get(connB.fromNodeId) : undefined;
                const isBVec3 = fromB && (fromB instanceof EntityTransformNode || (fromB instanceof InputVertexNode && fromB.dataType === "vec3<f32>"));
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

        // Emit fs_main
        codeLines.push("@fragment");
        codeLines.push("fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {");

        const fragmentNodes = this._getTopologicalStageNodes("fragment", nodeStages);
        for (const node of fragmentNodes) {
            if (node instanceof SampleTextureNode) {
                const tex = getExpr(node.id, "texture", "fragment");
                const smp = getExpr(node.id, "sampler", "fragment");
                const uv = getExpr(node.id, "uv", "fragment");
                codeLines.push(`    let ${node.id}_out = textureSample(${tex}, ${smp}, ${uv});`);
            } else if (node instanceof MultiplyNode) {
                const a = getExpr(node.id, "a", "fragment");
                const b = getExpr(node.id, "b", "fragment");
                codeLines.push(`    let ${node.id}_out = ${a} * ${b};`);
            } else if (node instanceof AddNode) {
                const a = getExpr(node.id, "a", "fragment");
                const b = getExpr(node.id, "b", "fragment");
                codeLines.push(`    let ${node.id}_out = ${a} + ${b};`);
            } else if (node instanceof OutputFragmentNode) {
                const conn = this.connections.find((c) => c.toNodeId === node.id && c.toSocketId === "color");
                if (!conn) {
                    throw new Error(`OutputFragmentNode '${node.id}' has no incoming connection to 'color'!`);
                }
                const color = getExpr(node.id, "color", "fragment");
                codeLines.push(`    return ${color};`);
            }
        }

        codeLines.push("}");

        const paramBindings: ParamBindingsWGPU = {
            hasMaterialUniform,
            floats: paramFloats,
            vectors: paramVec4s,
            textures: paramTextures.map((t) => t.paramName),
            samplers: paramSamplers.map((s) => s.paramName),
        };

        return {
            wgslCode: codeLines.join("\n"),
            vertexLayout: layout,
            defaultParams,
            paramBindings,
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
                    queue.push(neighbor);
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
     * Compiles the graph into a ShaderWGPU pipeline utilizing Atoolkit/awgpu.
     */
    compile(
        device: GPUDevice,
        options: {
            targetFormat?: GPUTextureFormat;
            depthFormat?: GPUTextureFormat;
            cullMode?: GPUCullMode;
            blend?: GPUBlendState;
        } = {}
    ): ShaderWGPU {
        const { wgslCode, vertexLayout, defaultParams, paramBindings } = this.generateShaderSource();
        const targetFormat = options.targetFormat ?? "bgra8unorm";

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

        const hasEntityUniform = wgslCode.includes("u_entity");
        const hasCameraUniform = wgslCode.includes("u_camera") || wgslCode.includes("u_viewProj");
        const hasMaterialUniform = wgslCode.includes("u_material");

        const bindGroupLayouts: GPUBindGroupLayout[] = [];

        // Group 0: Frame / Entity Uniforms
        const group0Entries: GPUBindGroupLayoutEntry[] = [];
        let b0 = 0;
        if (hasEntityUniform) {
            group0Entries.push({
                binding: b0++,
                visibility: STAGE_VERTEX,
                buffer: { type: "uniform" },
            });
        }
        if (hasCameraUniform) {
            group0Entries.push({
                binding: b0++,
                visibility: STAGE_VERTEX | STAGE_FRAGMENT,
                buffer: { type: "uniform" },
            });
        }
        bindGroupLayouts.push(
            device.createBindGroupLayout({
                label: "WeebGfx_WebGPU_Group0_Layout",
                entries: group0Entries,
            })
        );

        // Group 1: Material Parameters
        const group1Entries: GPUBindGroupLayoutEntry[] = [];
        let b1 = 0;
        if (hasMaterialUniform) {
            group1Entries.push({
                binding: b1++,
                visibility: STAGE_VERTEX | STAGE_FRAGMENT,
                buffer: { type: "uniform" },
            });
        }

        for (let i = 0; i < paramBindings.textures.length; i++) {
            group1Entries.push({
                binding: b1++,
                visibility: STAGE_VERTEX | STAGE_FRAGMENT,
                texture: { sampleType: "float" },
            });
        }

        for (let i = 0; i < paramBindings.samplers.length; i++) {
            group1Entries.push({
                binding: b1++,
                visibility: STAGE_VERTEX | STAGE_FRAGMENT,
                sampler: { type: "filtering" },
            });
        }

        bindGroupLayouts.push(
            device.createBindGroupLayout({
                label: "WeebGfx_WebGPU_Group1_Layout",
                entries: group1Entries,
            })
        );

        // Instantiate pipeline via RenderPipeline from Atoolkit/awgpu
        const awgpuPipeline = RenderPipeline.create(device, {
            label: "WeebGfx_Pipeline",
            bindGroupLayouts,
            vertex: {
                code: wgslCode,
                entryPoint: "vs_main",
                buffers: [gpuVertexBufferLayout],
            },
            fragment: {
                code: wgslCode,
                entryPoint: "fs_main",
                targets: [{ format: targetFormat, blend: options.blend }],
            },
            primitive: {
                topology: "triangle-list",
                cullMode: options.cullMode ?? "none",
            },
            depthStencil: options.depthFormat
                ? {
                      format: options.depthFormat,
                      depthWriteEnabled: true,
                      depthCompare: "less-equal",
                  }
                : undefined,
        });

        return new ShaderWGPU(awgpuPipeline, bindGroupLayouts, wgslCode, defaultParams, paramBindings);
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

