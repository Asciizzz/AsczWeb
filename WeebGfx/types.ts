import type { TextureGPU } from "./texture.js";

/**
 * API-agnostic vertex format descriptors.
 */
export type VertexFormat =
    | "float32"
    | "float32x2"
    | "float32x3"
    | "float32x4"
    | "uint32"
    | "uint32x2"
    | "uint32x4"
    | "sint32"
    | "sint32x2"
    | "sint32x4"
    | "unorm8x4"
    | "snorm8x4"
    | "uint8x4"
    | "sint8x4"
    | "unorm16x2"
    | "snorm16x2"
    | "uint16x2"
    | "sint16x2"
    | "unorm16x4"
    | "snorm16x4"
    | "uint16x4"
    | "sint16x4"
    | "float16x2"
    | "float16x4";

export type VertexStepMode = "vertex" | "instance";

/**
 * Format byte size lookup table for layout stride and offset calculation.
 */
export const VERTEX_FORMAT_SIZES: Record<VertexFormat, number> = {
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

export interface VertexAttribute {
    name: string;
    format: VertexFormat;
    offset: number;
    shaderLocation: number;
}

export interface VertexLayout {
    arrayStride: number;
    attributes: VertexAttribute[];
    stepMode?: VertexStepMode;
}

export interface Submesh {
    firstIndex: number;
    indexCount: number;
    baseVertex?: number;
    materialIndex?: number;
}


export interface ShaderParams {
    floats?: Record<string, number>;
    vectors?: Record<string, Float32Array | number[]>;
    textures?: Record<string, TextureGPU>;
    samplers?: Record<string, any>;
}
