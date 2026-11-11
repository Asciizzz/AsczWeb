# Atoolkit Migration Guide

This document summarizes the API, lifecycle, and behavioral changes across `@asciiz/atoolkit` modules.

---

## 1. Package & Build Configuration

- **Single Canonical Build**: `Atoolkit/tsconfig.json` is the sole TypeScript configuration for building `@asciiz/atoolkit`. Per-module `tsconfig.json` files (`alm/tsconfig.json`, `adiag/tsconfig.json`, `tsconfig.base.json`) have been removed.
- **Consumer Type Isolation**: Non-WebGPU modules (`@asciiz/atoolkit/alm`, `aecs`, `atempo`, `acircuit`, `adiag`) compile cleanly under `"lib": ["ES2022"]` with `"types": []` and do not require DOM or `@webgpu/types` ambient declarations.
- **Subpath Exports**: All seven modules (`./alm`, `./aecs`, `./atempo`, `./acircuit`, `./adiag`, `./awgpu`, `./awasm`) and the root barrel (`.`) export matched ESM JavaScript (`import`) and TypeScript declaration (`types`) entry points under `dist/`.

---

## 2. `alm` (Linear Algebra & Spatial Math)

- **Standard Class Construction**: `Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat3`, and `Mat4` are constructed via `new` or static factory methods (`Vec3.create()`, `Mat4.identity()`, etc.) and preserve `Float32Array` prototype inheritance and `.length`.
- **Immutable Shared Constants**: All static constant vectors, quaternions, and matrices (`Vec2.ZERO`, `Vec3.UP`, `Quat.IDENTITY`, `Mat4.IDENTITY`, etc.) are frozen via `Object.freeze` and throw in strict mode if mutated in place.
- **Singular Matrix Handling**: `Mat3.invert`, `Mat4.invert`, and `Mat4.normalMatrix` return `null` when `|det| < 1e-12` and leave the `out` buffer unmodified on failure.
- **Normal Matrix Calculation**: `Mat4.normalMatrix(m, out)` computes the inverse-transpose of the upper-left 3x3 submatrix of `m`, preserving accuracy under non-uniform scaling.
- **Mat4 Decomposition**: `Mat4.decompose(m, outPos, outRot, outScale)` rejects perspective matrices (`m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] <= 0`) and singular scales (`< 1e-8`), returning `false` without corrupting outputs.
- **Clip-Space & Frustum Conventions**:
  - `Mat4.perspective` and `Mat4.ortho` default to WebGPU zero-to-one (`[0, 1]`) depth (`perspectiveZO`, `orthoZO`).
  - OpenGL `[-1, 1]` variants (`perspectiveNO`, `orthoNO`) and reversed-Z `[1, 0]` variants (`perspectiveReversedZ`, `orthoReversedZ`) are explicitly named.
  - `Frustum.fromViewProjection(vp, clipDepthMode)` accepts `"zero-to-one"` (default) or `"neg-one-to-one"`.
- **Antipodal `Vec3.slerp` Interpolation**:
  - `Vec3.slerp(a, b, t, out)` expects unit-direction vectors and handles general, near-parallel (`dot > 0.9995`), near-antipodal, and exact antipodal (`dot === -1`) pairs without returning a zero vector or `NaN`.
  - When `a` and `b` are exact antipodes, `Vec3.slerp` rotates by `PI` in the plane spanned by `a` and the coordinate axis least aligned with `a` (ties broken deterministically in `X`, `Y`, `Z` order).

---

## 3. `aecs` (Entity Component System)

- **Generational Entity Layout**:
  - `Entity` packs a 20-bit slot index (`ENTITY_INDEX_MASK = 0xFFFFF`), an 11-bit generation counter (`ENTITY_GEN_MASK = 0x7FF`), and a 1-bit alive flag (`ENTITY_ALIVE_BIT = 0x80000000`) into an unsigned 32-bit integer (`>>> 0`).
  - `NULL_ENTITY = 0` is never alive.
  - When a slot's 11-bit generation reaches `ENTITY_GEN_MASK`, `EntityPool.destroy()` permanently retires that slot instead of wrapping its generation counter and aliasing old handles.
- **`EntityPool.clear()` Invalidation**: `clear()` advances active slot generations instead of resetting to 0, ensuring handles issued before `clear()` remain invalid after subsequent `spawn()` calls.
- **Full-Handle Component Matching**: `ComponentSet` and `FloatSet` compare full `Entity` handles (`entities[denseIdx] === entity`) rather than raw slot indices. Stale-generation handles cannot read, overwrite, or delete components belonging to a newer generation at the same slot.
- **Structural Mutation Guards**: Calling `set()`, `delete()`, `clear()`, or `swap()` on a `ComponentSet` or `FloatSet` while iterating over it (including during `Query.each`, `query2`, or `query3`) throws an `Error`.

---

## 4. `atempo` (Temporal Orchestration & Cadence)

- **Time-Step Validation**: `Cadence.expDecay`, `Cadence.damp`, `FixedCadence.step`, and `Spring.updateScalar` / `updateArray` throw `RangeError` on negative or non-finite `dt`. `dt === 0` is a deterministic no-op.
- **`Cadence.damp` Signature**:
  ```ts
  Cadence.damp(
  	current: number,
  	target: number,
  	smoothTime: number,
  	maxSpeed: number,
  	dt: number,
  	velocityRef: [number] | Float32Array | Float64Array,
  	velocityIndex?: number
  ): number
  ```
- **`Spring` Analytical Solver**:
  - Constructed via `new Spring(frequencyHz = 4.0, dampingRatio = 1.0)`.
  - Supports `dampingRatio = 0` (undamped harmonic oscillation), `0 < dampingRatio < 1` (under-damped), `dampingRatio = 1` (critically damped), and `dampingRatio > 1` (over-damped).
  - Evaluates via `spring.updateScalar(position, velocity, target, dt, out)` and `spring.updateArray(positions, velocities, targets, dt)`.
- **Track Keyframe Validation, Cloning, and `duration`**:
  - `Track.addKey` rejects non-finite timestamps and replaces existing keys at identical timestamps without creating zero-length intervals.
  - `VecTrack`, `QuatTrack`, and `ColorTrack` clone input arrays on `addKey` and require an `out` buffer in `sample(time, out)`.
  - `Track.duration` returns the track's own keyframe span `endTime - startTime` (or `0` when the track has `0` or `1` keyframe) so `track.sampleRatio(r)` maps `[0, 1]` onto `[startTime, endTime]` for positive, negative, and mixed-sign keyframe ranges.
  - `Clip.duration` retains clip timeline semantics (`max(endTime) - min(0, min(startTime))` across non-empty tracks).

---

## 5. `acircuit` (Directed Computation Circuit)

- **Structured Endpoint Indexing**: Internal wire indices use structured chip/socket maps rather than colon-split string keys. Chip IDs and socket names may contain `:`, `/`, or any other character.
- **Port Schema Locking**: While a `Chip` is attached to a `Circuit`, mutating its ports (`addInput`, `addOutput`, `removeInput`, `removeOutput`) throws an `Error`. Remove the chip from the circuit first.
- **Transactional Graph Mutations**:
  - `connect()` rejects self-loops (`fromChipId === toChipId`), validates endpoint existence and `canConnectInput`, and only replaces an existing input wire after validation succeeds.
  - `replaceChip()`, `merge()`, and `CompositeChip.flattenInto()` preflight all IDs and rewired connections before mutating circuit state, rolling back cleanly on failure.
- **Defensive Plan Snapshots**: `circuit.topoSort()` returns a defensive copy of the topological execution order so caller array mutations cannot corrupt the cached plan.
- **Branch-Isolated Error Handling**: Under `errorHandling: "skip-dependents"`, a throwing chip skips only its transitive downstream dependents while independent branches continue executing.

---

## 6. `adiag` (Diagnostic Telemetry Bus)

- **`Bus` API**:
  - Constructed via `new Bus({ maxHistory?: number, onSubscriberError?: (error: unknown, diagnostic: Diagnostic) => void })`.
  - `maxHistory` must be a non-negative integer (`0` disables history retention while still delivering to live subscribers).
  - Emits structured `Diagnostic<TPayload>` records via `emit()`, `info()`, `warn()`, `error()`, and `fatal()`.
  - Subscribers registered via `bus.on(subscriber)` are isolated: a throwing subscriber does not block delivery to subsequent subscribers.
  - Causal chains are linked via `causeId` (`options.cause` accepts a `Diagnostic` or numeric ID) and traversed via `bus.traceCauses(diagnosticOrId)`.

---

## 7. `awgpu` (WebGPU Execution Engine)

- **Canonical Factory & Method Names**:
  - `Buffer.createVertex`, `Buffer.createUniform`, `Buffer.createStorage`, and `Buffer.createIndex` are replaced by `Buffer.vertex(device, size, initialData?, label?)`, `Buffer.uniform(...)`, `Buffer.storage(...)`, `Buffer.index(...)`, and `Buffer.create(device, desc)`.
  - `Buffer.read` is replaced by `Buffer.readback(device, srcOffset?, byteLength?, stagingBuffer?)`.
  - `Texture.create`, `Texture.create3D`, `Texture.createCube`, and `Texture.copyExternalImage` are replaced by `Texture.create2D(device, desc)`, `Texture.createDepth(device, desc)`, and `Texture.fromNative(nativeTexture, desc?)`.
  - `Sampler.createLinear`, `Sampler.createNearest`, and `Sampler.createComparison` are replaced by `Sampler.create(device, desc?)` and `Sampler.fromNative(nativeSampler, label?)`.
  - `Device.createHeadless` is replaced by `Device.create(config?)` (which supports headless initialization when `canvas` is omitted) and `Device.fromNative(gpuDevice, options?)`.
  - `BindTable.getOrCreate` and `BindTable.clearCache` are replaced by explicit `BindTableCache` instances (`new BindTableCache(device?, { maxEntries? })`) and `BindTable.create(device, { layout, entries, slot?, label?, dynamicOffsetCount? })`.
- **Device-Scoped Caches & Repeatable `clear()` Lifecycle**:
  - `PipelineCache`, `BindTableCache`, and `BufferPool` partition cached resources per `GPUDevice` via `WeakMap<GPUDevice, ...>`.
  - `PipelineCache.clear()` and `BindTableCache.clear()` detach per-device stores so repeated populate -> `clear()` -> populate cycles on the same `GPUDevice` report accurate counts (`size`, `rasterCount`, `computeCount`) and isolate pre-clear in-flight async pipeline compilations from post-clear compilations.
  - `Device.fromNative(gpuDevice)` marks the `GPUDevice` as borrowed (`ownsDevice = false`); `device.destroy()` never destroys a borrowed `GPUDevice`.
- **Default Texture View Deduplication & Bounded Reverse Index**:
  - `Texture.view` and `resolveTextureView(rawTexture)` share a single cached default `GPUTextureView` per `GPUTexture` via a `WeakMap<GPUTexture, GPUTextureView>`.
  - Binding either a `Texture` wrapper or its `texture.native` in `BindTableCache.getOrCreate()` resolves to that same default `GPUTextureView` without allocating transient views, while explicit `GPUTextureView` handles remain distinct cache keys.
  - `BindTableCache` cleans up per-resource reverse-index sets when entries are evicted by LRU capacity limits or `evictResource(res)`.
- **Buffer Uploads & Readback**:
  - `Buffer.write(device, data, dstByteOffset, srcByteOffset?, byteLength?)` normalizes typed array views (`data.byteOffset`, `data.byteLength`) and enforces 4-byte size and offset alignment before calling `queue.writeBuffer`.
  - `Buffer.writePadded(device, data, dstByteOffset, srcByteOffset?, byteLength?)` pads tail bytes to a 4-byte multiple when uploading unaligned byte payloads.
  - `Buffer.readback(device, srcOffset?, byteLength?, stagingBuffer?)` resolves to a `Uint8Array` copy and guarantees cleanup of owned temporary staging buffers in `finally`.
- **StreamSet & Slice Binding**:
  - `StreamSet` separates `offset` (intra-vertex attribute byte offset) from `bufferOffset` (extra buffer binding offset) and uses `add`, `addVertex`, `addInterleavedVertex`, and `setIndex`.
  - Vertex strides default to `max(attr.offset + formatByteSize)` across attributes in a slot.
- **Texture Uploads**:
  - `Texture.write2D(device, data, options?)` validates uncompressed formats (or explicit `bytesPerPixel`), `bytesPerRow >= width * bytesPerPixel`, `rowsPerImage >= height`, and source byte capacity before uploading via `queue.writeTexture` (tight row stride is supported directly by `queue.writeTexture`; 256-byte row alignment applies to `copyBufferToTexture` / `copyTextureToBuffer`).
- **Target Read-Only Attachments, Ownership, & Resize**:
  - `target.colorTargets`, `target.depthTarget`, and `target.colorTextures` are read-only frozen snapshots (`ReadonlyArray<Readonly<ColorTargetDesc>>`, `Readonly<DepthTargetDesc> | undefined`, `ReadonlyArray<Texture>`).
  - Mutate attachments exclusively through `target.setColorTarget(index, desc, options?)`, `target.setResolveTarget(index, resolveTarget)`, `target.setDepthTarget(desc, options?)`, or `target.resize(device, width, height, options?)`, which update the frozen snapshots and increment `target.generation`.
  - `Target` tracks owned vs. borrowed textures, preserves `depthClearValue = 0.0` via nullish coalescing (`?? 1.0`), and supports `{ retiredOut?: Texture[] }` on `resize()`, `setColorTarget()`, and `setDepthTarget()`.
- **PassGraph Hazard Scheduling & Culling**:
  - Tracks RAW, WAR, and WAW resource hazards across buffers, textures, and texture views (resolving `GPUTextureView` back to its parent `GPUTexture`).
  - Treats screen targets (including MSAA screen passes where `resolveTarget === null`) and `.sideEffect(true)` passes as live roots during dead-pass culling.
  - Automatically retires cached plans from superseded target generations and invalidates when pass side-effect flags, dependencies, or target generations change.

---

## 8. `awasm` (WebAssembly Runtime & Memory Coordinator)

> **Experimental Status**: The concurrency and runtime orchestration utilities in `awasm` (`SharedMemory`, `AtomicQueue`, `WorkerPool`, `ModuleLoader`, `HostBridge`, `WasmInstance`) are marked **experimental** and subject to refinement as browser/worker WebAssembly threading capabilities evolve.

- **`WasmMemory` & `MemoryView`**:
  - `WasmMemory.fromNative(rawMemory, expectedPages?)` derives actual page count from `rawMemory.buffer.byteLength >>> 16`.
  - `WasmMemory` reconciles external or guest-initiated `memory.grow` operations automatically when `buffer`, `byteLength`, `pageCount`, or `generation` are accessed.
  - `MemoryView` returns fresh typed array subviews (`asUint8`, `asInt32`, `asUint32`, `asFloat32`, `asFloat64`, `asDataView`) rebound to the latest `ArrayBuffer` across growths.
- **`LinearArena` & `BlockPool`**:
  - `LinearArena` operates strictly within its fixed `[baseOffset, baseOffset + byteCapacity)` window and never calls `memory.grow()` implicitly.
  - `BlockPool` validates alignment and allocation bitmaps on `release(ptr)`, throwing on unallocated or double-released pointers.
- **`AtomicQueue` (SPSC)**:
  - Explicitly single-producer / single-consumer (SPSC) using unsigned 32-bit monotonic indices (`>>> 0`).
  - Use `AtomicQueue.initialize(sab, byteOffset, capacity)` to zero-initialize a new queue in shared memory, and `AtomicQueue.attach(sab, byteOffset, capacity)` to attach a worker/consumer without wiping live state.
- **`WorkerPool`**:
  - Preserves all positional arguments (`arg0`, `arg1`, ...) in `dispatch(taskIndex, ...args)`.
  - Supports `maxPendingTasks` backpressure, per-task `timeoutMs` and `AbortSignal` via `dispatchWithOptions`, and clean failure/termination lifecycle.
- **UTF-8 & ABI**:
  - `HostBridge.registerDefaultEnv` decodes guest `log` and `abort_utf8` strings as UTF-8.
  - `StructLayout.finish(packAlignment?)` supports natural alignment (`Math.min(fieldAlignment, packAlignment)`) and returns deeply frozen `StructDescriptor` objects.
