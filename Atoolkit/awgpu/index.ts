// ================================================================
//  Awgpu - Domain-Agnostic WebGPU Execution Engine
// ================================================================

// Level 0: Hardware Foundation
export {
    Device,
    resolveDevice,
    resolveQueue,
    type DeviceConfig,
} from "./device.js";

// Level 1: Managed Hardware Memory & Handles
export {
    Buffer,
    BufferPool,
    Texture,
    Sampler,
    resolveBuffer,
    resolveTexture,
    resolveTextureView,
    resolveSampler,
    type BufferSlice,
    type BufferSourceData,
    type ResolvedBuffer,
} from "./memory.js";

// Level 2: Composable Data Structures
export {
    StreamSet,
    VERTEX_FORMAT_SIZES,
    type VertexStream,
    type IndexStream,
} from "./stream.js";

export {
    SwapBuffer,
} from "./state.js";

export {
    Target,
    type ColorTargetDesc,
    type DepthTargetDesc,
} from "./target.js";

// Level 3: Resource Binding System
export {
    SlotFrequency,
    BindLayout,
    BindLayoutBuilder,
    BindTable,
    BindTableCache,
    hashBindingEntries,
    resolveBindingResource,
    type ResourceBinding,
    type BindingEntry,
} from "./binding.js";

// Level 4: Hardware Pipelines
export {
    RasterPipeline,
    ComputePipeline,
    PipelineCache,
    type RasterPipelineDesc,
    type ComputePipelineDesc,
    type ShaderMessage,
} from "./pipeline.js";

// Level 5: Command Sequencing & Execution Graph
export {
    RenderPassNode,
    ComputePassNode,
    PassSequence,
    type DrawBatch,
    type ComputeBatch,
    type DynamicOffsetRecord,
} from "./sequence.js";

export {
    PassGraph,
    RenderGraphNode,
    ComputeGraphNode,
    type GraphResource,
} from "./graph.js";
