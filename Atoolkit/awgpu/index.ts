// ================================================================
//  Awgpu - Domain-Agnostic WebGPU Execution Engine
// ================================================================

// Level 0: Hardware Foundation
export {
	Device,
	resolveDevice,
	resolveQueue,
	getResourceId,
	type DeviceConfig,
} from "./device.js";

// Level 1: Managed Hardware Memory & Handles
export {
	Buffer,
	BufferPool,
	Texture,
	Sampler,
	isBufferSlice,
	resolveBuffer,
	resolveTexture,
	resolveTextureView,
	resolveSampler,
	registerTextureViewOwner,
	getRegisteredTextureViewOwner,
	UNCOMPRESSED_TEXTURE_FORMAT_BPP,
	type BufferDescriptor,
	type BufferSlice,
	type BufferSourceData,
	type ResolvedBuffer,
	type TextureDescriptor,
	type DepthTextureDescriptor,
	type TextureWriteOptions,
} from "./memory.js";

// Level 2: Composable Data Structures
export {
	StreamSet,
	VERTEX_FORMAT_BYTE_SIZES,
	VERTEX_FORMAT_SIZES,
	getVertexFormatByteSize,
	resolveLogicalResourceId,
	type BufferSourceRef,
	type TextureSourceRef,
	type VertexStream,
	type IndexStream,
} from "./stream.js";

export {
	SwapBuffer,
	type BlendState,
	type DepthStencilState,
	type RasterState,
} from "./state.js";

export {
	Target,
	type ColorTargetDesc,
	type DepthTargetDesc,
	type TargetResizeOptions,
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
	type BindResource,
	type BindEntry,
	type BindTableDescriptor,
	type BindTableCacheOptions,
	type ResourceBinding,
	type BindingEntry,
} from "./binding.js";

// Level 4: Hardware Pipelines
export {
	RasterPipeline,
	ComputePipeline,
	PipelineCache,
	normalizeRasterDescriptor,
	normalizeComputeDescriptor,
	type ShaderStageConfig,
	type ColorTargetConfig,
	type ShaderDiagnosticMessage,
	type ShaderDiagnosticCallback,
	type RasterPipelineDescriptor,
	type ComputePipelineDescriptor,
	type RasterPipelineDesc,
	type ComputePipelineDesc,
	type ShaderMessage,
} from "./pipeline.js";

// Level 5: Command Sequencing & Execution Graph
export {
	RenderPassNode,
	ComputePassNode,
	PassSequence,
	type PassNode,
	type DrawBatch,
	type ComputeBatch,
	type DynamicOffsetRecord,
} from "./sequence.js";

export {
	PassGraph,
	RenderGraphNode,
	ComputeGraphNode,
	type GraphNode,
	type GraphResource,
	type PassGraphCompileOptions,
} from "./graph.js";
