# Atoolkit: Modular Computational Toolkit & Hardware Execution Framework

A collection of zero-dependency TypeScript modules designed for simulation, numerical evaluation, entity management, and WebGPU hardware execution.

All modules share common engineering invariants: zero-allocation calling conventions on hot paths, contiguous typed array storage, deterministic execution plans, and dual-tier hardware transparency.

---

## 1. Package Architecture

| Package | Role | Core Data Structures | Performance & Memory Invariants |
| :--- | :--- | :--- | :--- |
| **[`aecs`](./aecs/ReadMe.md)** | Entity Component System | `Entity`, `EntityPool`, `ComponentSet<T>`, `FloatSet`, `Query` | Contiguous packed dense arrays; generational slot recycling; cardinality-driven smallest-set iteration; zero hot-path allocations. |
| **[`alm`](./alm/ReadMe.md)** | 3D Linear Algebra & Spatial Math | `Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat3`, `Mat4`, `Ray`, `Plane`, `AABB`, `Frustum` | Direct subclassing of native `Float32Array`; in-place fluent operations; out-parameter zero-allocation conventions. |
| **[`atempo`](./atempo/ReadMe.md)** | Temporal Orchestration & Cadence | `Track`, `FloatTrack`, `Vec3Track`, `Curve`, `Clip`, `Cadence`, `FixedCadence`, `Spring`, `Phase`, `Metronome` | Contiguous double-precision timestamps; cached O(1) interval lookup; closed-form 2nd-order analytical spring solvers. |
| **[`acircuit`](./acircuit/ReadMe.md)** | Directed Computation Circuit | `Socket`, `Wire`, `Chip`, `Circuit`, `CompositeChip` | Kahn topological ordering; execution plan caching; 1-to-1 input enforcement; 1-to-N output fan-out. |
| **[`awgpu`](./awgpu/ReadMe.md)** | Six-Tier WebGPU Hardware Engine | `Device`, `Buffer`, `BufferPool`, `Texture`, `Sampler`, `StreamSet`, `Target`, `BindLayout`, `BindTable`, `BindTableCache`, `RasterPipeline`, `ComputePipeline`, `PipelineCache`, `RenderPassNode`, `ComputePassNode`, `PassSequence`, `PassGraph` | Zero-allocation render pass descriptors; transient buffer pooling; automated vertex strides; 8-slot bind group filtering; DAG dead pass culling. |
| **[`adiag`](./adiag/ReadMe.md)** | Diagnostic Telemetry Bus | `Bus`, `Diagnostic`, `DiagnosticSeverity` | Fixed-capacity circular ring buffer (default 256 records); subscriber error isolation; causal chain tracing (`causeId`). |
| **[`awasm`](./awasm/ReadMe.md)** | WebAssembly Computational Runtime & Memory Coordinator *(Runtime/Concurrency Experimental)* | `WasmMemory`, `LinearArena`, `BlockPool`, `MemoryView`, `StructLayout`, `Slice`, `StringBuffer`, `ModuleInspector`, `HostBridge`, `ModuleLoader`, `WasmInstance`, `SharedMemory`, `AtomicQueue`, `WorkerPool` | Monotonic bump allocation; detachment-resilient typed views; 16-byte SIMD alignment; bitmap-guarded slab recycling; lock-free SPSC atomic queues. |

---

## 2. Subsystem Specifications

### 2.1 aecs: Entity Component System

High-performance, sets-first ECS decoupled from rigid scene graphs.

- **Entity Allocation**: `Entity` packs a 20-bit slot index, an 11-bit generation counter, and a 1-bit alive flag into an unsigned 32-bit integer. `EntityPool` manages issuance, generational validation, slot retirement on generation exhaustion, and slot recycling via an internal free-list array.
- **Dense Storage Primitives**:
  - `ComponentSet<T>`: Contiguous sparse-dense storage for JavaScript objects, state tags, and reference payloads.
  - `FloatSet`: Contiguous packed `Float32Array` storage for high-frequency numeric vectors and matrices, eliminating object reference overhead.
- **Cardinality Joins**: `Query` identifies the smallest required component set and iterates only across that pivot set, testing presence in secondary and excluded sets in O(1) time with zero view allocations via `forEachEntity()`.

### 2.2 alm: 3D Linear Algebra & Spatial Primitives

High-performance 3D mathematics built directly on native typed arrays.

- **Storage Layout**: Every mathematical primitive (`Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat3`, `Mat4`) subclasses `Float32Array` directly. Slices and views write directly into WebGPU buffers (`device.queue.writeBuffer`) with zero serialization or memory copying.
- **Dual Calling Convention**:
  - Fluent in-place methods (`v.add(b)`) mutate instances and return `this`.
  - Static procedural methods (`Mat4.mul(a, b, out)`) accept destination `out` buffers to guarantee zero heap allocations in hot animation loops.
- **Spatial Structures**: Provides analytical intersection testing, frustum-bounding sphere containment, ray-plane casting, and bounding-box containment via `Ray`, `Plane`, `AABB`, and `Frustum`.

### 2.3 atempo: Temporal Orchestration & Cadence

Time-shaping functions and sequence evaluation primitives decoupled from concrete data interpolation.

- **Sequence Evaluation**: `Track<T, TOut>` manages chronological keyframe sequences, locates active interval spans via cached index pointers (falling back to O(log N) binary search on non-linear seeks), and shapes progress using unary transfer functions (`Curve`).
- **Composite Timelines**: `Clip` evaluates heterogeneous tracks simultaneously across a unified temporal coordinate space.
- **Analytical Harmonic Dynamics**: `Spring` implements a closed-form analytical second-order damped harmonic oscillator, evaluating exact displacement and velocity in continuous time without numerical Euler integration errors.
- **Cadence & Timesteps**: `Cadence` computes frame-rate independent exponential half-life decay. `FixedCadence` accumulates elapsed frame time and produces deterministic fixed-timestep simulation steps.

### 2.4 acircuit: Directed Computation Circuit

Value computation graph featuring static topology validation and plan caching.

- **Endpoints & Connections**: `Socket` declares input or output endpoints with optional data type constraints and requirement tags. `Wire` defines directed connections linking an output socket to an input socket. Input sockets strictly enforce 1-to-1 connections; output sockets support 1-to-N fan-out.
- **Computation Units**: `Chip` represents a stateless computational node that declares socket schemas and evaluates input records.
- **Graph Ownership**: `Circuit` validates connections against cycles and type mismatches, derives topological evaluation sequences via Kahn's algorithm, and caches the resulting execution plan by structural revision.
- **Composite Encapsulation**: `CompositeChip` wraps an entire subcircuit inside a single composite chip, exposing boundary sockets (`exposeInput`, `exposeOutput`) and flattening into parent circuits (`flattenInto`) via `ChipProxy` instances.

### 2.5 awgpu: Six-Tier WebGPU Hardware Engine

Domain-agnostic WebGPU execution engine built across six distinct compositional levels:

- **Level 0 (Hardware Foundation)**: `Device` acquires adapters, logical devices, and queue handles, or wraps borrowed native `GPUDevice` handles via `Device.fromNative`. Exposes hardware telemetry (`limits`, `features`, `lost`) and attaches error hooks (`onError`, `onDeviceLost`).
- **Level 1 (Managed Memory)**: `Buffer` encapsulates sized allocations, 4-byte aligned uploads (`write`, `writePadded`), uniform alignment, and safe staging readbacks (`readback`). `BufferPool` recycles transient buffers across frames via power-of-two size bucketing. `Texture` manages 2D and depth/stencil textures (`create2D`, `createDepth`), validates tight or custom-stride 2D uploads (`write2D` via `queue.writeTexture`), and caches default views per native `GPUTexture`. `Sampler` configures texture filtering and addressing modes (`Sampler.create`).
- **Level 2 (Data Structures)**: `StreamSet` groups planar or interleaved vertex attributes and index streams, automatically deriving vertex buffer layouts. `Target` manages swapchain backbuffers, offscreen multi-render-targets (MRT), MSAA resolution, read-only attachment inspection snapshots, and cached render pass descriptors. `SwapBuffer` manages ping-pong resource pairs in O(1) time.
- **Level 3 (Resource Binding)**: `BindLayoutBuilder` constructs `GPUBindGroupLayout` descriptors with fluent method chaining. `BindTable` normalizes raw or wrapped resources into native binding descriptors. `BindTableCache` provides device-scoped LRU caching and resource-targeted eviction (`evictResource`).
- **Level 4 (Hardware Pipelines)**: `RasterPipeline` and `ComputePipeline` compile shader modules with synchronous and asynchronous factory methods. `PipelineCache` provides device-scoped normalized descriptor caching and in-flight async compilation deduplication.
- **Level 5 (Command Sequencing & DAG)**: `RenderPassNode` and `ComputePassNode` record commands while filtering redundant driver state changes (tracking bind group slots, vertex buffer ranges, and index buffer ranges). `PassGraph` schedules passes via Kahn topological sort, resolving RAW/WAR/WAW hazards and eliminating dead passes via reverse reachability from side-effect or presentation roots.

### 2.6 adiag: Diagnostic Telemetry Bus

Structured diagnostics, subscriber dispatch, and causal error tracing without cross-boundary thrown exceptions.

- **Structured Records**: `Diagnostic<T>` captures numeric IDs, category tags, severity levels (`"info"`, `"warn"`, `"error"`), messages, timestamps, optional structured payloads (`data`), and optional causal parent IDs (`causeId`).
- **Circular History**: `Bus` logs diagnostic records into a bounded circular ring buffer (default 256 entries, or `0` for stateless streaming) in O(1) time, overwriting the oldest records when capacity is reached.
- **Causal Traversal**: `bus.trace()` traverses `causeId` links to extract root-cause failure chains across subsystem boundaries while guarding against cycles and evicted ancestors.

### 2.7 awasm: WebAssembly Computational Runtime & Linear Memory Coordinator

Low-level WebAssembly execution runtime, linear memory arena coordinator, binary inspector, and multi-threaded worker dispatch framework. Runtime and concurrency primitives (`ModuleLoader`, `HostBridge`, `WasmInstance`, `SharedMemory`, `AtomicQueue`, `WorkerPool`) are marked **experimental**.

- **Memory Subsystem**: `WasmMemory` tracks wrapper, native, and guest-initiated page growth and notifies listeners when native buffers detach. `LinearArena` provides fixed-capacity O(1) bump allocations with power-of-two alignment and watermark rewinding. `BlockPool` manages bitmap-guarded free-list slab recycling. `MemoryView` exposes detachment-resilient typed array views.
- **ABI Subsystem**: `StructLayout` computes member byte offsets and stride calculations matching C/Rust `repr(C)` specifications. `Slice` encapsulates guest memory spans `(ptr, length)` without buffer duplication. `StringBuffer` provides UTF-8 encoding into arena memory and decoding from guest spans.
- **Runtime Subsystem (Experimental)**: `ModuleInspector` performs static binary analysis on uninstantiated modules. `HostBridge` constructs typed host import tables with UTF-8 logging and panic hooks. `ModuleLoader` compiles modules via streaming or buffered paths with optional IndexedDB caching. `WasmInstance` manages active instances with optional or required linear memory handles.
- **Thread Subsystem (Experimental)**: `SharedMemory` allocates thread-safe `SharedArrayBuffer` memory with 32-bit atomic wait/notify synchronization. `AtomicQueue` coordinates lock-free single-producer / single-consumer (SPSC) message passing via unsigned 32-bit ring indices. `WorkerPool` dispatches tasks across Web Workers with configurable backpressure, timeouts, and cancellation.

---

## 3. Core Engineering Invariants

1. **Zero-Allocation Hot Paths**:
   - Math operations in `alm` and interval evaluations in `atempo` write directly into destination buffers passed as `out` parameters.
   - Render targets in `awgpu` update swapchain views in place within pre-allocated descriptors, eliminating garbage collection pauses during animation and simulation loops.

2. **Dense Contiguous Memory**:
   - `aecs` stores component values and entity keys in packed, contiguous arrays (`ComponentSet`, `FloatSet`). Iterations execute directly over dense memory blocks without pointer-chasing scene graphs.

3. **Four-Tier Bind Frequency Slots**:
   - `awgpu` standardizes pipeline bindings into four update frequencies (`PerFrame = 0`, `PerPass = 1`, `PerBatch = 2`, `PerInstance = 3`), filtering redundant GPU driver state updates between draws.

4. **Deterministic Plan Caching**:
   - Both `acircuit` and `awgpu` cache topological execution orders (`Circuit.topoSort()` and `PassGraph.compile()`), reusing the compiled schedule in O(1) lookup time across subsequent calls unless graph topology or target generations change; executing a schedule runs in O(P) over the scheduled chips or passes.

5. **Dual-Tier Hardware Interoperability**:
   - High-level abstractions expose raw underlying handles (`GPUDevice`, `GPUBuffer`, `GPUTexture`, `GPUCommandEncoder`). Callers can execute custom imperative passes alongside managed passes without translation overhead.

6. **Bounded Diagnostic Footprint**:
   - `adiag` uses bounded ring buffers for error logging, ensuring diagnostic instrumentation cannot cause runaway memory expansion.

---

## 4. End-to-End Composition Example

Demonstrates coordinating entity management, 3D mathematics, temporal spring dynamics, and WebGPU command execution across Atoolkit modules:

```typescript
import { EntityPool, ComponentSet, FloatSet, Query } from "@asciiz/atoolkit/aecs";
import { Mat4 } from "@asciiz/atoolkit/alm";
import { Spring } from "@asciiz/atoolkit/atempo";
import {
	Device,
	Buffer,
	StreamSet,
	BindLayout,
	BindTable,
	RasterPipeline,
	Target,
	RenderPassNode,
} from "@asciiz/atoolkit/awgpu";
import { Bus } from "@asciiz/atoolkit/adiag";

// 1. Diagnostics & Hardware Foundation
const bus = new Bus({ maxHistory: 500 });
const gfx = await Device.create();
bus.info("GPU_READY", { format: gfx.format });

// 2. Entity Component Storage
const entities = new EntityPool();
const transforms = new FloatSet(16); // stores 4x4 matrix per entity
const tagSet = new ComponentSet<string>();

const player = entities.spawn();
transforms.setFromArray(player, Mat4.identity(new Mat4()));
tagSet.set(player, "ActivePlayer");
const entityQuery = new Query(transforms, tagSet);

// 3. Temporal Harmonic Follower
const spring = new Spring(3.0, 0.85);
const springState: [number, number] = [0.0, 0.0]; // [position, velocity]
const targetElevation = 5.0;

// 4. Managed GPU Geometry & Uniforms
const vertices = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
const posBuf = Buffer.vertex(gfx, vertices);
const uboBuf = Buffer.uniform(gfx, 64);

const streams = new StreamSet().addVertex(0, 0, "float32x3", posBuf);
const target = Target.createOffscreen(gfx, {
	width: 800,
	height: 600,
	colorFormats: [gfx.format],
});

const bindLayout = BindLayout.builder()
	.addUniform(0, GPUShaderStage.VERTEX)
	.build(gfx);

const bindTable = BindTable.create(gfx, {
	layout: bindLayout,
	entries: [{ binding: 0, resource: uboBuf }],
});

const shaderSource = /* wgsl */ `
@group(0) @binding(0) var<uniform> uMvp: mat4x4<f32>;
@vertex fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
	return uMvp * vec4<f32>(pos, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
	return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

const pipeline = RasterPipeline.create(gfx, {
	vertex: { code: shaderSource },
	fragment: { code: shaderSource, targets: [{ format: gfx.format }] },
	streamSet: streams,
	layouts: [bindLayout],
});

const pass = new RenderPassNode(target).addDraw({
	pipeline,
	streamSet: streams,
	bindTables: [bindTable],
	vertexCount: 3,
});

// Scratch matrices (zero heap allocations in render loop)
const model = new Mat4();
const viewProj = new Mat4();
const mvp = new Mat4();
Mat4.perspective(Math.PI / 4, 16 / 9, 0.1, 100, viewProj);

// 5. Simulation & Render Tick
function tick(deltaTime: number) {
	// Evaluate continuous harmonic spring displacement
	spring.updateScalar(springState[0], springState[1], targetElevation, deltaTime, springState);
	const elevation = springState[0];

	// Process matching entities
	entityQuery.forEachEntity((_entity) => {
		Mat4.fromTranslation([0, elevation, -5], model);
		Mat4.mul(viewProj, model, mvp);
		uboBuf.write(gfx, mvp);
	});

	// Record and submit commands
	const encoder = gfx.native.createCommandEncoder({ label: "FrameEncoder" });
	pass.execute(encoder);
	gfx.queue.submit([encoder.finish()]);
}
void tick;
```