# AsczWeb

TypeScript computational toolkit and WebGPU graphics architecture providing cache-coherent sparse-set ECS, allocation-free 3D math, value computation circuits, temporal cadence evaluation, and domain-agnostic GPU execution.

Repository centers on `Atoolkit` as foundational computational layer, `WeebGfx` as high-level graphics framework, and `archive/` for preserved legacy implementations.

---

## Atoolkit Packages

`Atoolkit` provides zero-dependency computational modules designed for composability and raw hardware throughput:

| Package | Role | Key Capabilities | Documentation |
| :--- | :--- | :--- | :--- |
| **[`aecs`](./Atoolkit/aecs/ReadMe.md)** | Entity Component System | Sparse-dense storage (`ComponentSet`, `FloatSet`) with O(1) mutations, cache-coherent dense iteration, and dynamic set intersection joins (`join2`, `join3`). | [aecs ReadMe](./Atoolkit/aecs/ReadMe.md) |
| **[`acircuit`](./Atoolkit/acircuit/ReadMe.md)** | Value Computation Circuit | Directed computation circuit with typed socket endpoints (`Socket`), 1-to-N fan-out (`Wire`), computational chips (`Chip`), composite subcircuits (`Subcircuit`), Kahn topological ordering, and execution plan caching. | [acircuit ReadMe](./Atoolkit/acircuit/ReadMe.md) |
| **[`awgpu`](./Atoolkit/awgpu/ReadMe.md)** | Hardware WebGPU Engine | Domain-agnostic GPU execution engine featuring multi-pass render targets, 4-tier frequency bind slots, automated vertex strides, command pooling, and depth-only pipeline passes. | [awgpu ReadMe](./Atoolkit/awgpu/ReadMe.md) |
| **[`alm`](./Atoolkit/alm/ReadMe.md)** | 3D Linear Algebra | Native `Float32Array` vectors and matrices (`Mat4`, `Mat3`, `Vec2`, `Vec3`, `Vec4`, `Quat`, `Ray`, `AABB`, `Frustum`) supporting WebGPU [0, 1] clip space and out-parameter zero-allocation calls. | [alm ReadMe](./Atoolkit/alm/ReadMe.md) |
| **[`atempo`](./Atoolkit/atempo/ReadMe.md)** | Temporal Orchestration & Cadence | Continuous and stepped timeline sequencing (`Track`, `Clip`, `Curve`), analytical harmonic spring dynamics (`Spring`), exponential decays (`Cadence`, `FixedCadence`), and cyclic metronome phase coordinates (`Phase`, `Metronome`). | [atempo ReadMe](./Atoolkit/atempo/ReadMe.md) |
| **[`adiag`](./Atoolkit/adiag/ReadMe.md)** | Diagnostic Telemetry Bus | Structured diagnostics bus (`Bus`, `Result`) with circular ring buffer logging (default 1000 entries), templated message compilation, and pointer-based causal error chaining (`ref`). | [adiag ReadMe](./Atoolkit/adiag/ReadMe.md) |

---

## Graphics Framework

`WeebGfx` implements an API-agnostic graphics architecture and WebGPU rendering pipeline built directly on `Atoolkit`:

* **Core Resources**: CPU/GPU paired geometries (`MeshCPU`, `MeshGPU`), textures (`TextureCPU`, `TextureGPU`), shaders (`ShaderGPU`), and projection controllers (`Camera`).
* **ECS Integration**: Native components (`MeshCmp`, `ShaderCmp`, `TransformCmp`, `SkinCmp`, `CameraCmp`) linking render resources directly to `aecs` entities.
* **WebGPU Subsystem**: Hardware backend providing batch renderers (`RendererWGPU`, `MeshRendererWGPU`) and shader graph evaluation (`ShaderGraphWGPU`).

---

## Repository Structure

* `Atoolkit/`: Production computational toolkit modules
  * `aecs/`: Sparse-set Entity Component System
  * `acircuit/`: Socket-based value computation circuit
  * `awgpu/`: Hardware WebGPU execution engine
  * `alm/`: Allocation-free 3D linear algebra
  * `atempo/`: Temporal orchestration, cadence quantization, and spring dynamics
  * `adiag/`: Diagnostic telemetry bus and causal error tracer
* `WeebGfx/`: API-agnostic graphics abstractions and WebGPU renderer
  * `webgpu/`: WebGPU rendering pipeline and shader graph compiler
* `archive/`: Archived legacy modules preserved for reference (`acmp`, `aflow`, `agraph`, `awgl2`, legacy `awgpu`)

---

## Core Engineering Invariants

1. **Zero-Allocation Calling Convention**:
   * Math operations in `alm` and sampling routines in `atempo` write directly into destination buffers passed via `out` parameters (`Mat4.mul(viewProj, model, out)`), eliminating garbage collection pauses during simulation and render loops.

2. **Cache-Coherent Sparse Storage**:
   * `aecs` stores component values and entity keys in packed, contiguous arrays (`ComponentSet`, `FloatSet`). Iterations execute directly over dense memory blocks without pointer-chasing scene graphs.

3. **4-Tier GPU Bind Frequency Slots**:
   * `awgpu` organizes pipeline bindings into standard frequency tiers (`Pass = 0`, `Phase = 1`, `Material = 2`, `Instance = 3`), filtering redundant GPU driver state changes across draw batches.

4. **Causal Reference Chaining**:
   * Components record diagnostic telemetry to `adiag` without throwing exceptions across subsystem boundaries. Causal reference pointers (`ref`) preserve root cause traces across complex asynchronous pipelines.

5. **Topological Plan Caching**:
   * `acircuit` caches topological evaluation plans (`_cachedPlan`) across runs, invalidating execution order only upon explicit graph topology mutations.

6. **Enforced Package Namespacing**:
   * `Atoolkit` exposes packages strictly as qualified namespaces (`Acircuit`, `Alm`, `Aecs`, `Adiag`, `Awgpu`, `Atempo`). Internal domain primitives (`Device`, `Buffer`, `Chip`, `Bus`, `Entity`) remain concise while eliminating top-level name collisions.

---

## License

Academic and research evaluation license. All rights reserved.
