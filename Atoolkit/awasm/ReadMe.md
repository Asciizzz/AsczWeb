# awasm: WebAssembly Computational Runtime & Linear Memory Coordinator

Low-level WebAssembly execution runtime, linear memory arena coordinator, binary inspector, and multi-threaded worker dispatch framework.

All modules share common engineering invariants: zero-allocation calling conventions on hot paths, deterministic linear memory layouts, detachment-resilient views, and dual-tier runtime interoperability.

---

## 1. Module Architecture

| Domain | File | Primary Types | Memory & Execution Invariants |
| :--- | :--- | :--- | :--- |
| **Memory** | `memory/wasm-memory.ts` | `WasmMemory`, `MemoryDescriptor` | Direct ownership of `WebAssembly.Memory`; tracks 64 KiB page counts; generation-based resize notification hooks. |
| | `memory/linear-arena.ts` | `LinearArena` | Monotonic bump allocation; O(1) time complexity; 4/8/16-byte power-of-two alignment; zero garbage collection. |
| | `memory/block-pool.ts` | `BlockPool` | Fixed-size slab recycling; intrusive single-linked free list stored inside idle blocks; O(1) acquire and release. |
| | `memory/memory-view.ts` | `MemoryView` | Detachment-resilient typed array views; auto-synchronizes with `WasmMemory` generation counters. |
| **ABI** | `abi/layout.ts` | `StructLayout`, `StructDescriptor` | Declarative C/Rust `repr(C)` struct layout; natural alignment calculation; SIMD 16-byte vector support. |
| | `abi/slice.ts` | `Slice` | Guest memory span `(ptr, length)`; zero-copy sub-array views over active linear memory buffer. |
| | `abi/string-buffer.ts` | `StringBuffer` | UTF-8 encoding and decoding; direct memory writes via singleton `TextEncoder` and `TextDecoder`. |
| **Runtime** | `runtime/module-inspector.ts` | `ModuleInspector`, `ModuleManifest` | Synchronous static introspection of uninstantiated modules; validation of export and import signatures. |
| | `runtime/host-bridge.ts` | `HostBridge`, `HostEnvOptions` | Host function import table builder; default high-resolution clock and panic/abort hook dispatchers. |
| | `runtime/module-loader.ts` | `ModuleLoader` | Streaming compilation via `WebAssembly.compileStreaming`; optional IndexedDB compiled bytecode caching. |
| | `runtime/wasm-instance.ts` | `WasmInstance<T>` | Managed instance wrapper; pairs module exports with linear memory; dual-tier handle exposure. |
| **Thread** | `thread/shared-memory.ts` | `SharedMemory`, `WaitResult` | Thread-safe `SharedArrayBuffer` memory; 32-bit atomic wait and notify synchronization. |
| | `thread/atomic-queue.ts` | `AtomicQueue` | Lock-free circular ring buffer; power-of-two capacity; atomic load and store operations. |
| | `thread/worker-pool.ts` | `WorkerPool` | Dedicated Web Worker pool; shared module and memory broadcast without message serialization. |

---

## 2. Subsystem Specifications

### 2.1 Memory Subsystem

```typescript
import { WasmMemory, LinearArena, BlockPool, MemoryView } from "@asciiz/atoolkit/awasm";

const memory = new WasmMemory({ initial: 2, maximum: 16 });
const arena = new LinearArena(memory, 0, 65536);
const view = new MemoryView(memory);

const ptr = arena.allocate(128, 16);
const floatView = view.asFloat32(ptr, 32);
```

#### WasmMemory
- **Class Responsibility**: Direct lifecycle ownership of native `WebAssembly.Memory`. Coordinates page growth tracking, calculates capacity boundaries, and triggers resize listener events when memory expansion detaches underlying buffers.
- **Method Contracts**:
  - `constructor(descriptor: MemoryDescriptor)`: Instantiates native `WebAssembly.Memory` with initial and optional maximum page constraints.
  - `grow(deltaPages: number): number`: Invokes native `memory.grow()`, increments generation counter, notifies registered resize listeners, and returns previous page count.
  - `onResize(listener: MemoryResizeListener): () => void`: Registers callback invoked when buffer is reallocated; returns unregister function.
  - `get buffer(): ArrayBuffer`: Accesses current underlying native buffer.
  - `get handle(): WebAssembly.Memory`: Accesses native WebAssembly memory handle.
  - `get pageCount(): number`: Returns current page count.
  - `get generation(): number`: Returns allocation generation index.
- **Operational Invariants**:
  - Every WebAssembly page is exactly 65,536 bytes (64 KiB).
  - Generation index increments monotonically on each successful memory expansion.

#### LinearArena
- **Class Responsibility**: Monotonic bump allocation within a dedicated address span of linear memory. Supports O(1) stack-based allocation, watermark rewinding, and total reset.
- **Method Contracts**:
  - `constructor(memory: WasmMemory, baseOffset?: number, byteCapacity?: number)`: Binds arena to byte region within specified memory instance.
  - `allocate(byteSize: number, alignment?: number): number`: Advances internal offset pointer to next aligned boundary. Returns byte pointer.
  - `mark(): number`: Returns current allocation watermark pointer.
  - `rewind(mark: number): void`: Restores allocation offset to specified watermark.
  - `reset(): void`: Resets allocation offset back to base pointer.
- **Operational Invariants**:
  - O(1) time complexity on allocation, mark, rewind, and reset paths.
  - Alignment must be a power of two (typically 4, 8, or 16). 16-byte alignment satisfies SIMD v128 requirements.
  - Zero JavaScript heap allocations during allocation operations.

#### BlockPool
- **Class Responsibility**: Recycles fixed-size memory slots inside linear memory using an intrusive free list.
- **Method Contracts**:
  - `constructor(memory: WasmMemory, offset: number, blockCount: number, blockSize: number)`: Formats free-list links across block capacity.
  - `acquire(): number`: Pops next free block offset in O(1) time. Returns -1 when pool is exhausted.
  - `release(pointer: number): void`: Pushes block offset back onto free-list stack in O(1) time.
- **Operational Invariants**:
  - Intrusive links store next free block pointers as 32-bit unsigned integers in the first 4 bytes of idle blocks.
  - Minimum block size is 4 bytes.
  - Zero heap allocation during acquisition and release operations.

#### MemoryView
- **Class Responsibility**: Provides detachment-resilient typed array views over linear memory. Revalidates views against `WasmMemory` generation counter.
- **Method Contracts**:
  - `asUint8(byteOffset: number, length: number): Uint8Array`: Returns `Uint8Array` view.
  - `asInt32(byteOffset: number, length: number): Int32Array`: Returns `Int32Array` view.
  - `asUint32(byteOffset: number, length: number): Uint32Array`: Returns `Uint32Array` view.
  - `asFloat32(byteOffset: number, length: number): Float32Array`: Returns `Float32Array` view.
  - `asFloat64(byteOffset: number, length: number): Float64Array`: Returns `Float64Array` view.
  - `asDataView(byteOffset: number, byteLength: number): DataView`: Returns `DataView` window.
- **Operational Invariants**:
  - Validates byte alignments according to typed array specifications.
  - Reacquires backing buffer references automatically when memory generation changes.

---

### 2.2 ABI Subsystem

```typescript
import { StructLayout, Slice, StringBuffer } from "@asciiz/atoolkit/awasm";

const ParticleLayout = new StructLayout("Particle")
    .field("position", "f32", 4) // 16 bytes (SIMD aligned)
    .field("velocity", "f32", 4) // 16 bytes
    .field("id", "u32", 1)       // 4 bytes
    .finish();

const stringSlice = StringBuffer.write("Simulation payload", arena, memory);
const text = StringBuffer.read(stringSlice.ptr, stringSlice.length, memory);
```

#### StructLayout
- **Class Responsibility**: Computes byte offsets, member alignments, and stride calculations matching C/Rust `repr(C)` specifications.
- **Method Contracts**:
  - `field(name: string, type: StructFieldType, count?: number): this`: Appends field with natural alignment.
  - `finish(packAlignment?: number): StructDescriptor`: Computes total stride padded to largest alignment boundary.
  - `static getField(descriptor: StructDescriptor, name: string): StructField`: Retrieves field descriptor by name.
- **Operational Invariants**:
  - Offsets conform to standard natural alignment constraints.
  - Explicit support for 16-byte alignment (`v128`).

#### Slice
- **Class Responsibility**: Encapsulates guest memory window `(ptr, length)` without copying or owning buffer memory.
- **Method Contracts**:
  - `readUint8(memory: WasmMemory): Uint8Array`: Returns sub-array byte window.
  - `readFloat32(memory: WasmMemory): Float32Array`: Returns 4-byte aligned `Float32Array` window.
  - `readUint32(memory: WasmMemory): Uint32Array`: Returns 4-byte aligned `Uint32Array` window.
  - `copyFrom(source: ArrayBufferView, memory: WasmMemory): void`: Copies source bytes into slice address span.
- **Operational Invariants**:
  - Value object with zero direct heap allocations.
  - Bounds checked against target memory byte length.

#### StringBuffer
- **Class Responsibility**: Encodes and decodes UTF-8 strings directly into and out of guest linear memory.
- **Method Contracts**:
  - `write(text: string, arena: LinearArena, memory: WasmMemory): Slice`: Encodes UTF-8 bytes into linear arena and appends null terminator.
  - `read(ptr: number, length: number, memory: WasmMemory): string`: Decodes UTF-8 span into JavaScript string.
  - `readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes?: number): string`: Scans for null terminator and decodes string.
- **Operational Invariants**:
  - Uses singleton `TextEncoder` and `TextDecoder` instances.

---

### 2.3 Runtime Subsystem

```typescript
import { ModuleLoader, ModuleInspector, HostBridge, WasmInstance } from "@asciiz/atoolkit/awasm";

const module = await ModuleLoader.compile(wasmBytes);
const manifest = ModuleInspector.inspect(module);

const bridge = new HostBridge()
    .registerDefaultEnv()
    .register("custom", "compute_seed", () => 42);

const instance = await WasmInstance.instantiate(module, bridge.build());
const result = instance.call<number>("run", 100);
```

#### ModuleInspector
- **Class Responsibility**: Static introspection of compiled `WebAssembly.Module` without running start code or allocating memory.
- **Method Contracts**:
  - `inspect(module: WebAssembly.Module): ModuleManifest`: Extracts arrays of exports, imports, and memory declarations.
  - `validate(bytes: BufferSource): boolean`: Invokes native `WebAssembly.validate()`.
- **Operational Invariants**:
  - Synchronous execution with zero instantiation overhead.

#### HostBridge
- **Class Responsibility**: Assembles host function import tables for WebAssembly instantiation.
- **Method Contracts**:
  - `register(moduleName: string, exportName: string, fn: any): this`: Injects host function pointer.
  - `registerModule(moduleName: string, functions: Record<string, any>): this`: Injects module map.
  - `registerDefaultEnv(options?: HostEnvOptions): this`: Injects standard `now`, `abort`, and `log` hooks.
  - `build(): WebAssembly.Imports`: Produces structured imports dictionary.
- **Operational Invariants**:
  - Direct function references with zero wrapper translation during guest invocations.

#### ModuleLoader
- **Class Responsibility**: Acquires and compiles WebAssembly bytecode from streaming responses, promises, or raw buffers.
- **Method Contracts**:
  - `compile(source: BufferSource | Response | Promise<Response>): Promise<WebAssembly.Module>`: Executes streaming or buffered compilation.
  - `compileCached(key: string, sourceProvider: () => Promise<BufferSource | Response>): Promise<WebAssembly.Module>`: Caches compiled modules in IndexedDB.
- **Operational Invariants**:
  - Prioritizes `WebAssembly.compileStreaming` when given response streams.

#### WasmInstance
- **Class Responsibility**: Managed runtime container binding compiled module, active native instance, and linear memory coordinator.
- **Method Contracts**:
  - `instantiate<T>(module: WebAssembly.Module, imports?: WebAssembly.Imports, memory?: WasmMemory): Promise<WasmInstance<T>>`: Instantiates module.
  - `call<TResult>(name: string, ...args: number[]): TResult`: Dispatches function call by export name.
  - `get exports(): T`: Accesses typed exports.
  - `get handle(): WebAssembly.Instance`: Accesses native instance handle.
  - `get memory(): WasmMemory`: Accesses linear memory coordinator.
- **Operational Invariants**:
  - Automatically identifies exported `WebAssembly.Memory` if not explicitly supplied.

---

### 2.4 Thread Subsystem

```typescript
import { SharedMemory, AtomicQueue, WorkerPool } from "@asciiz/atoolkit/awasm";

const sharedMem = new SharedMemory({ initial: 4, maximum: 16 });
const queue = new AtomicQueue(sharedMem.buffer, 0, 128);

const pool = new WorkerPool("./worker.js", 4);
await pool.initialize(compiledModule, sharedMem);
```

#### SharedMemory
- **Class Responsibility**: Allocates thread-safe `WebAssembly.Memory` backed by `SharedArrayBuffer`. Coordinates atomic wait and notify operations.
- **Method Contracts**:
  - `constructor(descriptor: SharedMemoryDescriptor)`: Instantiates native shared memory.
  - `wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult`: Executes `Atomics.wait`.
  - `notify(byteOffset: number, count?: number): number`: Executes `Atomics.notify`.
  - `load(byteOffset: number): number`: Executes `Atomics.load`.
  - `store(byteOffset: number, value: number): number`: Executes `Atomics.store`.
- **Operational Invariants**:
  - Requires explicit maximum page count per WebAssembly standard.
  - Byte offsets must be 4-byte aligned for 32-bit atomics.

#### AtomicQueue
- **Class Responsibility**: Lock-free circular ring buffer in shared linear memory for inter-thread task dispatch.
- **Method Contracts**:
  - `constructor(buffer: SharedArrayBuffer, byteOffset: number, capacityPowerOfTwo?: number)`: Binds ring buffer.
  - `enqueue(value: number): boolean`: Appends 32-bit integer. Returns false when full.
  - `dequeue(): number | null`: Pops 32-bit integer. Returns null when empty.
  - `get length(): number`: Returns pending count.
- **Operational Invariants**:
  - Power-of-two capacity for bitwise mask wrapping.
  - Lock-free synchronization via `Atomics.load` and `Atomics.store`.

#### WorkerPool
- **Class Responsibility**: Manages pool of Web Workers executing identical WebAssembly modules across shared linear memory.
- **Method Contracts**:
  - `constructor(workerScriptUrl: string | URL, concurrency?: number)`: Spawns worker threads.
  - `initialize(module: WebAssembly.Module, memory: SharedMemory): Promise<void>`: Broadcasts module and shared memory to workers.
  - `dispatch<T>(taskIndex: number, arg0?: number, arg1?: number): Promise<T>`: Posts task to worker.
  - `terminate(): void`: Terminates all active workers.
- **Operational Invariants**:
  - Workers receive module and memory handles via structured cloning.
  - Workers operate directly on shared linear memory without message serialization.
