import { RasterPipeline, BindLayout } from "@asciiz/atoolkit/awgpu";
import { ShaderGPU } from "../shader.js";
import type { ShaderParams } from "../types.js";

export interface ParamBindingsWGPU {
    hasMaterialUniform: boolean;
    floats: string[];
    vectors: string[];
    textures: string[];
    samplers: string[];
    depthTextures?: string[];
    comparisonSamplers?: string[];
}

/**
 * Frequency-slotted layout metadata describing which group indices are occupied
 * by camera, material, and entity uniform bindings.
 */
export interface ShaderGroupMetaWGPU {
    cameraGroupIndex?: number;
    materialGroupIndex?: number;
    instanceGroupIndex?: number;
    skinGroupIndex?: number;
    hasCamera: boolean;
    hasMaterial: boolean;
    hasTransform: boolean;
    hasSkin: boolean;
    hasFragment?: boolean;

    /** Backward compatibility alias for instanceGroupIndex. */
    entityGroupIndex?: number;
    /** Backward compatibility alias for hasTransform. */
    hasEntityTransform?: boolean;
}

/**
 * Fixed-function raster pipeline configuration metadata.
 */
export interface PipelineConfigWGPU {
    cullMode?: GPUCullMode;
    frontFace?: GPUFrontFace;
    topology?: GPUPrimitiveTopology;
    blend?: GPUBlendState;
    depthWriteEnabled?: boolean;
    depthCompare?: GPUCompareFunction;
    order?: number;
}

export interface CreateShaderOptionsWGPU {
    code: string;
    vertexLayout?: import("../types.js").VertexLayout;
    defaultParams?: ShaderParams;
    paramBindings?: ParamBindingsWGPU;
    meta?: Partial<ShaderGroupMetaWGPU>;
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
    label?: string;
}

/**
 * WebGPU implementation of ShaderGPU wrapping RasterPipeline and bind layouts.
 */
export class ShaderWGPU extends ShaderGPU {
    pipeline: RasterPipeline;
    bindGroupLayouts: GPUBindGroupLayout[];
    bindLayouts?: BindLayout[];
    wgslCode: string;
    paramBindings?: ParamBindingsWGPU;
    meta: ShaderGroupMetaWGPU;
    pipelineConfig?: PipelineConfigWGPU;

    constructor(
        pipeline: RasterPipeline,
        bindGroupLayouts: GPUBindGroupLayout[],
        wgslCode: string,
        defaultParams: ShaderParams = {},
        paramBindings?: ParamBindingsWGPU,
        meta?: Partial<ShaderGroupMetaWGPU>,
        bindLayouts?: BindLayout[],
        order: number = 0,
        pipelineConfig?: PipelineConfigWGPU
    ) {
        super(defaultParams, wgslCode, order);
        this.pipeline = pipeline;
        this.bindGroupLayouts = bindGroupLayouts;
        this.wgslCode = wgslCode;
        this.paramBindings = paramBindings;
        this.bindLayouts = bindLayouts;
        this.pipelineConfig = pipelineConfig;

        const instanceGroupIndex = meta?.instanceGroupIndex ?? meta?.entityGroupIndex ?? 2;
        const hasTransform = meta?.hasTransform ?? meta?.hasEntityTransform ?? (wgslCode.includes("u_instances") || wgslCode.includes("InstanceData") || wgslCode.includes("u_entity") || wgslCode.includes("EntityUniforms"));

        this.meta = {
            hasCamera: meta?.hasCamera ?? (wgslCode.includes("u_camera") || wgslCode.includes("CameraUniforms")),
            hasMaterial: meta?.hasMaterial ?? (wgslCode.includes("u_material") || (paramBindings && (paramBindings.hasMaterialUniform || paramBindings.textures.length > 0 || paramBindings.samplers.length > 0)) || false),
            hasTransform,
            hasEntityTransform: hasTransform,
            hasSkin: meta?.hasSkin ?? (wgslCode.includes("u_skin") || wgslCode.includes("SkinUniforms")),
            cameraGroupIndex: meta?.cameraGroupIndex ?? 0,
            materialGroupIndex: meta?.materialGroupIndex ?? 1,
            instanceGroupIndex,
            entityGroupIndex: instanceGroupIndex,
            skinGroupIndex: meta?.skinGroupIndex ?? 3,
        };
    }

    /**
     * Returns the native GPURenderPipeline handle.
     */
    get native(): GPURenderPipeline {
        return this.pipeline.native;
    }

    /**
     * Compatibility alias returning the native GPURenderPipeline handle.
     */
    get gpuPipeline(): GPURenderPipeline {
        return this.pipeline.native;
    }

    /**
     * Creates a hardware ShaderWGPU pipeline directly from WGSL code and configuration.
     * Maps camera, material, and instance storage to standard engine binding slots.
     */
    static create(device: GPUDevice, options: CreateShaderOptionsWGPU): ShaderWGPU {
        const label = options.label ?? "ShaderWGPU";
        const code = options.code;
        const vertexLayout = options.vertexLayout ?? { arrayStride: 0, attributes: [] };
        const defaultParams = options.defaultParams ?? {};
        const paramBindings = options.paramBindings;
        const meta = options.meta;

        const hasCamera = meta?.hasCamera ?? (code.includes("u_camera") || code.includes("CameraUniforms"));
        const hasTransform = meta?.hasTransform ?? meta?.hasEntityTransform ?? (code.includes("u_instances") || code.includes("InstanceData"));
        const hasSkin = meta?.hasSkin ?? (code.includes("u_skin") || code.includes("SkinUniforms"));
        const hasMaterial = meta?.hasMaterial ?? (code.includes("u_material") || (paramBindings && (paramBindings.hasMaterialUniform || paramBindings.textures.length > 0 || paramBindings.samplers.length > 0)) || false);

        const STAGE_VERTEX = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.VERTEX : 1;
        const STAGE_FRAGMENT = typeof GPUShaderStage !== "undefined" ? GPUShaderStage.FRAGMENT : 2;

        const bindLayouts: BindLayout[] = [];

        // Group 0: Camera uniforms (Slot 0)
        if (hasCamera) {
            bindLayouts.push(
                BindLayout.builder()
                    .addUniform(0, STAGE_VERTEX | STAGE_FRAGMENT, { minBindingSize: 208 })
                    .build(device, `${label}_Group0_CameraLayout`)
            );
        } else {
            bindLayouts.push(BindLayout.builder().build(device, `${label}_Group0_EmptyLayout`));
        }

        // Group 1: Material parameters, textures, samplers (Slot 1)
        const matBuilder = BindLayout.builder();
        let b1 = 0;
        if (paramBindings?.hasMaterialUniform) {
            const numFloats = paramBindings.floats.length;
            const numVecs = paramBindings.vectors.length;
            const totalFloats = numFloats + numVecs * 4;
            const byteSize = Math.max(16, Math.ceil((totalFloats * 4) / 16) * 16);
            matBuilder.addUniform(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { minBindingSize: byteSize });
        }
        if (paramBindings?.textures) {
            const depthSet = new Set(paramBindings.depthTextures ?? []);
            for (const texName of paramBindings.textures) {
                const sampleType = depthSet.has(texName) ? "depth" : "float";
                matBuilder.addTexture(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { sampleType });
            }
        }
        if (paramBindings?.samplers) {
            const compSet = new Set(paramBindings.comparisonSamplers ?? []);
            for (const smpName of paramBindings.samplers) {
                const comparison = compSet.has(smpName);
                matBuilder.addSampler(b1++, STAGE_VERTEX | STAGE_FRAGMENT, { comparison });
            }
        }
        bindLayouts.push(matBuilder.build(device, `${label}_Group1_MaterialLayout`));

        // Group 2: Instance Transform Storage Buffer (Slot 2)
        if (hasTransform) {
            bindLayouts.push(
                BindLayout.builder()
                    .addStorage(0, STAGE_VERTEX, { readOnly: true, hasDynamicOffset: true, minBindingSize: 128 })
                    .build(device, `${label}_Group2_InstanceLayout`)
            );
        }

        // Group 3: Skinning Joint Uniforms (Slot 3)
        if (hasSkin) {
            bindLayouts.push(
                BindLayout.builder()
                    .addUniform(0, STAGE_VERTEX, { minBindingSize: 64 * 64 })
                    .build(device, `${label}_Group3_SkinLayout`)
            );
        }

        const rawBindGroupLayouts = bindLayouts.map((l) => l.native);

        const vertexBuffers: GPUVertexBufferLayout[] = vertexLayout.attributes.length > 0
            ? [{
                  arrayStride: vertexLayout.arrayStride,
                  stepMode: (vertexLayout.stepMode as GPUVertexStepMode) ?? "vertex",
                  attributes: vertexLayout.attributes.map((a) => ({
                      shaderLocation: a.shaderLocation,
                      offset: a.offset,
                      format: a.format as GPUVertexFormat,
                  })),
              }]
            : [];

        const hasFragment = (options.hasFragment ?? (code.includes("@fragment") || code.includes("fs_main"))) && options.targetFormat !== null;
        const targetFormat = (options.targetFormat ?? "bgra8unorm") as GPUTextureFormat;

        const rasterPipeline = RasterPipeline.create(device, {
            label: `${label}_RasterPipeline`,
            layouts: bindLayouts,
            vertex: {
                code,
                entryPoint: "vs_main",
                buffers: vertexBuffers,
            },
            fragment: hasFragment
                ? {
                      code,
                      entryPoint: "fs_main",
                      targets: [{ format: targetFormat, blend: options.blend }],
                  }
                : undefined,
            primitive: {
                topology: options.topology ?? "triangle-list",
                cullMode: options.cullMode ?? "none",
                frontFace: options.frontFace ?? "ccw",
            },
            depthStencil: options.depthFormat
                ? {
                      format: options.depthFormat,
                      depthWriteEnabled: options.depthWriteEnabled ?? true,
                      depthCompare: options.depthCompare ?? "less",
                  }
                : undefined,
            onShaderMessage: (msg) => {
                if (msg.type === "error") {
                    console.error(`[${label} Error] ${msg.stage} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                } else if (msg.type === "warning") {
                    console.warn(`[${label} Warning] ${msg.stage} line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
                }
            },
        });

        return new ShaderWGPU(
            rasterPipeline,
            rawBindGroupLayouts,
            code,
            defaultParams,
            paramBindings,
            {
                hasCamera,
                hasMaterial,
                hasTransform,
                hasSkin,
                hasFragment,
                cameraGroupIndex: 0,
                materialGroupIndex: 1,
                instanceGroupIndex: 2,
                entityGroupIndex: 2,
                skinGroupIndex: 3,
                ...meta,
            },
            bindLayouts,
            options.order ?? 0,
            {
                cullMode: options.cullMode,
                frontFace: options.frontFace,
                topology: options.topology,
                blend: options.blend,
                depthWriteEnabled: options.depthWriteEnabled,
                depthCompare: options.depthCompare,
                order: options.order,
            }
        );
    }
}
