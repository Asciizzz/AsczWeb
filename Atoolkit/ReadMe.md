# Atoolkit: Modular Computational Toolkit & Hardware Execution Framework

Atoolkit is a collection of zero-dependency TypeScript modules designed for simulation, numerical evaluation, entity management, and WebGPU hardware execution.

All modules share common engineering invariants: zero-allocation calling conventions on hot paths, contiguous typed array storage, deterministic execution plans, and dual-tier hardware transparency.

---

## 1. Package Architecture

| Package | Role | Core Data Structures | Performance & Memory Invariants | Documentation |
| :--- | :--- | :--- | :--- | :--- |
| **[`aecs`](./aecs/ReadMe.md)** | Entity Component System | `Entity`, `EntityPool`, `ComponentSet<T>`, `FloatSet`, `QueryBuilder`, `query2`, `query3` | Contiguous packed dense arrays; generational slot recycling; cardinality-driven smallest-set iteration. | [aecs ReadMe](./aecs/ReadMe.md) |
| **[`alm`](./alm/ReadMe.md)** | 3D Linear Algebra & Spatial Math | `Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat3`, `Mat4`, `Ray`, `Plane`, `AABB`, `Frustum` | Direct subclassing of native `Float32Array`; in-place fluent operations; out-parameter zero-allocation conventions. | [alm ReadMe](./alm/ReadMe.md) |
| **[`atempo`](./atempo/ReadMe.md)** | Temporal Orchestration & Cadence | `Track`, `FloatTrack`, `Vec3Track`, `Curve`, `Clip`, `Cadence`, `FixedCadence`, `Spring`, `Phase`, `Metronome` | Contiguous double-precision timestamps; cached O(1) interval lookup; closed-form 2nd-order analytical spring solvers. | [atempo ReadMe](./atempo/ReadMe.md) |
| **[`acircuit`](./acircuit/ReadMe.md)** | Directed Computation Circuit | `Socket`, `Wire`, `Chip`, `Circuit`, `Subcircuit` | Kahn topological ordering; execution plan caching (`_cachedPlan`); 1-to-1 input enforcement; 1-to-N output fan-out. | [acircuit ReadMe](./acircuit/ReadMe.md) |
| **[`awgpu`](./awgpu/ReadMe.md)** | Six-Tier WebGPU Hardware Engine | `Device`, `Buffer`, `BufferPool`, `Texture`, `Sampler`, `StreamSet`, `Target`, `BindLayout`, `BindTable`, `RasterPipeline`, `ComputePipeline`, `PipelineCache`, `RenderPassNode`, `ComputePassNode`, `PassSequence`, `PassGraph` | Zero-allocation render pass descriptors; transient buffer pooling; automated vertex strides; 8-slot bind group filtering; DAG dead pass culling. | [awgpu ReadMe](./awgpu/ReadMe.md) |
| **[`adiag`](./adiag/ReadMe.md)** | Diagnostic Telemetry Bus | `Bus`, `Result`, causal chain tracers | Fixed-capacity circular ring buffer (default 1000 records); non-throwing diagnostics; pointer-based causal error chains (`ref`). | [adiag ReadMe](./adiag/ReadMe.md) |

---

## 2. Subsystem Specifications

### 2.1 aecs: Entity Component System

Located in [`aecs/`](./aecs/). High-performance, sets-first ECS decoupled from rigid scene graphs.

- **Entity Allocation**: `Entity` packs a 20-bit slot index and a 12-bit generation counter into a single integer. `EntityPool` manages issuance, generational validation, and slot recycling via an internal free-list array.
- **Dense Storage Primitives**:
  - `ComponentSet<T>`: Contiguous sparse-dense storage for JavaScript objects, state tags, and reference payloads.
  - `FloatSet`: Contiguous packed `Float32Array` storage for high-frequency numeric vectors and matrices, eliminating object reference overhead.
- **Cardinality Joins**: `QueryBuilder`, `query2()`, and `query3()` identify the smallest active component set and iterate only across that driver set, testing presence in secondary sets in O(1) time.

### 2.2 alm: 3D Linear Algebra & Spatial Primitives

Located in [`alm/`](./alm/). High-performance 3D mathematics built directly on native typed arrays.

- **Storage Layout**: Every mathematical primitive (`Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat3`, `Mat4`) subclasses `Float32Array` directly. Slices and views write directly into WebGPU buffers (`device.queue.writeBuffer`) with zero serialization or memory copying.
- **Dual Calling Convention**:
  - Fluent in-place methods (`v.add(b)`) mutate instances and return `this`.
  - Static procedural methods (`Mat4.mul(a, b, out)`) accept destination `out` buffers to guarantee zero heap allocations in hot animation loops.
- **Spatial Structures**: Provides analytical intersection testing, frustum-bounding sphere containment, ray-plane casting, and bounding-box containment via `Ray`, `Plane`, `AABB`, and `Frustum`.

### 2.3 atempo: Temporal Orchestration & Cadence

Located in [`atempo/`](./atempo/). Time-shaping functions and sequence evaluation primitives decoupled from concrete data interpolation.

- **Sequence Evaluation**: `Track<T, TOut>` manages chronological keyframe sequences, locates active interval spans via cached index pointers (falling back to O(log N) binary search on non-linear seeks), and shapes progress using unary transfer functions (`Curve`).
- **Composite Timelines**: `Clip` evaluates heterogeneous tracks simultaneously across a unified temporal coordinate space.
- **Analytical Harmonic Dynamics**: `Spring` implements a closed-form analytical second-order damped harmonic oscillator, evaluating exact displacement and velocity in continuous time without numerical Euler integration errors.
- **Cadence & Timesteps**: `Cadence` computes frame-rate independent exponential half-life decay. `FixedCadence` accumulates elapsed frame time and produces deterministic fixed-timestep simulation steps.

### 2.4 acircuit: Directed Computation Circuit

Located in [`acircuit/`](./acircuit/). Value computation graph featuring static topology validation and plan caching.

- **Endpoints & Connections**: `Socket` declares input or output endpoints with optional data type constraints and requirement tags. `Wire` defines directed connections linking an output socket to an input socket. Input sockets strictly enforce 1-to-1 connections; output sockets support 1-to-N fan-out.
- **Computation Units**: `Chip` represents a stateless computational node that declares socket schemas and evaluates input records.
- **Graph Ownership**: `Circuit` validates connections against cycles and missing required inputs, derives topological evaluation sequences via Kahn's algorithm, and caches the resulting execution plan (`_cachedPlan`).
- **Composite Encapsulation**: `Subcircuit` wraps an entire circuit inside a single composite chip, mapping boundary sockets and enabling hierarchical composition.

### 2.5 awgpu: Six-Tier WebGPU Hardware Engine

Located in [`awgpu/`](./awgpu/). Domain-agnostic WebGPU execution engine built across six distinct compositional levels:

- **Level 0 (Hardware Foundation)**: `Device` acquires adapters, logical devices, and queue handles. Exposes hardware telemetry (`limits`, `features`, `lost`) and attaches error hooks (`onError`, `onDeviceLost`).
- **Level 1 (Managed Memory)**: `Buffer` encapsulates sized allocations and uniform alignment. `BufferPool` recycles transient buffers across frames via power-of-two size bucketing. `Texture` handles 256-byte aligned row stride calculations (`write2D`) and external image copy (`copyExternalImage`). `Sampler` configures filtering and shadow comparison modes.
- **Level 2 (Data Structures)**: `StreamSet` groups planar or interleaved vertex attributes and index streams, automatically deriving 4-byte aligned vertex buffer layouts. `Target` manages swapchain backbuffers, offscreen multi-render-targets (MRT), MSAA resolution, and cached render pass descriptors. `SwapBuffer` manages ping-pong buffer pointers in O(1) time.
- **Level 3 (Resource Binding)**: `BindLayoutBuilder` constructs `GPUBindGroupLayout` descriptors with fluent method chaining. `BindTable` normalizes raw or wrapped resources into native binding descriptors. `BindTableCache` automatically deduplicates identical bind groups via deterministic composite hashing.
- **Level 4 (Hardware Pipelines)**: `RasterPipeline` and `ComputePipeline` compile shader modules with synchronous and asynchronous factory methods. `PipelineCache` provides deterministic 32-bit FNV-1a descriptor hashing and cached retrieval.
- **Level 5 (Command Sequencing & DAG)**: `RenderPassNode` and `ComputePassNode` record commands while filtering redundant driver state changes (tracking 8 bind group slots, vertex buffers, and index buffers). `PassGraph` schedules passes via Kahn topological sort, resolving read/write hazards and eliminating dead passes via reverse reachability from side-effect roots.

### 2.6 adiag: Diagnostic Telemetry Bus

Located in [`adiag/`](./adiag/). Structured diagnostics and causal error tracing without cross-boundary thrown exceptions.

- **Structured Records**: `Result` captures category types (`"ok"`, `"err"`, `"warn"`, `"info"`), machine-readable codes, templated messages, arbitrary key-value payloads, and parent error references (`ref`).
- **Circular History**: `Bus` logs diagnostic records into a pre-allocated circular ring buffer (default 1000 entries) in O(1) time, overwriting oldest records when capacity is reached.
- **Causal Traversal**: Tracing utilities traverse parent `ref` pointers to extract chronological root cause failure chains across asynchronous subsystem boundaries.

---

## 3. Core Engineering Invariants

1. **Zero-Allocation Hot Paths**:
   - Math operations in `alm` and interval evaluations in `atempo` write directly into destination buffers passed as `out` parameters.
   - Render targets in `awgpu` update swapchain views in place within pre-allocated descriptors, eliminating garbage collection pauses during animation and simulation loops.

2. **Dense Contiguous Memory**:
   - `aecs` stores component values and entity keys in packed, contiguous arrays (`ComponentSet`, `FloatSet`). Iterations execute directly over dense memory blocks without pointer-chasing scene graphs.

3. **Four-Tier Bind Frequency Slots**:
   - `awgpu` standardizes pipeline bindings into four update frequencies (`PerFrame = 0`, `PerPhase = 1`, `PerBatch = 2`, `PerInstance = 3`), filtering redundant GPU driver state updates between draws.

4. **Deterministic Plan Caching**:
   - Both `acircuit` and `awgpu` cache topological execution orders (`_cachedPlan` in `Circuit`, `_cachedSequence` in `PassGraph`), executing in O(1) time across subsequent frames unless graph topology is explicitly invalidated.

5. **Dual-Tier Hardware Interoperability**:
   - High-level abstractions expose raw underlying handles (`GPUDevice`, `GPUBuffer`, `GPUTexture`, `GPUCommandEncoder`). Callers can execute custom imperative passes alongside managed passes without translation overhead.

6. **Bounded Diagnostic Footprint**:
   - `adiag` uses bounded ring buffers for error logging, ensuring diagnostic instrumentation cannot cause runaway memory expansion.

---

## 4. End-to-End Composition Example

Demonstrates coordinating entity management, 3D mathematics, temporal spring dynamics, and WebGPU command execution across Atoolkit modules:

```typescript
import { EntityPool, ComponentSet, FloatSet, query2 } from "./aecs/index.js";
import { Vec3, Mat4 } from "./alm/index.js";
import { Spring } from "./atempo/index.js";
import { Device, Buffer, StreamSet, BindLayout, BindTable, RasterPipeline, Target, RenderPassNode } from "./awgpu/index.js";
import { Bus } from "./adiag/index.js";

// 1. Diagnostics & Hardware Foundation
const bus = new Bus(500);
const gfx = await Device.create({ canvas: "#viewport" });
bus.info({ code: "GPU_READY", raw: "Device acquired: $format$", data: { format: gfx.format } });

// 2. Entity Component Storage
const entities = new EntityPool();
const transforms = new FloatSet(16); // stores 4x4 matrix per entity
const tagSet = new ComponentSet<string>();

const player = entities.spawn();
transforms.set(player, Mat4.identity(new Mat4()));
tagSet.set(player, "ActivePlayer");

// 3. Temporal Harmonic Follower
const spring = new Spring({ stiffness: 180, damping: 14, mass: 1 });
spring.target = 5.0; // animate target elevation

// 4. Managed GPU Geometry & Uniforms
const posBuf = Buffer.createVertex(gfx, new Float32Array([-1, -1, 0,  1, -1, 0,  0, 1, 0]));
const uboBuf = Buffer.createUniform(gfx, 64);

const streams = new StreamSet().addStream(0, posBuf, "float32x3");
const target = Target.createScreen(gfx);

const bindLayout = BindLayout.builder()
    .addUniform(0, GPUShaderStage.VERTEX)
    .build(gfx);

const bindTable = BindTable.create(gfx, bindLayout, [
    { binding: 0, resource: uboBuf },
]);

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
    spring.step(deltaTime);
    const elevation = spring.position;

    // Process matching entities
    query2(transforms, tagSet, (entity, matrixView) => {
        Mat4.translation(0, elevation, -5, model);
        Mat4.mul(viewProj, model, mvp);
        uboBuf.write(gfx, mvp);
    });

    // Record and submit commands
    const encoder = gfx.createCommandEncoder("FrameEncoder");
    pass.execute(encoder);
    gfx.submit(encoder);
}
```