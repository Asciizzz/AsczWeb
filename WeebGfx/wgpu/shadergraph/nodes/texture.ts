import type { TextureGPU } from "../../../texture.js";
import type { Node, Socket } from "../types.js";

/**
 * 2D Texture node.
 * Paramable by default. If defaultValue is provided, it acts as the fallback default
 * when no texture is specified in the Actor's material params.
 */
export class TextureNode implements Node {
    id: string;
    type = "Texture";
    isParam: boolean;
    paramName: string;
    defaultValue?: TextureGPU;
    isDepth: boolean;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue?: TextureGPU,
        paramName?: string,
        isParam = true,
        isDepth = false
    ) {
        this.id = id;
        this.defaultValue = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined) ?? id;
        this.isDepth = isDepth;
        this.outputs = [
            {
                id: "texture",
                name: "texture",
                dataType: isDepth ? "texture_depth_2d" : "texture_2d<f32>",
                isInput: false,
            },
        ];
    }
}

/**
 * Sampler node.
 * Paramable by default. If defaultValue is provided, it acts as the fallback default
 * when no sampler is specified in the Actor's material params.
 */
export class SamplerNode implements Node {
    id: string;
    type = "Sampler";
    isParam: boolean;
    paramName: string;
    defaultValue?: GPUSampler | GPUSamplerDescriptor;
    isComparison: boolean;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue?: GPUSampler | GPUSamplerDescriptor,
        paramName?: string,
        isParam = true,
        isComparison = false
    ) {
        this.id = id;
        this.defaultValue = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined) ?? id;
        this.isComparison = isComparison;
        this.outputs = [
            {
                id: "sampler",
                name: "sampler",
                dataType: isComparison ? "sampler_comparison" : "sampler",
                isInput: false,
            },
        ];
    }
}

/**
 * Samples a 2D texture. In vertex stage, automatically generates textureSampleLevel(..., 0.0).
 */
export class SampleTextureNode implements Node {
    id: string;
    type = "SampleTexture";
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string) {
        this.id = id;
        this.inputs = [
            { id: "texture", name: "texture", dataType: "texture_2d<f32>", isInput: true },
            { id: "sampler", name: "sampler", dataType: "sampler", isInput: true },
            { id: "uv", name: "uv", dataType: "vec2<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "color", name: "color", dataType: "vec4<f32>", isInput: false },
        ];
    }
}

/**
 * Direct integer coordinate texel fetch using textureLoad.
 */
export class TextureFetchNode implements Node {
    id: string;
    type = "TextureFetch";
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string) {
        this.id = id;
        this.inputs = [
            { id: "texture", name: "texture", dataType: "texture_2d<f32>", isInput: true },
            { id: "coords", name: "coords", dataType: "vec2<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "color", name: "color", dataType: "vec4<f32>", isInput: false },
        ];
    }
}

/**
 * Samples a depth texture using a comparison sampler.
 * Executes textureSampleCompare(texture, sampler, uv, depthRef) returning a 0.0-1.0 visibility factor.
 */
export class SampleTextureCompareNode implements Node {
    id: string;
    type = "SampleTextureCompare";
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string) {
        this.id = id;
        this.inputs = [
            { id: "texture", name: "texture", dataType: "texture_depth_2d", isInput: true },
            { id: "sampler", name: "sampler", dataType: "sampler_comparison", isInput: true },
            { id: "uv", name: "uv", dataType: "vec2<f32>", isInput: true },
            { id: "depthRef", name: "depthRef", dataType: "f32", isInput: true },
        ];
        this.outputs = [
            { id: "shadow", name: "shadow", dataType: "f32", isInput: false },
        ];
    }
}
