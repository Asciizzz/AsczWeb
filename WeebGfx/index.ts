// Core API-Agnostic Types
export type {
    VertexFormat,
    VertexLayout,
    VertexAttribute,
    Submesh,
    ShaderParams,
} from "./types.js";
export { VERTEX_FORMAT_SIZES } from "./types.js";

// Core Resources & Classes
export { MeshCPU, MeshGPU } from "./mesh.js";
export { TextureCPU, TextureGPU } from "./texture.js";
export { ShaderGPU } from "./shader.js";
export { Camera, type CameraProjectionMode } from "./camera.js";

// Actor (Core atomic drawing unit)
export {
    Actor,
    type ActorOptions,
    type SkinData,
    type MorphData,
} from "./actor.js";

// WebGPU Backend Subsystem (Powered by Atoolkit/awgpu)
export * as webgpu from "./wgpu/index.js";
export {
    MeshWGPU,
    TextureWGPU,
    ShaderWGPU,
    MeshRendererWGPU,
    RendererWGPU,
    ShaderGraphWGPU,
    type RenderTarget,
    type RenderOptions,
    type DrawMeshOptions,
    type MeshRendererOptions,
} from "./wgpu/index.js";
export * from "./wgpu/shadergraph/index.js";
