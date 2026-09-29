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
    type ActorPass,
    type SkinData,
    type MorphData,
} from "./actor.js";

// Skeleton & Hierarchical Animation
export {
    SkeletonCPU,
    type JointData,
} from "./skeleton.js";

// Decoupled Model Loading Subsystem
export * as loader from "./loader/index.js";
export {
    ModelGPU,
    type ModelCPU,
    type MaterialData,
} from "./loader/model.js";
export {
    ModelWGPU,
    type ModelWGPUOptions,
} from "./loader/wgpu.js";
export {
    parseGLB,
    parseGLTF,
    parseGLTFJson,
    loadGLTF,
    unpackGLB,
    decodeImageToTexture,
    parseGLTFSampler,
    type GLTFParseOptions,
    type GLTFLoadOptions,
    type GLTFBufferMap,
} from "./loader/gltf.js";

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
} from "./wgpu/index.js";
export * from "./wgpu/shadergraph/index.js";

