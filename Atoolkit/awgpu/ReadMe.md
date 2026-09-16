# Awgpu

Domain-agnostic, multi-tier WebGPU hardware execution engine managing physical device acquisition, memory allocation, data stream assembly, frequency-slotted resource binding, pipeline compilation, command pass recording, and execution graph scheduling.

Built on progressive disclosure of hardware control, zero-allocation hot paths, and strict compositional modularity.

---

## Table of Contents

- [Awgpu](#awgpu)
  - [Table of Contents](#table-of-contents)
  - [1. Architecture & Execution Model](#1-architecture--execution-model)
    - [1.1 Six-Tier Abstraction Hierarchy](#11-six-tier-abstraction-hierarchy)
    - [1.2 Core Engineering Invariants](#12-core-engineering-invariants)
    - [1.3 Memory Model & Alignment Rules](#13-memory-model--alignment-rules)
  - [2. Level 0: Hardware Foundation](#2-level-0-hardware-foundation)
    - [2.1 Device](#21-device)
      - [Lifecycle & Operations](#lifecycle--operations)
        - [`Device.create(config?: DeviceConfig): Promise<Device>`](#devicecreateconfig-deviceconfig-promisedevice)
        - [`Device.createHeadless(config?: DeviceConfig): Promise<Device>`](#devicecreateheadlessconfig-deviceconfig-promisedevice)
        - [`createCommandEncoder(label?: string): GPUCommandEncoder`](#createcommandencoderlabel-string-gpucommandencoder)
        - [`submit(commands: (GPUCommandBuffer | GPUCommandEncoder)[] | GPUCommandBuffer | GPUCommandEncoder): void`](#submitcommands-gpucommandbuffer--gpucommandencoder--gpucommandbuffer--gpucommandencoder-void)
        - [`destroy(): void`](#destroy-void)
    - [2.2 Device & Queue Resolution](#22-device--queue-resolution)
  - [3. Level 1: Managed Memory & Handles](#3-level-1-managed-memory--handles)
    - [3.1 Buffer & BufferSlice](#31-buffer--bufferslice)
      - [Factories](#factories)
      - [Operations](#operations)
      - [Sub-allocation: BufferSlice](#sub-allocation-bufferslice)
    - [3.2 BufferPool](#32-bufferpool)
    - [3.3 Texture & Sampler](#33-texture--sampler)
      - [Texture Factories](#texture-factories)
      - [Texture Operations](#texture-operations)
      - [Sampler](#sampler)
    - [3.4 Memory Handle Resolution](#34-memory-handle-resolution)
  - [4. Level 2: Composable Data Structures](#4-level-2-composable-data-structures)
    - [4.1 StreamSet & Data Streams](#41-streamset--data-streams)
    - [4.2 SwapBuffer](#42-swapbuffer)
    - [4.3 Target & Attachment Coordination](#43-target--attachment-coordination)
  - [5. Level 3: Resource Binding System](#5-level-3-resource-binding-system)
    - [5.1 SlotFrequency Specification](#51-slotfrequency-specification)
    - [5.2 BindLayout & BindLayoutBuilder](#52-bindlayout--bindlayoutbuilder)
    - [5.3 BindTable & Dynamic Offsets](#53-bindtable--dynamic-offsets)
      - [Binding Resource Normalization](#binding-resource-normalization)
    - [5.4 BindTable Caching & Deduplication](#54-bindtable-caching--deduplication)
  - [6. Level 4: Hardware Pipelines](#6-level-4-hardware-pipelines)
    - [6.1 RasterPipeline](#61-rasterpipeline)
    - [6.2 ComputePipeline](#62-computepipeline)
    - [6.3 PipelineCache & Diagnostics](#63-pipelinecache--diagnostics)
  - [7. Level 5: Command Sequencing & Execution Graph](#7-level-5-command-sequencing--execution-graph)
    - [7.1 RenderPassNode & ComputePassNode](#71-renderpassnode--computepassnode)
      - [RenderPassNode](#renderpassnode)
      - [ComputePassNode](#computepassnode)
    - [7.2 PassSequence](#72-passsequence)
    - [7.3 PassGraph](#73-passgraph)
  - [8. Concrete Architecture Patterns](#8-concrete-architecture-patterns)
    - [8.1 Pattern A: Multi-Stream Geometry with Dynamic Offsets](#81-pattern-a-multi-stream-geometry-with-dynamic-offsets)
    - [8.2 Pattern B: Iterative Compute Simulation](#82-pattern-b-iterative-compute-simulation)
    - [8.3 Pattern C: Dual-Tier Native Hardware Escape Hatch](#83-pattern-c-dual-tier-native-hardware-escape-hatch)
    - [8.4 Pattern D: Raw WebGPU Handle Interoperability](#84-pattern-d-raw-webgpu-handle-interoperability)

---

## 1. Architecture & Execution Model

### 1.1 Six-Tier Abstraction Hierarchy

Awgpu organizes WebGPU hardware execution across six compositional tiers. Each tier builds directly on the tier beneath it without encapsulation lock-in:

| Level | Subsystem | Module | Description | Key Exports |
| :--- | :--- | :--- | :--- | :--- |
| **5** | Command Scheduling | `sequence.ts`, `graph.ts` | Execution DAG, pass sequencing, hazard synchronization, driver state deduplication | `PassGraph`, `PassSequence`, `RenderPassNode`, `ComputePassNode` |
| **4** | Hardware Pipelines | `pipeline.ts` | Pipeline layout derivation, shader reflection, pipeline caching | `RasterPipeline`, `ComputePipeline`, `PipelineCache` |
| **3** | Resource Binding | `binding.ts` | Frequency-slotted resource tables, bind layout builder, bind group caching, dynamic offsets | `BindLayout`, `BindTable`, `BindTableCache`, `SlotFrequency` |
| **2** | Data Structures | `stream.ts`, `state.ts`, `target.ts` | Stream assembly, ping-pong state containers, swapchain and MRT coordination | `StreamSet`, `SwapBuffer`, `Target` |
| **1** | Managed Memory | `memory.ts` | Sized buffer/texture allocation, sub-allocated slices, buffer pooling, typed uploads | `Buffer`, `BufferPool`, `Texture`, `Sampler`, `BufferSlice` |
| **0** | Hardware Foundation | `device.ts` | Physical adapter negotiation, logical device lifecycle, queue submission | `Device`, `resolveDevice`, `resolveQueue` |

### 1.2 Core Engineering Invariants

1. **Strict Domain-Agnosticism**:
   - Models hardware resources and computation directly: physical buffers, sub-allocated slices, typed stream descriptors, frequency-slotted binding tables, and pass dependency graphs.
   - Higher-level layers compose these primitives into domain entities.

2. **Namespace Principle & Zero Aliasing**:
   - Only the library root carries the toolkit prefix (`Awgpu`).
   - All classes and exported types use clean, unaliased canonical nouns: `Device`, `Buffer`, `Texture`, `Sampler`, `StreamSet`, `SwapBuffer`, `Target`, `BindLayout`, `BindTable`, `RasterPipeline`, `ComputePipeline`, `RenderPassNode`, `ComputePassNode`, `PassSequence`, `PassGraph`.
   - Aliases (`AwgpuBuffer`, `GpuBuffer`, `ABuffer`) are forbidden.

3. **Progressive Disclosure & Dual-Tier Interoperability**:
   - Callers choose the abstraction level suited to their workload.
   - Every interface accepting a higher-level type must accept lower-level and raw WebGPU handles (`GPUDevice`, `GPUBuffer`, `GPUTexture`, `GPUTextureView`, `GPUSampler`, `GPURenderPassEncoder`) without casting or wrapper friction.

4. **Zero-Allocation Hot Path**:
   - Per-frame animation ticks, simulation steps, and command recording execute with zero heap allocations.
   - Data updates execute via in-place typed array uploads (`queue.writeBuffer`).
   - Pass descriptors and command lists are recycled or cached across frames.

5. **Deterministic Hardware Synchronization**:
   - Multi-pass workloads compile into linear batches submitted as a single `GPUCommandBuffer` to minimize driver overhead.
   - The execution graph derives hardware pass boundaries to enforce compute-to-compute and compute-to-raster memory hazards.

### 1.3 Memory Model & Alignment Rules

Awgpu enforces WebGPU hardware alignment constraints at allocation time:

| Resource Type | Minimum Size | Byte Alignment | Hardware Specification |
| :--- | :--- | :--- | :--- |
| **Uniform Buffer (`UBO`)** | 16 bytes | 16-byte boundary | WebGPU offset alignment (`minUniformBufferOffsetAlignment`) |
| **Storage Buffer (`SSBO`)** | 4 bytes | 4-byte boundary | WebGPU storage buffer structure alignment rules |
| **Vertex Buffer (`VBO`)** | 4 bytes | 4-byte boundary | Attribute stride alignment (`arrayStride % 4 == 0`) |
| **Index Buffer (`IBO`)** | 4 bytes | 4-byte boundary | `uint16` (2-byte) or `uint32` (4-byte) stream boundary |
| **Buffer Copy Operations** | 4 bytes | 4-byte boundary | `writeBuffer` and `copyBufferToBuffer` byte offsets |

---

## 2. Level 0: Hardware Foundation

Located in `device.ts`. Coordinates adapter negotiation, logical device acquisition, presentation swapchains, and hardware queue submission.

### 2.1 Device

Holds persistent references to native `GPUAdapter`, `GPUDevice`, and `GPUQueue`. Manages presentation swapchains via `GPUCanvasContext` and provides submission entry points. Exposes `native: GPUDevice` (direct alias to `device`), `device: GPUDevice`, `adapter: GPUAdapter`, `queue: GPUQueue`, `canvas: HTMLCanvasElement | null`, `context: GPUCanvasContext | null`, `format: GPUTextureFormat`, `limits: GPUSupportedLimits`, `features: GPUSupportedFeatures`, and `lost: Promise<GPUDeviceLostInfo>`.

```typescript
constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    canvas: HTMLCanvasElement | null,
    context: GPUCanvasContext | null,
    format: GPUTextureFormat
)

get native(): GPUDevice;
get limits(): GPUSupportedLimits;
get features(): GPUSupportedFeatures;
get lost(): Promise<GPUDeviceLostInfo>;
```

#### Lifecycle & Operations

##### `Device.create(config?: DeviceConfig): Promise<Device>`
Acquires `GPUAdapter` and logical `GPUDevice`. Configures canvas presentation context using preferred format (`navigator.gpu.getPreferredCanvasFormat()`).
- `config.canvas`: Canvas element, query selector string, or null.
- `config.powerPreference`: `"high-performance"` or `"low-power"`.
- `config.requiredFeatures`: Array of requested `GPUFeatureName` flags.
- `config.requiredLimits`: Record of required WebGPU hardware limits.
- `config.alphaMode`: Canvas compositing mode (`"premultiplied"` or `"opaque"`).
- `config.onError`: Callback invoked on uncaptured WebGPU validation or out-of-memory errors (`GPUUncapturedErrorEvent`).
- `config.onDeviceLost`: Callback invoked when hardware device is lost or disconnected (`GPUDeviceLostInfo`).
- Throws `Error` when WebGPU is unavailable, adapter acquisition fails, or target canvas selector cannot be resolved.

##### `Device.createHeadless(config?: DeviceConfig): Promise<Device>`
Initializes `Device` with `canvas: null` and `context: null` for compute-only pipelines, web workers, and offscreen test runners.

##### `createCommandEncoder(label?: string): GPUCommandEncoder`
Allocates native `GPUCommandEncoder` instance tagged with optional diagnostic label.

##### `submit(commands: (GPUCommandBuffer | GPUCommandEncoder)[] | GPUCommandBuffer | GPUCommandEncoder): void`
Submits single or batched command buffers to the hardware queue. Automatically finalizes uncommitted encoders (`encoder.finish()`) before queue submission.

##### `destroy(): void`
Unconfigures presentation canvas context and destroys underlying `GPUDevice`.

### 2.2 Device & Queue Resolution

Dual-tier normalization functions resolving raw or wrapped hardware handles:

```typescript
export function resolveDevice(deviceOrGpu: Device | GPUDevice): GPUDevice;
export function resolveQueue(deviceOrGpu: Device | GPUDevice): GPUQueue;
```

Accepts either toolkit `Device` wrapper or native WebGPU `GPUDevice`, returning unencapsulated native handles.

---

## 3. Level 1: Managed Memory & Handles

Located in `memory.ts`. Wraps low-level storage allocations, memory alignments, sub-allocations, and typed array updates.

### 3.1 Buffer & BufferSlice

Manages allocation sizing, alignment padding, usage flags, and zero-allocation updates. Exposes `native: GPUBuffer`, `size: number`, `usage: GPUBufferUsageFlags`, and `label: string`.

#### Factories

```typescript
static create(device: Device | GPUDevice, desc: {
    size: number;
    usage: GPUBufferUsageFlags;
    data?: BufferSourceData;
    label?: string;
}): Buffer;

static createUniform(device: Device | GPUDevice, sizeOrData: number | BufferSourceData, label?: string): Buffer;
static createStorage(device: Device | GPUDevice, sizeOrData: number | BufferSourceData, options?: { readOnly?: boolean; label?: string }): Buffer;
static createVertex(device: Device | GPUDevice, sizeOrData: number | BufferSourceData, label?: string): Buffer;
static createIndex(device: Device | GPUDevice, sizeOrData: number | BufferSourceData, label?: string): Buffer;
```

- Uniform allocations clamp to 16 bytes minimum and round up to the next 16-byte multiple (`Math.ceil(size / 16) * 16`).
- Storage buffers include `COPY_DST | COPY_SRC` usage flags to support read-backs, staging copies, and compute mutations.

#### Operations

- `slice(byteOffset: number, byteLength?: number): BufferSlice`: Returns lightweight sub-allocation descriptor without driver memory reallocation.
- `write(device: Device | GPUDevice, data: BufferSourceData, bufferOffset = 0): void`: Writes typed data directly into GPU memory using `queue.writeBuffer`.
- `read(device: Device | GPUDevice, byteOffset?: number, byteLength?: number, reusableStaging?: GPUBuffer): Promise<ArrayBuffer>`: Copies buffer contents to CPU via a `MAP_READ` staging buffer. When `reusableStaging` is provided, skips staging allocation and reuses the provided buffer across calls.
- `alignUniformOffset(offset: number, alignment = 256): number`: Aligns byte offset to uniform buffer dynamic offset boundary, satisfying hardware `minUniformBufferOffsetAlignment` constraints.
- `destroy(): void`: Releases native `GPUBuffer`.

#### Sub-allocation: BufferSlice

```typescript
export interface BufferSlice {
    readonly buffer: GPUBuffer | Buffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}
```
Allows binding dynamic offsets and sub-ranges without allocating separate hardware buffer handles.

### 3.2 BufferPool

Recycles transient `GPUBuffer` allocations across frames via power-of-two size bucketing:

```typescript
export class BufferPool {
    constructor(device: Device | GPUDevice);

    acquire(size: number, usage: GPUBufferUsageFlags, label?: string): GPUBuffer;
    release(buffer: GPUBuffer): void;
    reset(): void;
    destroy(): void;
}
```

- `acquire(size, usage, label?)`: Searches matching bucket for free buffer with capacity >= size. Returns existing handle or allocates new `GPUBuffer`.
- `release(buffer)`: Returns buffer to free bucket for reuse.
- `reset()`: Recycles all acquired buffers back into available pool for subsequent frame iterations without deallocation.
- `destroy()`: Destroys all pooled `GPUBuffer` instances.

### 3.3 Texture & Sampler

Manages hardware textures, format metadata, dimensions, usage flags, and primary views. Exposes `native: GPUTexture`, `view: GPUTextureView`, `width: number`, `height: number`, `depthOrLayers: number`, `format: GPUTextureFormat`, `usage: GPUTextureUsageFlags`, and `label: string`.

#### Texture Factories

```typescript
static create(device: Device | GPUDevice, desc: GPUTextureDescriptor): Texture;
static create2D(device: Device | GPUDevice, options: { width: number; height: number; format?: GPUTextureFormat; usage?: GPUTextureUsageFlags; sampleCount?: number; label?: string }): Texture;
static create3D(device: Device | GPUDevice, options: { width: number; height: number; depth: number; format?: GPUTextureFormat; usage?: GPUTextureUsageFlags; label?: string }): Texture;
static createDepth(device: Device | GPUDevice, options: { width: number; height: number; format?: GPUTextureFormat; usage?: GPUTextureUsageFlags; stencil?: boolean; sampleCount?: number; label?: string }): Texture;
static createCube(device: Device | GPUDevice, options: { size: number; format?: GPUTextureFormat; usage?: GPUTextureUsageFlags; mipLevelCount?: number; label?: string }): Texture;
static fromNative(gpuTexture: GPUTexture, view?: GPUTextureView, label?: string): Texture;
```

- Every factory automatically generates a primary `GPUTextureView` stored in `.view`, eliminating secondary driver calls during bind table creation.
- `createDepth` defaults format to `"depth24plus"` or `"depth24plus-stencil8"` when `stencil: true`. Supports MSAA depth buffers via `sampleCount`.
- `create3D` configures `dimension: "3d"` with `TEXTURE_BINDING | STORAGE_BINDING | COPY_DST` for volumetric data storage and compute storage bindings.
- `createCube` allocates a 2D texture with 6 array layers and configures `.view` as a `"cube"` dimension view for direct `textureSample` cube sampling in WGSL. Individual face views can be obtained via `createView()` with explicit `baseArrayLayer`.

#### Texture Operations

- `write2D(device: Device | GPUDevice, data: BufferSourceData, width: number, height: number, bytesPerPixel = 4, format?: GPUTextureFormat): void`: Writes 2D image data directly to texture with automated 256-byte aligned `bytesPerRow` row stride calculation and buffer padding.
- `copyExternalImage(device: Device | GPUDevice, source: GPUImageCopyExternalImageSource, options?: { origin?: GPUOrigin2DStrict; flipY?: boolean }): void`: Uploads external pixel sources (`ImageBitmap`, `HTMLCanvasElement`, `OffscreenCanvas`) via `queue.copyExternalImageToTexture`.
- `createView(desc?: GPUTextureViewDescriptor): GPUTextureView`: Instantiates additional texture views for specific mip levels, array slices, or cube faces.
- `destroy(): void`: Releases native `GPUTexture`.

#### Sampler

Wraps native `GPUSampler` instances configured for linear, nearest, or comparison filtering.

- `Sampler.createLinear(device, label?)`: Linear interpolation with repeat address mode.
- `Sampler.createNearest(device, label?)`: Point filtering with clamp-to-edge address mode.
- `Sampler.createComparison(device, options?)`: Depth comparison sampler configured with `compare: "less"` for shadow map evaluation.

### 3.4 Memory Handle Resolution

Dual-tier normalization functions resolving raw or wrapped memory handles:

```typescript
export interface ResolvedBuffer { buffer: GPUBuffer; offset: number; size: number; }
export function resolveBuffer(source: GPUBuffer | Buffer | BufferSlice, out?: ResolvedBuffer): ResolvedBuffer;
export function resolveTexture(source: GPUTexture | Texture): GPUTexture;
export function resolveTextureView(source: GPUTextureView | GPUTexture | Texture): GPUTextureView;
export function resolveSampler(source: GPUSampler | Sampler): GPUSampler;
```

`resolveBuffer` accepts an optional mutable `ResolvedBuffer` destination object to eliminate object allocations in hot draw paths.
`resolveTextureView` caches the default `GPUTextureView` for raw `GPUTexture` inputs in a module-level `WeakMap`. The view is created once per texture object, eliminating repeated allocations in hot paths.

---

## 4. Level 2: Composable Data Structures

Located in `stream.ts`, `state.ts`, and `target.ts`. Domain-agnostic structural compositions of Level 1 resources.

### 4.1 StreamSet & Data Streams

Assembles planar or interleaved vertex and index buffer streams. Manages 1 to N `VertexStream` definitions and an optional `IndexStream`.

```typescript
export interface VertexStream {
    slot: number;
    shaderLocation?: number;
    source: GPUBuffer | Buffer | BufferSlice;
    format: GPUVertexFormat;
    offset?: number;
    stepMode?: GPUVertexStepMode;
}

export interface IndexStream {
    source: GPUBuffer | Buffer | BufferSlice;
    format: GPUIndexFormat;
    count: number;
    offset?: number;
    firstIndex?: number;
    baseVertex?: number;
}

export class StreamSet {
    readonly streams: VertexStream[] = [];
    readonly slotStrides = new Map<number, number>();
    indexStream?: IndexStream;
    vertexCount?: number;
    instanceCount = 1;
    firstVertex = 0;
    firstInstance = 0;

    addStream(slot: number, source: GPUBuffer | Buffer | BufferSlice, format: GPUVertexFormat, offset?: number, stepMode?: GPUVertexStepMode, shaderLocation?: number): this;
    setSlotStride(slot: number, stride: number): this;
    setIndices(source: GPUBuffer | Buffer | BufferSlice, format: GPUIndexFormat, count: number, offset?: number, firstIndex?: number, baseVertex?: number): this;
    deriveVertexLayouts(): (GPUVertexBufferLayout | null)[];
}
```

`deriveVertexLayouts()` groups registered `VertexStream` records by buffer slot, maps them directly to hardware slot indices (inserting `null` for unused slots), computes cumulative byte offsets per attribute, aligns stream strides to 4-byte boundaries (`Math.ceil(currentOffset / 4) * 4`), or applies explicit slot strides configured via `setSlotStride()`. Output matches `(GPUVertexBufferLayout | null)[]` for pipeline compilation.

**`shaderLocation` vs `slot`**: `slot` is the buffer binding index passed to `setVertexBuffer`. `shaderLocation` is the WGSL `@location` attribute index. For planar layouts (one attribute per buffer), both values are conventionally equal and `shaderLocation` can be omitted. For interleaved layouts (multiple attributes packed into one buffer), each attribute needs a distinct `shaderLocation` and it must be set explicitly. When omitted, `deriveVertexLayouts()` falls back to `slot + i` within the group.

### 4.2 SwapBuffer

Coordinates ping-pong buffers across iterative compute operations and render-to-texture feedback loops. Operates in constant time without driver copies or heap allocations.

```typescript
export class SwapBuffer<T extends Buffer | Texture | GPUBuffer | GPUTexture> {
    constructor(initial: T, secondary: T);
    get read(): T;
    get write(): T;
    swap(): void;
    set(initial: T, secondary: T): void;
}
```

Calls to `swap()` exchange internal read and write pointers in O(1) time without issuing GPU memory copy commands.

### 4.3 Target & Attachment Coordination

Coordinates color attachments and depth-stencil attachments for render pass execution. Manages screen swapchain backbuffers, offscreen multi-render-target (MRT) textures, and depth-only targets.

```typescript
export interface ColorTargetDesc {
    target: GPUTextureView | Texture | null; // null indicates swapchain backbuffer
    clearColor?: GPUColor;
    loadOp?: GPULoadOp;
    storeOp?: GPUStoreOp;
    resolveTarget?: GPUTextureView | Texture;
}

export interface DepthTargetDesc {
    target: GPUTextureView | Texture;
    depthClearValue?: number;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
    stencilClearValue?: number;
    stencilLoadOp?: GPULoadOp;
    stencilStoreOp?: GPUStoreOp;
}

export class Target {
    readonly label: string;
    readonly isScreen: boolean;
    readonly colorTextures: Texture[];  // managed textures from createOffscreen, empty for screen targets

    colorTargets: ColorTargetDesc[];
    depthTarget?: DepthTargetDesc;

    static createScreen(device: Device, options?: { depthFormat?: GPUTextureFormat | null; clearColor?: GPUColor; sampleCount?: number; label?: string }): Target;
    static createOffscreen(device: Device | GPUDevice, desc: { width: number; height: number; colorFormats?: GPUTextureFormat[]; depthFormat?: GPUTextureFormat; sampleCount?: number; label?: string }): Target;

    getDescriptor(): GPURenderPassDescriptor;
    resize(device: Device | GPUDevice, width: number, height: number): void;
    invalidateCache(): void;
    setColorTarget(index: number, desc: ColorTargetDesc): void;
    setDepthTarget(desc: DepthTargetDesc | undefined): void;
}
```

- `getDescriptor()` reuses cached `GPURenderPassDescriptor` instances, updating swapchain backbuffer views and clear colors in-place within pre-allocated attachment structures to eliminate all per-frame heap allocations.
- `createScreen` supports MSAA anti-aliasing via `sampleCount`. When `sampleCount > 1`, allocates an internal multi-sampled transient color texture and automatically sets swapchain backbuffer as `resolveTarget`.
- Passing `depthFormat: null` to `Target.createScreen` omits depth buffer allocation for pure-color and post-processing passes.
- Canvas dimension updates trigger automatic depth texture reallocation on subsequent `getDescriptor()` calls.
- `createOffscreen` populates `colorTextures[]` with the managed `Texture` objects created for each color attachment. Bind these directly in downstream pass bind tables for RTT read access.
- `resize()` reallocates all managed color textures for offscreen targets and the depth texture for both screen and offscreen targets. Screen targets only reallocate depth.
- `setColorTarget()` and `setDepthTarget()` update attachment descriptors and invalidate the cached descriptor in one call. Direct mutation of `colorTargets` or `depthTarget` is permitted but requires a subsequent `invalidateCache()` call.

---

## 5. Level 3: Resource Binding System

Located in `binding.ts`. Replaces manual bind group boilerplate with a standardized frequency-tier architecture.

### 5.1 SlotFrequency Specification

Bindings are organized across four standard update frequencies to filter redundant driver state changes during pass execution:

```typescript
export enum SlotFrequency {
    PerFrame = 0,     // Matrices, globals, time, viewport resolution
    PerPhase = 1,     // Lighting clusters, environment maps, shadow atlases
    PerBatch = 2,     // Surface constants, data buffers, localized samplers
    PerInstance = 3,  // Per-draw dynamic transforms, bone palettes
}
```

### 5.2 BindLayout & BindLayoutBuilder

Fluent builder constructing `GPUBindGroupLayout` descriptors:

```typescript
export class BindLayoutBuilder {
    addUniform(binding: number, visibility?: GPUShaderStageFlags, options?: { hasDynamicOffset?: boolean; minBindingSize?: number }): this;
    addStorage(binding: number, visibility?: GPUShaderStageFlags, options?: { readOnly?: boolean; hasDynamicOffset?: boolean; minBindingSize?: number }): this;
    addTexture(binding: number, visibility?: GPUShaderStageFlags, options?: { sampleType?: GPUTextureSampleType; viewDimension?: GPUTextureViewDimension; multisampled?: boolean }): this;
    addStorageTexture(binding: number, format: GPUTextureFormat, visibility?: GPUShaderStageFlags, options?: { access?: GPUStorageTextureAccess; viewDimension?: GPUTextureViewDimension }): this;
    addSampler(binding: number, visibility?: GPUShaderStageFlags, options?: { comparison?: boolean }): this;
    build(device: Device | GPUDevice, label?: string): BindLayout;
}
```

### 5.3 BindTable & Dynamic Offsets

Wraps native `GPUBindGroup` and normalizes input resources into native `GPUBindingResource` descriptors:

```typescript
export class BindTable {
    readonly native: GPUBindGroup;
    readonly layout: GPUBindGroupLayout;
    readonly slot: number;
    readonly label: string;

    static create(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options?: { slot?: number; label?: string }
    ): BindTable;

    static getOrCreate(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options?: { slot?: number; label?: string }
    ): BindTable;

    static clearCache(): void;
}
```

#### Binding Resource Normalization
`resolveBindingResource(res)` handles every tier transparently:
- `BufferSlice` -> `{ buffer: slice.buffer.native, offset: slice.byteOffset, size: slice.byteLength }`
- `Buffer` -> `{ buffer: buffer.native }`
- `Texture` -> `texture.view`
- `Sampler` -> `sampler.native`
- Native handles (`GPUBuffer`, `GPUTextureView`, `GPUSampler`) -> Passed through unchanged.

### 5.4 BindTable Caching & Deduplication

Prevents redundant allocation of identical `GPUBindGroup` instances:

```typescript
export class BindTableCache {
    get(key: string): BindTable | undefined;
    set(key: string, table: BindTable): void;
    getOrCreate(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options?: { slot?: number; label?: string }
    ): BindTable;
    clear(): void;
}
```

- `BindTable.getOrCreate(device, layout, entries, options)`: Normalizes entries and computes deterministic composite hash key based on layout ID and resource handles. Reuses cached `BindTable` if match exists.
- `BindTable.clearCache()`: Clears default shared bind table cache.
- `hashBindingEntries(layout, entries)`: Computes deterministic composite key for layout and entry bindings.

---

## 6. Level 4: Hardware Pipelines

Located in `pipeline.ts`. Manages shader modules, automatic layout chaining, and pipeline caching.

### 6.1 RasterPipeline

Compiles vertex and fragment shader modules into `GPURenderPipeline`.

```typescript
export class RasterPipeline {
    readonly native: GPURenderPipeline;
    readonly layout?: GPUPipelineLayout;
    readonly hasFragmentStage: boolean;
    readonly label: string;

    static create(device: Device | GPUDevice, desc: RasterPipelineDesc): RasterPipeline;
    static createAsync(device: Device | GPUDevice, desc: RasterPipelineDesc): Promise<RasterPipeline>;
}
```

- `createAsync` compiles the pipeline asynchronously via `device.createRenderPipelineAsync` to prevent main-thread compilation stalls.
- Providing `desc.streamSet` derives `vertex.buffers` automatically from stream set layouts.
- Empty layout slots (for example `[passLayout, null, batchLayout]`) are populated with empty `GPUBindGroupLayout` handles to prevent layout index misalignment.
- Omitting `desc.fragment` compiles a depth-only pipeline for shadow cascades and depth prepasses.

### 6.2 ComputePipeline

Compiles compute shader modules into `GPUComputePipeline`.

```typescript
export class ComputePipeline {
    readonly native: GPUComputePipeline;
    readonly layout?: GPUPipelineLayout;
    readonly label: string;

    static create(device: Device | GPUDevice, desc: ComputePipelineDesc): ComputePipeline;
    static createAsync(device: Device | GPUDevice, desc: ComputePipelineDesc): Promise<ComputePipeline>;
}
```

- `createAsync` compiles the pipeline asynchronously via `device.createComputePipelineAsync` to prevent main-thread compilation stalls.

### 6.3 PipelineCache & Diagnostics

- **`PipelineCache`**: Prevents redundant driver recompilation of identical pipelines. Supports automated descriptor hashing (`hashRasterDesc`, `hashComputeDesc`) and cached creation (`getOrCreateRaster`, `getOrCreateRasterAsync`, `getOrCreateCompute`, `getOrCreateComputeAsync`). Exposes static shared instance `PipelineCache.default`.
- **Structured Diagnostics**: `reportShaderMessages` queries `getCompilationInfo()` on shader modules and routes warnings, line numbers, and error messages to diagnostic handlers.

---

## 7. Level 5: Command Sequencing & Execution Graph

Located in `sequence.ts` and `graph.ts`. Coordinates multi-pass command recording, redundant driver state filtering, and memory hazard management.

### 7.1 RenderPassNode & ComputePassNode

Records render and compute commands into target attachments with driver state deduplication. Pre-allocates 8 bind group tracking slots, dynamically growing when slot index exceeds 7.

#### RenderPassNode

Records draw commands into target attachments. Skips re-binding identical pipelines, vertex buffers (tracking both GPUBuffer handle and byte offset), index buffers (tracking buffer handle, index format, and byte offset), and bind tables between successive draws. Tracks dynamic offset application per slot so transitions from dynamic offsets back to base offset re-bind cleanly.

```typescript
export interface DrawBatch {
    pipeline: RasterPipeline;
    streamSet?: StreamSet;
    bindTables?: (BindTable | GPUBindGroup | null | undefined)[];
    vertexCount?: number;
    indexCount?: number;
    instanceCount?: number;
    firstVertex?: number;
    firstInstance?: number;
    firstIndex?: number;
    baseVertex?: number;
    dynamicOffsets?: DynamicOffsetRecord;
    indirect?: {
        buffer: GPUBuffer | Buffer;
        offset?: number;
    };
}

export class RenderPassNode {
    readonly label: string;
    target: Target;
    readonly draws: DrawBatch[] = [];

    addDraw(batch: DrawBatch): this;
    record(recorder: (pass: GPURenderPassEncoder) => void): this;
    clear(): void;
    execute(encoder: GPUCommandEncoder): void;
}
```

- `DrawBatch.indirect`: Executes indirect draws via `pass.drawIndirect` (unindexed) or `pass.drawIndexedIndirect` (indexed) using arguments read from the specified GPU buffer.
- `DrawBatch.indexCount`: Overrides index count configured on `streamSet.indexStream`.
- `DrawBatch.vertexCount`: Resolves draw count for unindexed geometry when `streamSet.vertexCount` is omitted.
- `record()`: Registers imperative escape hatch accepting raw `GPURenderPassEncoder` commands. Calling `record()` replaces queued `draws` for that execution; the two modes are mutually exclusive within a single pass.

#### ComputePassNode

Sequences compute dispatches with redundant pipeline and bind table deduplication.

```typescript
export interface ComputeBatch {
    pipeline: ComputePipeline;
    workgroups?: [number, number, number];
    bindTables?: (BindTable | GPUBindGroup | null | undefined)[];
    dynamicOffsets?: DynamicOffsetRecord;
    indirect?: {
        buffer: GPUBuffer | Buffer;
        offset?: number;
    };
}

export class ComputePassNode {
    readonly label: string;
    readonly dispatches: ComputeBatch[] = [];

    addDispatch(batch: ComputeBatch): this;
    record(recorder: (pass: GPUComputePassEncoder) => void): this;
    clear(): void;
    execute(encoder: GPUCommandEncoder): void;
}
```

- `ComputeBatch.indirect`: Dispatches compute workgroups via `pass.dispatchWorkgroupsIndirect` using arguments read from the specified GPU buffer.
- `record()`: Registers an imperative escape hatch accepting raw `GPUComputePassEncoder` commands. Calling `record()` replaces queued `dispatches` for that execution; the two modes are mutually exclusive within a single pass.

### 7.2 PassSequence

Linear multi-pass execution coordinator:

```typescript
export class PassSequence {
    readonly passes: (RenderPassNode | ComputePassNode)[] = [];

    add(pass: RenderPassNode | ComputePassNode): this;
    clear(): void;
    execute(device: Device | GPUDevice, label?: string): void;
}
```

Allocates a single `GPUCommandEncoder` per frame, records all passes sequentially, finalizes one `GPUCommandBuffer`, and submits the batch to the hardware queue in one call.

### 7.3 PassGraph

Directed Acyclic Graph (DAG) pass scheduler resolving read/write resource hazards and eliminating dead passes:

```typescript
export class PassGraph {
    addRenderPass(target: Target, label?: string): RenderGraphNode;
    addComputePass(label?: string): ComputeGraphNode;
    clear(): void;
    invalidate(): void;
    compile(optionsOrForce?: boolean | { force?: boolean; cullDeadPasses?: boolean }, cullDeadPasses?: boolean): PassSequence;
    execute(device: Device | GPUDevice, label?: string, options?: { force?: boolean; cullDeadPasses?: boolean }): void;
}

export class RenderGraphNode {
    read(res: GraphResource): this;
    write(res: GraphResource): this;
    sideEffect(enabled?: boolean): this;
    addDraw(batch: DrawBatch): this;
    record(recorder: (pass: GPURenderPassEncoder) => void): this;
    readonly node: RenderPassNode;
    readonly hasSideEffect: boolean;
}

export class ComputeGraphNode {
    read(res: GraphResource): this;
    write(res: GraphResource): this;
    sideEffect(enabled?: boolean): this;
    addDispatch(batch: ComputeBatch): this;
    record(recorder: (pass: GPUComputePassEncoder) => void): this;
    readonly node: ComputePassNode;
    readonly hasSideEffect: boolean;
}
```

- `compile(optionsOrForce?, cullDeadPasses?)`: Evaluates read/write hazards bidirectionally across pass pairs using Kahn topological sorting (O(V+E)). Performs reverse reachability analysis from side-effect roots (screen targets or nodes tagged `.sideEffect(true)`) to automatically cull dead passes not contributing to final output. Automatically caches compiled `PassSequence` while pass topology remains unchanged, eliminating sort overhead and allocations across per-frame `execute()` invocations.
- `invalidate()`: Clears cached sequence and forces recompilation on subsequent execution.
- `RenderGraphNode`: Automatically registers target color and depth output attachments into its write dependency set. Targets outputting to canvas swapchains (`null` target) automatically register as side-effect roots.
- Pass boundaries between compute writes and subsequent texture reads enforce WebGPU memory synchronization without manual barriers.
- `addDraw()` and `addDispatch()` forward directly to inner pass node.
- When circular dependency cycle is detected, `compile()` emits `console.warn` and falls back to declaration order.

---

## 8. Concrete Architecture Patterns

### 8.1 Pattern A: Multi-Stream Geometry with Dynamic Offsets

Demonstrates Level 1 buffers, Level 2 streams, Level 3 dynamic offsets, and Level 5 draw recording:

```typescript
import {
    Device,
    Buffer,
    StreamSet,
    BindLayout,
    BindTable,
    RasterPipeline,
    RenderPassNode,
    Target,
    SlotFrequency,
} from "Atoolkit/awgpu_new";

// 1. Initialize Device & Presentation Target
const gfx = await Device.create({ canvas: "#renderCanvas" });
const target = Target.createScreen(gfx);

// 2. Level 1: Allocate Dedicated Buffers
const posBuffer = Buffer.createVertex(gfx, new Float32Array([...]));
const normalBuffer = Buffer.createVertex(gfx, new Float32Array([...]));
const indexBuffer = Buffer.createIndex(gfx, new Uint16Array([...]));

// 3. Level 2: Compose into StreamSet (planar: one attribute per buffer slot)
const streams = new StreamSet()
    .addStream(0, posBuffer, "float32x3")
    .addStream(1, normalBuffer, "float32x3")
    .setIndices(indexBuffer, "uint16", 36);

// 4. Level 3: Dynamic Uniform Buffer Layout
const instanceLayout = BindLayout.builder()
    .addUniform(0, GPUShaderStage.VERTEX, { hasDynamicOffset: true })
    .build(gfx, "InstanceLayout");

const instanceTable = BindTable.create(gfx, instanceLayout, [
    { binding: 0, resource: dynamicBuffer },
], { slot: SlotFrequency.PerInstance });

// 5. Level 4: Pipeline Creation
const pipeline = RasterPipeline.create(gfx, {
    vertex: { code: shaderCode },
    fragment: { code: shaderCode, targets: [{ format: gfx.format }] },
    streamSet: streams,
    layouts: [null, null, null, instanceLayout],
});

// 6. Level 5: Queue Draw Calls with Zero Heap Allocations
const pass = new RenderPassNode(target);
for (let i = 0; i < objectCount; i++) {
    pass.addDraw({
        pipeline,
        streamSet: streams,
        bindTables: [null, null, null, instanceTable],
        dynamicOffsets: { [SlotFrequency.PerInstance]: [i * 256] },
    });
}
```

#### 8.2 Pattern B: Double-Buffered Compute Iteration

Demonstrates Level 2 `SwapBuffer`, Level 3 storage bindings, and Level 5 pass execution:

```typescript
import {
    Device,
    Buffer,
    SwapBuffer,
    BindLayout,
    BindTable,
    ComputePipeline,
    ComputePassNode,
    PassSequence,
} from "Atoolkit/awgpu_new";

const gfx = await Device.createHeadless();

// 1. Level 2: Ping-Pong Storage Buffers
const state = new SwapBuffer(
    Buffer.createStorage(gfx, 65536 * 4),
    Buffer.createStorage(gfx, 65536 * 4)
);

// 2. Level 3: Layout & Tables
const computeLayout = BindLayout.builder()
    .addStorage(0, GPUShaderStage.COMPUTE, { readOnly: true })
    .addStorage(1, GPUShaderStage.COMPUTE, { readOnly: false })
    .build(gfx);

// 3. Level 4: Compute Pipeline
const computePipeline = ComputePipeline.create(gfx, {
    code: computeCode,
    layouts: [computeLayout],
});

// 4. Level 5: Sequence 20 Iteration Passes
const sequence = new PassSequence();

for (let iter = 0; iter < 20; iter++) {
    const table = BindTable.create(gfx, computeLayout, [
        { binding: 0, resource: state.read },
        { binding: 1, resource: state.write },
    ]);

    const node = new ComputePassNode(`Iter_${iter}`);
    node.addDispatch({
        pipeline: computePipeline,
        workgroups: [16, 16, 1],
        bindTables: [table],
    });

    sequence.add(node);
    state.swap();
}

// Execute all 20 passes in a single hardware submission
sequence.execute(gfx);
```

### 8.3 Pattern C: Dual-Tier Native Hardware Escape Hatch

Demonstrates mixing Level 5 batch orchestration with raw WebGPU native encoding in the same pass. `addDraw()` and `record()` are mutually exclusive per pass: use `addDraw()` for batched state-deduplicated draws, or `record()` for full imperative control.

```typescript
import { Target, RenderPassNode } from "Atoolkit/awgpu_new";

// Batched draws via addDraw():
const batchPass = new RenderPassNode(screenTarget);
batchPass.addDraw({
    pipeline: geometryPipeline,
    streamSet: geometryStreams,
    bindTables: [frameTable],
});

// Direct hardware encoding via record() (separate pass or clear first):
const nativePass = new RenderPassNode(screenTarget);
nativePass.record((rawPass) => {
    // Unabstracted native WebGPU API calls
    rawPass.setPipeline(postProcessPipeline.native);
    rawPass.setBindGroup(0, rawPostBindGroup);
    rawPass.setVertexBuffer(0, rawCustomVbo);
    rawPass.draw(3);
});
```

### 8.4 Pattern D: Raw WebGPU Handle Interoperability

Demonstrates binding raw `GPUTexture` and `GPUSampler` handles rendered by an isolated outsider RTT pass directly into an Awgpu `BindTable`:

```typescript
import {
    Device,
    BindLayout,
    BindTable,
    RasterPipeline,
    RenderPassNode,
    Target,
} from "Atoolkit/awgpu_new";

const gfx = await Device.create({ canvas: "#renderCanvas" });
const rawDevice = gfx.native; // Raw GPUDevice

// 1. Outsider Allocates Raw Handles (Zero Awgpu imports)
const rawTexture = rawDevice.createTexture({
    size: [512, 512],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
const rawSampler = rawDevice.createSampler({ magFilter: "linear" });

// 2. Outsider Records Native RTT Pass
const outsiderEncoder = rawDevice.createCommandEncoder();
const rttPass = outsiderEncoder.beginRenderPass({
    colorAttachments: [{ view: rawTexture.createView(), loadOp: "clear", storeOp: "store" }],
});
// (Outsider native draws...)
rttPass.end();

// 3. Bind Raw Handles Directly in Awgpu (Zero Wrappers)
const layout = BindLayout.builder()
    .addTexture(0, GPUShaderStage.FRAGMENT)
    .addSampler(1, GPUShaderStage.FRAGMENT)
    .build(gfx);

const table = BindTable.create(gfx, layout, [
    { binding: 0, resource: rawTexture }, // GPUTexture accepted directly
    { binding: 1, resource: rawSampler }, // GPUSampler accepted directly
]);

// 4. Record Awgpu Presentation Pass
const target = Target.createScreen(gfx, { depthFormat: null });
const screenPass = new RenderPassNode(target);
screenPass.addDraw({ pipeline: displayPipeline, bindTables: [table], vertexCount: 3 });

// 5. Submit Both Passes in a Single Hardware Queue Transaction
const awgpuEncoder = gfx.createCommandEncoder();
screenPass.execute(awgpuEncoder);
gfx.submit([outsiderEncoder, awgpuEncoder]);
```
