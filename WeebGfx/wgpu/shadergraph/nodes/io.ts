import type { VertexFormat } from "../../../types.js";
import type { WgslDataType, Node, Socket } from "../types.js";

/**
 * Maps vertex attribute format to corresponding WGSL vector type.
 */
export function formatToDefaultWgsl(format: VertexFormat): WgslDataType {
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
 * Procedural fullscreen triangle generator for post-processing and blit passes.
 * Emits full clip position and [0, 1] normalized UV without vertex buffer allocation.
 */
export class FullscreenTriangleNode implements Node {
    id: string;
    type = "FullscreenTriangle";
    stage: "vertex" = "vertex";
    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id = "fullscreen_triangle") {
        this.id = id;
        this.outputs = [
            { id: "clipPosition", name: "clipPosition", dataType: "vec4<f32>", isInput: false },
            { id: "uv", name: "uv", dataType: "vec2<f32>", isInput: false },
        ];
    }
}
