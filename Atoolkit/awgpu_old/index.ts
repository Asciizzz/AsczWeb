// ================================================================
//  Awgpu - Domain-Agnostic WebGPU Hardware Execution Engine
// ================================================================

// 1. Hardware Device & Canvas Presentation
export {
    Device,
    type DeviceOptions,
} from "./device.js";

// 2. Targets, Textures & Samplers
export {
    Texture,
    Sampler,
    RenderTarget,
    type ColorAttachmentConfig,
    type DepthAttachmentConfig,
} from "./target.js";

// 3. Buffers & Memory Pools
export {
    Buffer,
    BufferPool,
    type BufferData,
} from "./buffer.js";

// 4. Layouts & Bind Group Frequency Slots
export {
    BindSlot,
    BindGroupLayoutBuilder,
    BindGroup,
    type BindingEntry,
    type ResourceBinding,
} from "./layout.js";

// 5. Pipelines & Shader Modules
export {
    createVertexLayout,
    RenderPipeline,
    ComputePipeline,
    type VertexAttributeDesc,
    type RenderPipelineDescriptor,
    type ShaderMessage,
} from "./pipeline.js";

// 6. Passes & Command Batches
export {
    Pass,
    ComputePass,
    type DrawCommand,
    type ComputeCommand,
    type DynamicOffsets,
} from "./pass.js";

// 7. Frame Orchestration
export {
    Frame,
} from "./frame.js";
