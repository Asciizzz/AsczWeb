import type { Bus } from "../adiag/index.js";

/**
 * Format byte size lookup table for automatic stride and offset derivation.
 */
const VERTEX_FORMAT_SIZES: Record<string, number> = {
    "float32": 4,
    "float32x2": 8,
    "float32x3": 12,
    "float32x4": 16,
    "uint32": 4,
    "uint32x2": 8,
    "uint32x4": 16,
    "sint32": 4,
    "sint32x2": 8,
    "sint32x4": 16,
    "unorm8x4": 4,
    "snorm8x4": 4,
    "uint8x4": 4,
    "sint8x4": 4,
    "unorm16x2": 4,
    "snorm16x2": 4,
    "uint16x2": 4,
    "sint16x2": 4,
    "unorm16x4": 8,
    "snorm16x4": 8,
    "uint16x4": 8,
    "sint16x4": 8,
    "float16x2": 4,
    "float16x4": 8,
};

export interface VertexAttributeDesc {
    shaderLocation: number;
    format: GPUVertexFormat;
    offset?: number;
}

/**
 * Derives GPUVertexBufferLayout with automatic cumulative offsets and 4-byte aligned arrayStride.
 */
export function createVertexLayout(
    attributes: VertexAttributeDesc[],
    stepMode: GPUVertexStepMode = "vertex"
): GPUVertexBufferLayout {
    let currentOffset = 0;
    const resolvedAttributes: GPUVertexAttribute[] = [];

    for (const attr of attributes) {
        const offset = attr.offset ?? currentOffset;
        resolvedAttributes.push({
            shaderLocation: attr.shaderLocation,
            format: attr.format,
            offset,
        });
        const size = VERTEX_FORMAT_SIZES[attr.format] ?? 4;
        currentOffset = offset + size;
    }

    // Array stride aligned to 4 bytes
    const arrayStride = Math.max(4, Math.ceil(currentOffset / 4) * 4);

    return {
        arrayStride,
        stepMode,
        attributes: resolvedAttributes,
    };
}

export interface ShaderMessage {
    type: "error" | "warning" | "info";
    stage: "vertex" | "fragment" | "compute";
    message: string;
    lineNum: number;
    linePos: number;
    offset: number;
    length: number;
}

function reportShaderMessages(
    module: GPUShaderModule,
    stage: "vertex" | "fragment" | "compute",
    label: string,
    onMessage?: (msg: ShaderMessage) => void,
    diag?: Bus
): void {
    module.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
            const shaderMsg: ShaderMessage = {
                type: msg.type as "error" | "warning" | "info",
                stage,
                message: msg.message,
                lineNum: msg.lineNum,
                linePos: msg.linePos,
                offset: msg.offset,
                length: msg.length,
            };

            onMessage?.(shaderMsg);

            if (msg.type === "error") {
                if (diag?.err) {
                    diag.err({
                        code: "SHADER_COMPILE_ERROR",
                        raw: "[$stage$] Shader compilation error in $label$ line $lineNum$:$linePos$: $message$",
                        data: { stage, label, lineNum: msg.lineNum, linePos: msg.linePos, message: msg.message },
                    });
                } else if (!onMessage) {
                    console.error(`[Pipeline] ${stage} shader error in ${label} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                }
            } else if (msg.type === "warning") {
                if (diag?.warn) {
                    diag.warn({
                        code: "SHADER_COMPILE_WARNING",
                        raw: "[$stage$] Shader compilation warning in $label$ line $lineNum$:$linePos$: $message$",
                        data: { stage, label, lineNum: msg.lineNum, linePos: msg.linePos, message: msg.message },
                    });
                } else if (!onMessage) {
                    console.warn(`[Pipeline] ${stage} shader warning in ${label} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                }
            } else if (msg.type === "info") {
                if (diag?.info) {
                    diag.info({
                        code: "SHADER_COMPILE_INFO",
                        raw: "[$stage$] Shader compilation info in $label$ line $lineNum$:$linePos$: $message$",
                        data: { stage, label, lineNum: msg.lineNum, linePos: msg.linePos, message: msg.message },
                    });
                }
            }
        }
    });
}

export interface RenderPipelineDescriptor {
    label?: string;
    layout?: GPUPipelineLayout | "auto";
    bindGroupLayouts?: (GPUBindGroupLayout | null | undefined)[];
    vertex: {
        code: string;
        entryPoint?: string;
        buffers?: GPUVertexBufferLayout[];
    };
    fragment?: {
        code?: string; // If omitted, defaults to vertex.code
        entryPoint?: string;
        targets: GPUColorTargetState[];
    };
    depthStencil?: GPUDepthStencilState;
    primitive?: GPUPrimitiveState;
    multisample?: GPUMultisampleState;
    onShaderMessage?: (msg: ShaderMessage) => void;
    diag?: Bus;
}

/**
 * WebGPU Render Pipeline wrapper supporting full shading as well as depth-only execution.
 */
export class RenderPipeline {
    readonly gpuPipeline: GPURenderPipeline;
    readonly label: string;
    readonly hasFragmentStage: boolean;

    constructor(gpuPipeline: GPURenderPipeline, hasFragmentStage: boolean, label = "RenderPipeline") {
        this.gpuPipeline = gpuPipeline;
        this.hasFragmentStage = hasFragmentStage;
        this.label = label;
    }

    /**
     * Factory: Compiles shaders and instantiates GPURenderPipeline.
     */
    static create(device: GPUDevice, descriptor: RenderPipelineDescriptor): RenderPipeline {
        const label = descriptor.label ?? "RenderPipeline";

        // 1. Vertex Shader Module
        const vsModule = device.createShaderModule({
            label: `${label}_VSModule`,
            code: descriptor.vertex.code,
        });
        reportShaderMessages(vsModule, "vertex", `${label}_VSModule`, descriptor.onShaderMessage, descriptor.diag);


        // 2. Pipeline Layout: explicit bind group layouts, custom layout, or auto
        let pipelineLayout: GPUPipelineLayout | "auto" = descriptor.layout ?? "auto";
        if (descriptor.bindGroupLayouts && descriptor.bindGroupLayouts.length > 0) {
            let emptyLayout: GPUBindGroupLayout | null = null;
            const sanitizedLayouts = descriptor.bindGroupLayouts.map((l) => {
                if (!l) {
                    if (!emptyLayout) {
                        emptyLayout = device.createBindGroupLayout({ label: `${label}_EmptySlotLayout`, entries: [] });
                    }
                    return emptyLayout;
                }
                return l;
            });
            pipelineLayout = device.createPipelineLayout({
                label: `${label}_PipelineLayout`,
                bindGroupLayouts: sanitizedLayouts,
            });
        }

        // 3. Build native descriptor
        const nativeDesc: GPURenderPipelineDescriptor = {
            label,
            layout: pipelineLayout,
            vertex: {
                module: vsModule,
                entryPoint: descriptor.vertex.entryPoint ?? "vs_main",
                buffers: descriptor.vertex.buffers ?? [],
            },
            primitive: descriptor.primitive ?? {
                topology: "triangle-list",
                cullMode: "back",
                frontFace: "ccw",
            },
        };

        if (descriptor.depthStencil) {
            nativeDesc.depthStencil = descriptor.depthStencil;
        }

        if (descriptor.multisample) {
            nativeDesc.multisample = descriptor.multisample;
        }

        // 4. Fragment Stage (Optional: omitted for depth-only passes such as z-prepasses or occluders)
        const hasFragmentStage = !!descriptor.fragment;
        if (descriptor.fragment) {
            const fsCode = descriptor.fragment.code ?? descriptor.vertex.code;
            const fsModule = fsCode === descriptor.vertex.code
                ? vsModule
                : device.createShaderModule({
                      label: `${label}_FSModule`,
                      code: fsCode,
                  });

            if (fsModule !== vsModule) {
                reportShaderMessages(fsModule, "fragment", `${label}_FSModule`, descriptor.onShaderMessage, descriptor.diag);
            }

            nativeDesc.fragment = {
                module: fsModule,
                entryPoint: descriptor.fragment.entryPoint ?? "fs_main",
                targets: descriptor.fragment.targets,
            };
        }

        const gpuPipeline = device.createRenderPipeline(nativeDesc);
        return new RenderPipeline(gpuPipeline, hasFragmentStage, label);
    }
}

/**
 * WebGPU Compute Pipeline wrapper for compute shaders.
 */
export class ComputePipeline {
    readonly gpuPipeline: GPUComputePipeline;
    readonly label: string;

    constructor(gpuPipeline: GPUComputePipeline, label = "ComputePipeline") {
        this.gpuPipeline = gpuPipeline;
        this.label = label;
    }

    /**
     * Factory: Compiles compute shader and instantiates GPUComputePipeline.
     */
    static create(
        device: GPUDevice,
        options: {
            code: string;
            entryPoint?: string;
            layout?: GPUPipelineLayout | "auto";
            bindGroupLayouts?: GPUBindGroupLayout[];
            label?: string;
            onShaderMessage?: (msg: ShaderMessage) => void;
            diag?: Bus;
        }
    ): ComputePipeline {
        const label = options.label ?? "ComputePipeline";

        const csModule = device.createShaderModule({
            label: `${label}_CSModule`,
            code: options.code,
        });
        reportShaderMessages(csModule, "compute", `${label}_CSModule`, options.onShaderMessage, options.diag);


        let pipelineLayout: GPUPipelineLayout | "auto" = options.layout ?? "auto";
        if (options.bindGroupLayouts && options.bindGroupLayouts.length > 0) {
            pipelineLayout = device.createPipelineLayout({
                label: `${label}_ComputeLayout`,
                bindGroupLayouts: options.bindGroupLayouts,
            });
        }

        const gpuPipeline = device.createComputePipeline({
            label,
            layout: pipelineLayout,
            compute: {
                module: csModule,
                entryPoint: options.entryPoint ?? "cs_main",
            },
        });

        return new ComputePipeline(gpuPipeline, label);
    }
}


