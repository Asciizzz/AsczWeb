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

// Live ECS Components (*Cmp)
export { MeshCmp, ShaderCmp, TransformCmp, SkinCmp, CameraCmp } from "./components.js";

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
    type RenderScene,
    type RenderOptions,
    type DrawMeshOptions,
    type MeshRendererOptions,
} from "./wgpu/index.js";
export * from "./wgpu/shadergraph/index.js";
