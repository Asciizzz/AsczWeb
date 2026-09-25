export type WgslDataType =
    | "f32"
    | "vec2<f32>"
    | "vec3<f32>"
    | "vec4<f32>"
    | "mat4x4<f32>"
    | "u32"
    | "vec2<u32>"
    | "vec3<u32>"
    | "vec4<u32>"
    | "i32"
    | "vec2<i32>"
    | "vec3<i32>"
    | "vec4<i32>"
    | "texture_2d<f32>"
    | "sampler"
    | "layout_token";

export interface Socket {
    id: string;
    name: string;
    dataType: WgslDataType;
    isInput: boolean;
}

export interface Node {
    id: string;
    type: string;
    inputs: Socket[];
    outputs: Socket[];
    stage?: "vertex" | "fragment";
    isParam?: boolean;
    paramName?: string;
}

export interface Connection {
    fromNodeId: string;
    fromSocketId: string;
    toNodeId: string;
    toSocketId: string;
}
