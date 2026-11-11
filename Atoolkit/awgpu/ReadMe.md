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
        - [`Device.create(desc?: DeviceDescriptor): Promise<Device>`](#devicecreatedesc-devicedescriptor-promisedevice)
        - [`Device.fromNative(device: GPUDevice, adapter?: GPUAdapter, format?: GPUTextureFormat, options?: { owned?: boolean }): Device`](#devicefromnativedevice-gpudevice-adapter-gpuadapter-format-gputextureformat-options--owned-boolean--device)
        - [`configureSurface(config: CanvasSurfaceConfig): GPUCanvasContext`](#configuresurfaceconfig-canvassurfaceconfig-gpucanvascontext)
        - [`getCurrentSurfaceTexture(): GPUTexture` / `getCurrentSurfaceView(): GPUTextureView`](#getcurrentsurfacetexture-gputexture--getcurrentsurfaceview-gputextureview)
        - [`pushErrorScopes(): void` / `popErrorScopes(): Promise<GPUError[]>`](#pusherrorscopes-void--poperrorscopes-promisegpuerror)
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

Holds references to native `GPUAdapter`, `GPUDevice`, and optional `GPUCanvasContext`. Exposes `native: GPUDevice`, `adapter: GPUAdapter`, `queue: GPUQueue`, `canvas: HTMLCanvasElement | OffscreenCanvas | null`, `context: GPUCanvasContext | null`, `format: GPUTextureFormat`, `limits: GPUSupportedLimits`, `features: GPUSupportedFeatures`, `owned: boolean`, `isDestroyed: boolean`, `lostInfo: GPUDeviceLostInfo | null`, and `isLostOrDestroyed: boolean`.

```typescript
// Signature overview:
// Device.create(desc?: DeviceDescriptor): Promise<Device>
// Device.fromNative(device: GPUDevice, adapter?: GPUAdapter, format?: GPUTextureFormat, options?: { owned?: boolean }): Device
// gfx.configureSurface(config: CanvasSurfaceConfig): GPUCanvasContext
// gfx.getCurrentSurfaceTexture(): GPUTexture
// gfx.getCurrentSurfaceView(): GPUTextureView
// gfx.pushErrorScopes(): void
// gfx.popErrorScopes(): Promise<GPUError[]>
// gfx.destroy(): void
```

#### Lifecycle & Operations

##### `Device.create(desc?: DeviceDescriptor): Promise<Device>`
Acquires `GPUAdapter` and logical `GPUDevice`, selecting the preferred presentation format via `navigator.gpu.getPreferredCanvasFormat()`.
- `desc.powerPreference`: `"high-performance"` or `"low-power"`.
- `desc.requiredFeatures`: Array of requested `GPUFeatureName` flags.
- `desc.requiredLimits`: Record of required WebGPU hardware limits.
- `desc.label`: Optional diagnostic label for the created `GPUDevice`.
- `desc.onUncapturedError`: Callback invoked on uncaptured WebGPU validation or out-of-memory errors (`GPUError`).
- `desc.onLost`: Callback invoked when the hardware device is lost (`GPUDeviceLostInfo`).
- Throws `Error` when WebGPU is unavailable, adapter acquisition fails, or a requested feature is unsupported.

##### `Device.fromNative(device: GPUDevice, adapter?: GPUAdapter, format?: GPUTextureFormat, options?: { owned?: boolean }): Device`
Wraps an existing native `GPUDevice` handle (`owned` defaults to `false`). Calling `destroy()` on a wrapper with `owned === false` marks the wrapper as destroyed without destroying the borrowed `GPUDevice`. To create an owned headless device without a canvas, call `await Device.create()`.

##### `configureSurface(config: CanvasSurfaceConfig): GPUCanvasContext`
Configures an `HTMLCanvasElement` or `OffscreenCanvas` for WebGPU presentation (`format`, `usage`, `alphaMode`, `colorSpace`).

##### `getCurrentSurfaceTexture(): GPUTexture` / `getCurrentSurfaceView(): GPUTextureView`
Acquires the current frame's presentation swapchain texture or view. Must be called per frame; swapchain textures and views must not be cached across frames.

##### `pushErrorScopes(): void` / `popErrorScopes(): Promise<GPUError[]>`
Pushes and pops `"validation"`, `"out-of-memory"`, and `"internal"` error scopes on `native`.

##### `destroy(): void`
Marks the wrapper as destroyed and destroys the underlying `GPUDevice` if `owned === true`.

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

Manages allocation sizing, alignment padding, usage flags, and zero-allocation updates. Exposes `native: GPUBuffer`, `size: number`, `usage: GPUBufferUsageFlags`, `owned: boolean`, `isDestroyed: boolean`, and `label?: string`.

#### Factories

```typescript
// Signature overview:
// Buffer.create(device, { size?, usage, initialData?, mappedAtCreation?, label? }): Buffer
// Buffer.uniform(device, sizeOrData, label?): Buffer
// Buffer.storage(device, sizeOrData, readWrite?, label?): Buffer
// Buffer.vertex(device, sizeOrData, label?): Buffer
// Buffer.index(device, sizeOrData, label?): Buffer
// Buffer.fromNative(nativeBuffer, usage?, options?): Buffer
```

- Uniform allocations clamp to 16 bytes minimum and round up to the next 16-byte multiple (`Math.ceil(size / 16) * 16`).
- Storage buffers include `STORAGE | COPY_DST | COPY_SRC` usage flags to support readbacks, staging copies, and compute mutations.

#### Operations

- `slice(offset?: number, size?: number): BufferSlice`: Returns a validated `{ buffer, offset, size }` sub-allocation descriptor without driver memory reallocation.
- `write(device: Device | GPUDevice, data: BufferSource, dstByteOffset = 0, srcByteOffset = 0, byteLength?: number): void`: Normalizes `ArrayBufferView` byte offsets and lengths, validates 4-byte size and offset alignment, and writes directly into GPU memory via `queue.writeBuffer`.
- `writePadded(device: Device | GPUDevice, data: BufferSource, dstByteOffset = 0, srcByteOffset = 0, byteLength?: number): void`: Writes arbitrary byte lengths to a 4-byte aligned destination offset, padding the tail up to a 4-byte multiple.
- `readback(device: Device | GPUDevice, srcOffset?: number, byteLength?: number, stagingBuffer?: Buffer | GPUBuffer): Promise<Uint8Array>`: Copies buffer contents to CPU via a `MAP_READ | COPY_DST` staging buffer and returns a detached `Uint8Array` copy. Cleans up owned temporary staging buffers in `finally` while preserving caller-provided `stagingBuffer` handles.
- `destroy(): void`: Releases the native `GPUBuffer` when owned by this wrapper.

#### Sub-allocation: BufferSlice

```typescript
export interface BufferSlice {
	readonly buffer: Buffer;
	readonly offset: number;
	readonly size: number;
}
```
Allows binding sub-ranges in `BindTable` and `StreamSet` without allocating separate hardware buffer handles.

### 3.2 BufferPool

Recycles transient `Buffer` allocations across frames via power-of-two size bucketing (minimum bucket size 256 bytes), partitioned per `GPUDevice`:

```typescript
// Signature overview:
// new BufferPool(device?: Device | GPUDevice)
// pool.acquire(byteSize: number, usage?: GPUBufferUsageFlags, label?: string): Buffer
// pool.acquire(device: Device | GPUDevice, byteSize: number, usage?: GPUBufferUsageFlags, label?: string): Buffer
// pool.release(buffer: Buffer): void
// pool.clear(): void
// pool.destroy(): void
```

- `acquire(...)`: Searches the matching `(usage, bucketSize)` pool for a free `Buffer` with capacity `>= byteSize`, or allocates a new `Buffer` of the power-of-two bucket size.
- `release(buffer)`: Returns an acquired `Buffer` to its bucket for reuse (ignores destroyed or foreign-device buffers).
- `clear()` / `destroy()`: Destroys all pooled `Buffer` instances owned by the pool without destroying any borrowed `GPUDevice`.

### 3.3 Texture & Sampler

Manages hardware textures, format metadata, dimensions, usage flags, and cached default views. Exposes `native: GPUTexture`, `view: GPUTextureView`, `width: number`, `height: number`, `depthOrArrayLayers: number`, `mipLevelCount: number`, `sampleCount: number`, `dimension: GPUTextureDimension`, `format: GPUTextureFormat`, `usage: GPUTextureUsageFlags`, `owned: boolean`, `isDestroyed: boolean`, and `label?: string`.

#### Texture Factories

```typescript
// Signature overview:
// Texture.create2D(device, { width, height, depthOrArrayLayers?, mipLevelCount?, sampleCount?, format?, usage?, label? }): Texture
// Texture.createDepth(device, { width, height, format?, sampleCount?, usage?, label? }): Texture
// Texture.fromNative(nativeTexture, desc?): Texture
```

- `Texture.view` and `resolveTextureView(rawTexture)` share a single cached default `GPUTextureView` per underlying `GPUTexture` via a module-level `WeakMap<GPUTexture, GPUTextureView>`, avoiding transient view allocations during bind group creation and pass execution.
- `createDepth` defaults format to `"depth24plus"` and supports MSAA depth buffers (`sampleCount` 1 or 4).
- `create2D` validates positive integer dimensions and rejects invalid WebGPU combinations such as `sampleCount > 1` with `mipLevelCount > 1`, `depthOrArrayLayers > 1`, or `STORAGE_BINDING` usage.

#### Texture Operations

- `write2D(device: Device | GPUDevice, data: BufferSource, options?: TextureWrite2DOptions): void`: Validates uncompressed texture format (or explicit `bytesPerPixel`), `bytesPerRow >= width * bytesPerPixel`, `rowsPerImage >= height`, and source byte capacity `((depthOrLayers - 1) * rowsPerImage + (height - 1)) * bytesPerRow + width * bytesPerPixel` before uploading via `queue.writeTexture`. Tight row packing (`bytesPerRow = width * bytesPerPixel`) is supported directly by `queue.writeTexture`; 256-byte row alignment is only required by `copyBufferToTexture` / `copyTextureToBuffer`.
- `createView(desc?: GPUTextureViewDescriptor): GPUTextureView`: Instantiates an explicit `GPUTextureView` for specific mip levels or array layers and registers its parent `GPUTexture` for `PassGraph` hazard tracking and `BindTableCache.evictResource()`.
- `destroy(): void`: Releases the native `GPUTexture` when owned by this wrapper.

#### Sampler

Wraps native `GPUSampler` instances:

- `Sampler.create(device: Device | GPUDevice, desc?: SamplerDescriptor): Sampler`
- `Sampler.fromNative(nativeSampler: GPUSampler, label?: string): Sampler`

### 3.4 Memory Handle Resolution

Dual-tier normalization functions resolving raw or wrapped memory handles:

```typescript
// Signature overview:
// resolveBuffer(ref: Buffer | BufferSlice | GPUBuffer, out?: { buffer: GPUBuffer; offset: number; size: number }): { buffer: GPUBuffer; offset: number; size: number }
// resolveTexture(tex: Texture | GPUTexture): GPUTexture
// resolveTextureView(texOrView: Texture | GPUTexture | GPUTextureView): GPUTextureView
// resolveSampler(sampler: Sampler | GPUSampler): GPUSampler
```

`resolveBuffer` accepts an optional mutable `out` destination object to eliminate object allocations in hot draw paths.
`resolveTextureView` returns `tex.view` for `Texture` wrappers, returns `GPUTextureView` inputs as-is, and reuses the cached default `GPUTextureView` for raw `GPUTexture` inputs.

---

## 4. Level 2: Composable Data Structures

Located in `stream.ts`, `state.ts`, and `target.ts`. Domain-agnostic structural compositions of Level 1 resources.

### 4.1 StreamSet & Data Streams

Assembles planar or interleaved vertex and index buffer streams. Separates `offset` (intra-vertex attribute byte offset) from `bufferOffset` (additional byte offset applied when binding the vertex buffer in `setVertexBuffer`).

```typescript
export interface VertexStream {
	slot: number;
	location: number;
	format: GPUVertexFormat;
	source: Buffer | BufferSlice | GPUBuffer;
	offset?: number;
	bufferOffset?: number;
	stride?: number;
	stepMode?: GPUVertexStepMode;
}

export interface IndexStream {
	source: Buffer | BufferSlice | GPUBuffer;
	format: GPUIndexFormat;
	offset?: number;
	count?: number;
	firstIndex?: number;
	baseVertex?: number;
}
```

- `add(stream: VertexStream): this`: Validates slot, location, `GPUVertexFormat`, `offset`, `bufferOffset`, and optional `stride`.
- `addVertex(slot: number, location: number, format: GPUVertexFormat, source: BufferSourceRef, stepMode?: GPUVertexStepMode): this`: Adds a tightly packed planar vertex stream (`offset = 0`, `stride = formatByteSize`).
- `addInterleavedVertex(slot: number, location: number, format: GPUVertexFormat, source: BufferSourceRef, byteOffset: number, byteStride: number, stepMode?: GPUVertexStepMode, bufferOffset?: number): this`: Adds an interleaved attribute stream with explicit attribute `byteOffset` and slot `byteStride`.
- `setIndex(source: BufferSourceRef, format?: GPUIndexFormat, offset?: number, count?: number, firstIndex?: number, baseVertex?: number): this`: Configures the index stream and validates 2-byte (`uint16`) or 4-byte (`uint32`) offset alignment.
- `deriveVertexLayouts(): GPUVertexBufferLayout[]`: Groups attributes by slot in ascending slot order and derives `arrayStride` from the explicit slot stride or the maximum attribute end `max(offset + formatByteSize)`.

### 4.2 SwapBuffer

Coordinates ping-pong buffers or textures across iterative compute operations and feedback loops in O(1) time without GPU copies or heap allocations.

```typescript
// Signature overview:
// new SwapBuffer<T>(first: T, second: T)
// swapBuffer.read: T
// swapBuffer.write: T
// swapBuffer.swap(): void
// swapBuffer.reset(): void
```

### 4.3 Target & Attachment Coordination

Coordinates color, MSAA resolve, and depth-stencil attachments for render pass execution.

```typescript
export interface ColorTargetDesc {
	target: GPUTextureView | Texture | null; // null indicates swapchain backbuffer
	clearColor?: GPUColor;
	loadOp?: GPULoadOp;
	storeOp?: GPUStoreOp;
	resolveTarget?: GPUTextureView | Texture | null;
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
```

- **Read-Only Inspection & Controlled Mutation**: `target.colorTargets`, `target.depthTarget`, and `target.colorTextures` are frozen read-only snapshots (`ReadonlyArray<Readonly<ColorTargetDesc>>`, `Readonly<DepthTargetDesc> | undefined`, `ReadonlyArray<Texture>`). All attachment mutations go through `setColorTarget(index, desc, options?)`, `setResolveTarget(index, resolveTarget)`, `setDepthTarget(desc, options?)`, or `resize(device, width, height, options?)`, which update the frozen snapshots, invalidate the cached `GPURenderPassDescriptor`, and increment `target.generation` so `PassGraph` automatically refreshes hazard and culling state.
- **Ownership & Retirement**: Attachments created by `Target.createScreen` and `Target.createOffscreen` are owned by the `Target`. Attachments passed to `new Target(...)`, `setColorTarget`, or `setDepthTarget` are borrowed by default unless `{ owned: true }` is specified. `resize()` and `destroy()` never destroy borrowed caller textures, and `resize()` / `setColorTarget()` / `setDepthTarget()` accept `{ retiredOut?: Texture[] }` to defer destruction of replaced owned textures until after command submission.
- **Reversed-Z Support**: `depthClearValue: 0.0` is preserved via nullish coalescing (`?? 1.0`).

---

## 5. Level 3: Resource Binding System

Located in `binding.ts`.

### 5.1 SlotFrequency Specification

Optional semantic convention for the 4 bind group slots (`0..3`); raw numeric indices can be used directly everywhere:

```typescript
export enum SlotFrequency {
	PerFrame = 0,
	PerPass = 1,
	PerBatch = 2,
	PerInstance = 3,
}
```

### 5.2 BindLayout & BindLayoutBuilder

Fluent builder constructing `BindLayout` wrappers around `GPUBindGroupLayout`:

```typescript
// Signature overview:
// BindLayout.builder()
//   .addUniform(binding, visibility, { hasDynamicOffset?, minBindingSize? })
//   .addStorage(binding, visibility, { readOnly?, hasDynamicOffset?, minBindingSize? })
//   .addTexture(binding, visibility, { sampleType?, viewDimension?, multisampled? })
//   .addStorageTexture(binding, visibility, format, { access?, viewDimension? })
//   .addSampler(binding, visibility, { type?, comparison? })
//   .build(device, label?)
```

### 5.3 BindTable & Dynamic Offsets

Wraps native `GPUBindGroup` and normalizes input resources into native `GPUBindingResource` descriptors:

```typescript
// Signature overview:
// BindTable.create(device: Device | GPUDevice, desc: {
//   layout: BindLayout | GPUBindGroupLayout;
//   entries: BindEntry[];
//   slot?: SlotFrequency | number;
//   label?: string;
//   dynamicOffsetCount?: number;
// }): BindTable
```

#### Binding Resource Normalization
`resolveBindingResource(res)` handles every tier transparently:
- `BufferSlice` -> `{ buffer: slice.buffer.native, offset: slice.offset, size: slice.size }`
- `Buffer` -> `{ buffer: buffer.native, offset: 0, size: buffer.size }`
- `Texture` -> `texture.view` (cached default `GPUTextureView`)
- Raw `GPUTexture` -> `resolveTextureView(rawTexture)` (same cached default `GPUTextureView` as `Texture.view`)
- Explicit `GPUTextureView`, `GPUSampler`, `GPUBufferBinding`, `GPUExternalTexture` -> Passed through unchanged.

### 5.4 BindTableCache

Device-scoped `BindTable` cache with LRU capacity bounding and resource-targeted eviction:

```typescript
// Signature overview:
// new BindTableCache(deviceOrOptions?: Device | GPUDevice | { maxEntries?: number }, maybeOptions?: { maxEntries?: number })
// cache.getOrCreate(device, layout, entries, options?): BindTable
// cache.evictResource(res: object): number
// cache.clear(): void
// cache.dispose(): void
```

- Partitions entries per `GPUDevice` via `WeakMap<GPUDevice, ...>`.
- Binding a `Texture` wrapper or its `texture.native` (`GPUTexture`) resolves to the same cached default `GPUTextureView` and hits the same cached `BindTable` without creating transient views. Binding distinct explicit `GPUTextureView` handles produces distinct cached `BindTable` entries.
- Maintains a bounded reverse index so `evictResource(res)` removes all live entries referencing `res`, and LRU capacity evictions clean up reverse-index references immediately.
- `clear()` / `dispose()` detaches per-device stores cleanly so subsequent populate/clear cycles on the same `GPUDevice` remain accurate.

---

## 6. Level 4: Hardware Pipelines

Located in `pipeline.ts`. Manages shader modules, layout derivation, descriptor normalization, and device-scoped pipeline caching.

### 6.1 RasterPipeline

Compiles vertex and fragment shader modules into `GPURenderPipeline`:

```typescript
// Signature overview:
// RasterPipeline.create(device: Device | GPUDevice, desc: RasterPipelineDescriptor): RasterPipeline
// RasterPipeline.createAsync(device: Device | GPUDevice, desc: RasterPipelineDescriptor): Promise<RasterPipeline>
```

- `desc.streamSet` and `desc.vertex.buffers` are mutually exclusive; providing both throws an `Error` so neither silently overwrites the other.
- Empty layout slots (for example `[frameLayout, null, batchLayout]`) are populated with an empty `GPUBindGroupLayout` cached per `GPUDevice` to preserve bind group indices.
- Omitting `desc.fragment` compiles a depth-only pipeline.

### 6.2 ComputePipeline

Compiles compute shader modules into `GPUComputePipeline`:

```typescript
// Signature overview:
// ComputePipeline.create(device: Device | GPUDevice, desc: ComputePipelineDescriptor): ComputePipeline
// ComputePipeline.createAsync(device: Device | GPUDevice, desc: ComputePipelineDescriptor): Promise<ComputePipeline>
```

### 6.3 PipelineCache

- **`PipelineCache`**: Constructed per device (`new PipelineCache(device)`) or unbound (`new PipelineCache()`). Normalizes descriptors (shader source/module identity, entry points, sorted constants, vertex buffer layouts, primitive/depth-stencil/multisample/fragment states, and bind group layouts) into collision-free structural keys.
- **In-Flight Async Deduplication**: Concurrent `getOrCreateRasterAsync` / `getOrCreateComputeAsync` calls for the same normalized descriptor on the same device share one in-flight compilation promise. Failed compilations are evicted so retries work.
- **Generation-Safe Repeatable `clear()`**: `clear()` / `dispose()` increments the cache generation and detaches per-device stores so pre-clear in-flight compilations cannot repopulate the cache or interfere with post-clear compilations for the same descriptor.

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

- `compile(optionsOrForce?, cullDeadPasses?)`: Evaluates RAW, WAR, and WAW resource hazards across buffers, textures, and texture views using Kahn topological sorting. Performs reverse reachability analysis from side-effect roots (screen targets, including MSAA screen passes with `resolveTarget === null`, or nodes tagged `.sideEffect(true)`) to cull dead passes when `cullDeadPasses` is enabled. Caches compiled `PassSequence` instances per `cullDeadPasses` mode and automatically invalidates when pass dependencies, side-effect flags, or target generations change.
- `invalidate()`: Clears cached sequences and forces recompilation on subsequent execution.
- `RenderGraphNode`: Automatically registers target color, resolve, and depth output attachments into its write dependency set.
- Throws an `Error` if a dependency cycle is detected in the pass graph.

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
} from "@asciiz/atoolkit/awgpu";

// 1. Initialize Device & Presentation Target
declare const canvas: HTMLCanvasElement;
const gfx = await Device.create();
gfx.configureSurface({ canvas });
const target = Target.createScreen(gfx);

// 2. Level 1: Allocate Dedicated Buffers
const posData = new Float32Array(36 * 3);
const normalData = new Float32Array(36 * 3);
const indexData = new Uint16Array(36);
const posBuffer = Buffer.vertex(gfx, posData);
const normalBuffer = Buffer.vertex(gfx, normalData);
const indexBuffer = Buffer.index(gfx, indexData);
const objectCount = 16;
const dynamicBuffer = Buffer.uniform(gfx, objectCount * 256);

// 3. Level 2: Compose into StreamSet (planar: one attribute per buffer slot)
const streams = new StreamSet()
	.addVertex(0, 0, "float32x3", posBuffer)
	.addVertex(1, 1, "float32x3", normalBuffer)
	.setIndex(indexBuffer, "uint16", 0, 36);

// 4. Level 3: Dynamic Uniform Buffer Layout
const instanceLayout = BindLayout.builder()
	.addUniform(0, GPUShaderStage.VERTEX, { hasDynamicOffset: true, minBindingSize: 64 })
	.build(gfx, "InstanceLayout");

const instanceTable = BindTable.create(gfx, {
	layout: instanceLayout,
	entries: [{ binding: 0, resource: dynamicBuffer.slice(0, 64) }],
	slot: SlotFrequency.PerInstance,
});

// 5. Level 4: Pipeline Creation
const shaderCode = /* wgsl */ `
@group(3) @binding(0) var<uniform> uModel: mat4x4<f32>;
@vertex fn vs_main(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> @builtin(position) vec4<f32> {
	return uModel * vec4<f32>(p + n * 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
	return vec4<f32>(1.0);
}
`;

const pipeline = RasterPipeline.create(gfx, {
	vertex: { code: shaderCode },
	fragment: { code: shaderCode, targets: [{ format: gfx.format }] },
	streamSet: streams,
	layouts: [null, null, null, instanceLayout],
});

// 6. Level 5: Queue Draw Calls
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

### 8.2 Pattern B: Iterative Compute Simulation

Demonstrates Level 2 `SwapBuffer`, Level 3 storage bindings via `BindTableCache`, and Level 5 pass execution:

```typescript
import {
	Device,
	Buffer,
	SwapBuffer,
	BindLayout,
	BindTableCache,
	ComputePipeline,
	ComputePassNode,
	PassSequence,
} from "@asciiz/atoolkit/awgpu";

const gfx = await Device.create();
const bindCache = new BindTableCache(gfx);

// 1. Level 2: Ping-Pong Storage Buffers
const state = new SwapBuffer(
	Buffer.storage(gfx, 65536 * 4),
	Buffer.storage(gfx, 65536 * 4)
);

// 2. Level 3: Layout
const computeLayout = BindLayout.builder()
	.addStorage(0, GPUShaderStage.COMPUTE, { readOnly: true })
	.addStorage(1, GPUShaderStage.COMPUTE, { readOnly: false })
	.build(gfx);

// 3. Level 4: Compute Pipeline
const computeCode = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
	dst[id.x] = src[id.x] * 0.99;
}
`;

const computePipeline = ComputePipeline.create(gfx, {
	compute: { code: computeCode },
	layouts: [computeLayout],
});

// 4. Level 5: Sequence 20 Iteration Passes
const sequence = new PassSequence();

for (let iter = 0; iter < 20; iter++) {
	const table = bindCache.getOrCreate(gfx, computeLayout, [
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

Demonstrates mixing Level 5 batch orchestration with raw WebGPU native encoding in separate passes:

```typescript
import {
	Device,
	Target,
	RasterPipeline,
	RenderPassNode,
	StreamSet,
	BindTable,
	Buffer,
} from "@asciiz/atoolkit/awgpu";

declare const gfx: Device;
declare const geometryPipeline: RasterPipeline;
declare const postProcessPipeline: RasterPipeline;
declare const geometryStreams: StreamSet;
declare const frameTable: BindTable;
declare const rawPostBindGroup: GPUBindGroup;
declare const rawCustomVbo: GPUBuffer;

const screenTarget = Target.createScreen(gfx);

// Batched draws via addDraw():
const batchPass = new RenderPassNode(screenTarget);
batchPass.addDraw({
	pipeline: geometryPipeline,
	streamSet: geometryStreams,
	bindTables: [frameTable],
});

// Direct hardware encoding via record():
const nativePass = new RenderPassNode(screenTarget);
nativePass.record((rawPass) => {
	// Unabstracted native WebGPU API calls
	rawPass.setPipeline(postProcessPipeline.native);
	rawPass.setBindGroup(0, rawPostBindGroup);
	rawPass.setVertexBuffer(0, rawCustomVbo);
	rawPass.draw(3);
});
void Buffer;
```

### 8.4 Pattern D: Raw WebGPU Handle Interoperability

Demonstrates binding raw `GPUTexture` and `GPUSampler` handles rendered by an isolated outsider RTT pass directly into an Awgpu `BindTableCache`:

```typescript
import {
	Device,
	BindLayout,
	BindTableCache,
	RasterPipeline,
	RenderPassNode,
	Target,
} from "@asciiz/atoolkit/awgpu";

declare const displayPipeline: RasterPipeline;
declare const canvas: HTMLCanvasElement;

const gfx = await Device.create();
gfx.configureSurface({ canvas });
const rawDevice = gfx.native; // Raw GPUDevice
const bindCache = new BindTableCache(gfx);

// 1. Outsider Allocates Raw Handles (Zero Awgpu wrappers)
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
rttPass.end();

// 3. Bind Raw Handles Directly in Awgpu (reuses cached default GPUTextureView)
const layout = BindLayout.builder()
	.addTexture(0, GPUShaderStage.FRAGMENT)
	.addSampler(1, GPUShaderStage.FRAGMENT)
	.build(gfx);

const table = bindCache.getOrCreate(gfx, layout, [
	{ binding: 0, resource: rawTexture }, // Raw GPUTexture accepted directly
	{ binding: 1, resource: rawSampler }, // Raw GPUSampler accepted directly
]);

// 4. Record Awgpu Presentation Pass
const target = Target.createScreen(gfx, { depthFormat: null });
const screenPass = new RenderPassNode(target);
screenPass.addDraw({ pipeline: displayPipeline, bindTables: [table], vertexCount: 3 });

// 5. Submit Both Passes in a Single Hardware Queue Transaction
const awgpuEncoder = rawDevice.createCommandEncoder();
screenPass.execute(awgpuEncoder);
gfx.queue.submit([outsiderEncoder.finish(), awgpuEncoder.finish()]);
```
