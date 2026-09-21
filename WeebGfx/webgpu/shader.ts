import { RenderPipeline } from "@asciiz/atoolkit/awgpu_old/pipeline.js";
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
 * WebGPU implementation of ShaderGPU utilizing RenderPipeline.
 */
export class ShaderWGPU extends ShaderGPU {
    pipeline: RenderPipeline;
    bindGroupLayouts: GPUBindGroupLayout[];
    wgslCode: string;
    paramBindings?: ParamBindingsWGPU;

    constructor(
        pipeline: RenderPipeline,
        bindGroupLayouts: GPUBindGroupLayout[],
        wgslCode: string,
        defaultParams: ShaderParams = {},
        paramBindings?: ParamBindingsWGPU
    ) {
        super(defaultParams, wgslCode);
        this.pipeline = pipeline;
        this.bindGroupLayouts = bindGroupLayouts;
        this.wgslCode = wgslCode;
        this.paramBindings = paramBindings;
    }
}
