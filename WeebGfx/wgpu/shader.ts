import { RasterPipeline, BindLayout } from "@asciiz/atoolkit/awgpu";
import { ShaderGPU } from "../shader.js";
import type { ShaderParams } from "../types.js";

export interface ParamBindingsWGPU {
    hasMaterialUniform: boolean;
    floats: string[];
    vectors: string[];
    textures: string[];
    samplers: string[];
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
}
