import type { VertexFormat } from "../../types.js";
import type { TextureGPU } from "../../texture.js";
import type { WgslDataType, Node, Socket } from "./types.js";

function formatToDefaultWgsl(format: VertexFormat): WgslDataType {
    switch (format) {
        case "float32":
            return "f32";
        case "float32x2":
        case "unorm16x2":
        case "snorm16x2":
        case "float16x2":
            return "vec2<f32>";
        case "float32x3":
            return "vec3<f32>";
        case "float32x4":
        case "unorm8x4":
        case "snorm8x4":
        case "unorm16x4":
        case "snorm16x4":
        case "float16x4":
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

/**
 * Declares one vertex attribute in the layout chain and outputs its typed vector value.
 */
export class InputVertexNode implements Node {
    id: string;
    type = "InputVertex";
    attributeName: string;
    format: VertexFormat;
    dataType: WgslDataType;
    stage: "vertex" = "vertex";

    inputs: Socket[];
    outputs: Socket[];

    constructor(
        id: string,
        attributeName: string,
        format: VertexFormat,
        dataType?: WgslDataType
    ) {
        this.id = id;
        this.attributeName = attributeName;
        this.format = format;
        this.dataType = dataType ?? formatToDefaultWgsl(format);

        this.inputs = [
            { id: "layoutIn", name: "layoutIn", dataType: "layout_token", isInput: true },
        ];
        this.outputs = [
            { id: "layoutOut", name: "layoutOut", dataType: "layout_token", isInput: false },
            { id: "data", name: attributeName, dataType: this.dataType, isInput: false },
        ];
    }
}

/**
 * Terminal sink for vertex clip space position.
 */
export class OutputVertexNode implements Node {
    id: string;
    type = "OutputVertex";
    stage: "vertex" = "vertex";
    inputs: Socket[];
    outputs: Socket[] = [];

    constructor(id = "output_vertex") {
        this.id = id;
        this.inputs = [
            { id: "clipPosition", name: "clipPosition", dataType: "vec4<f32>", isInput: true },
        ];
    }
}

/**
 * Terminal sink for fragment color.
 */
export class OutputFragmentNode implements Node {
    id: string;
    type = "OutputFragment";
    stage: "fragment" = "fragment";
    inputs: Socket[];
    outputs: Socket[] = [];

    constructor(id = "output_fragment") {
        this.id = id;
        this.inputs = [
            { id: "color", name: "color", dataType: "vec4<f32>", isInput: true },
        ];
    }
}

/**
 * Automatically reads entity TransformCmp (model and normal matrices).
 */
export class EntityTransformNode implements Node {
    id: string;
    type = "EntityTransform";
    stage: "vertex" = "vertex";

    inputs: Socket[];
    outputs: Socket[];

    constructor(id = "entity_transform") {
        this.id = id;
        this.inputs = [
            { id: "in_position", name: "in_position", dataType: "vec3<f32>", isInput: true },
            { id: "in_normal", name: "in_normal", dataType: "vec3<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "out_position", name: "out_position", dataType: "vec3<f32>", isInput: false },
            { id: "out_normal", name: "out_normal", dataType: "vec3<f32>", isInput: false },
        ];
    }
}

/**
 * Scalar float value or parameter node.
 * When isParam is true (default), the value acts as the fallback default
 * when no float value is provided in the entity's ShaderCmp slot.
 */
export class FloatNode implements Node {
    id: string;
    type = "Float";
    value: number;
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id: string, defaultValue = 0.0, isParam = true, paramName?: string) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "f32", isInput: false },
        ];
    }
}

/**
 * 2-component vector node.
 * When isParam is true (default), the value acts as the fallback default.
 */
export class Vec2Node implements Node {
    id: string;
    type = "Vec2";
    value: [number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number] = [0, 0],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec2<f32>", isInput: false },
        ];
    }
}

/**
 * 3-component vector node.
 * When isParam is true (default), the value acts as the fallback default.
 */
export class Vec3Node implements Node {
    id: string;
    type = "Vec3";
    value: [number, number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number, number] = [0, 0, 0],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec3<f32>", isInput: false },
        ];
    }
}

/**
 * 4-component vector node representing vector or color data.
 * When isParam is true (default), the value acts as the fallback default
 * when no vector value is provided in the entity's ShaderCmp slot.
 */
export class Vec4Node implements Node {
    id: string;
    type = "Vec4";
    value: [number, number, number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number, number, number] = [1, 1, 1, 1],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec4<f32>", isInput: false },
        ];
    }
}

/**
 * 2D Texture node.
 * Paramable by default. If defaultValue is provided, it acts as the fallback default
 * when no texture is specified in the entity's ShaderCmp slot.
 */
export class TextureNode implements Node {
    id: string;
    type = "Texture";
    isParam: boolean;
    paramName: string;
    defaultValue?: TextureGPU;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue?: TextureGPU,
        paramName?: string,
        isParam = true
    ) {
        this.id = id;
        this.defaultValue = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined) ?? id;
        this.outputs = [
            { id: "texture", name: "texture", dataType: "texture_2d<f32>", isInput: false },
        ];
    }
}

/**
 * Sampler node.
 * Paramable by default. If defaultValue is provided, it acts as the fallback default
 * when no sampler is specified in the entity's ShaderCmp slot.
 */
export class SamplerNode implements Node {
    id: string;
    type = "Sampler";
    isParam: boolean;
    paramName: string;
    defaultValue?: GPUSampler | GPUSamplerDescriptor;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue?: GPUSampler | GPUSamplerDescriptor,
        paramName?: string,
        isParam = true
    ) {
        this.id = id;
        this.defaultValue = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined) ?? id;
        this.outputs = [
            { id: "sampler", name: "sampler", dataType: "sampler", isInput: false },
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
 * Component-wise vector or float addition.
 */
export class AddNode implements Node {
    id: string;
    type = "Add";
    dataType: WgslDataType;
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string, dataType: WgslDataType = "vec3<f32>") {
        this.id = id;
        this.dataType = dataType;
        this.inputs = [
            { id: "a", name: "a", dataType, isInput: true },
            { id: "b", name: "b", dataType, isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType, isInput: false },
        ];
    }
}

/**
 * Component-wise multiplication or matrix-vector product.
 */
export class MultiplyNode implements Node {
    id: string;
    type = "Multiply";
    dataType: WgslDataType;
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string, dataType: WgslDataType = "vec4<f32>") {
        this.id = id;
        this.dataType = dataType;
        this.inputs = [
            { id: "a", name: "a", dataType, isInput: true },
            { id: "b", name: "b", dataType, isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType, isInput: false },
        ];
    }
}

/**
 * Uniform matrix node (e.g. viewProjection matrix).
 */
export class UniformMatrixNode implements Node {
    id: string;
    type = "UniformMatrix";
    paramName: string;
    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id: string, paramName = "viewProj") {
        this.id = id;
        this.paramName = paramName;
        this.outputs = [
            { id: "matrix", name: "matrix", dataType: "mat4x4<f32>", isInput: false },
        ];
    }
}

/**
 * External camera input node providing view, projection, combined viewProj matrices, and camera world position.
 * Output sockets:
 * - 'view': mat4x4<f32> (Camera view matrix)
 * - 'proj': mat4x4<f32> (Camera projection matrix)
 * - 'viewProj': mat4x4<f32> (Combined view * projection matrix)
 * - 'position': vec3<f32> (Camera world position)
 */
export class CameraNode implements Node {
    id: string;
    type = "Camera";
    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id = "camera") {
        this.id = id;
        this.outputs = [
            { id: "view", name: "view", dataType: "mat4x4<f32>", isInput: false },
            { id: "proj", name: "proj", dataType: "mat4x4<f32>", isInput: false },
            { id: "viewProj", name: "viewProj", dataType: "mat4x4<f32>", isInput: false },
            { id: "position", name: "position", dataType: "vec3<f32>", isInput: false },
        ];
    }
}

