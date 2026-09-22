# Awasm

Domain-agnostic WebAssembly computational engine managing linear memory allocation, bump arenas, intrusive slab pools, detachment-resilient typed views, binary introspection, declarative struct layouts, streaming compilation, host import tables, and lock-free multi-worker synchronization.

Built on progressive disclosure of runtime control, zero-allocation hot paths, and strict compositional modularity across orthogonal functional subsystems.

---

## Table of Contents

- [Awasm](#awasm)
  - [Table of Contents](#table-of-contents)
  - [1. Architecture & Execution Model](#1-architecture--execution-model)
    - [1.1 Subsystem Overview](#11-subsystem-overview)
    - [1.2 Core Invariants](#12-core-invariants)
    - [1.3 Memory Model & Alignment](#13-memory-model--alignment)
  - [2. Linear Memory Subsystem](#2-linear-memory-subsystem)
    - [2.1 WasmMemory](#21-wasmmemory)
      - [`constructor(descriptor: MemoryDescriptor)`](#constructordescriptor-memorydescriptor)
      - [`static fromNative(memory: WebAssembly.Memory, initialPages?: number): WasmMemory`](#static-fromnativememory-webassemblymemory-initialpages-number-wasmmemory)
      - [`grow(deltaPages: number): number`](#growdeltapages-number-number)
      - [`onResize(listener: MemoryResizeListener): () => void`](#onresizelistener-memoryresizelistener---void)
    - [2.2 LinearArena](#22-lineararena)
      - [`constructor(memory: WasmMemory, baseOffset?: number, byteCapacity?: number)`](#constructormemory-wasmmemory-baseoffset-number-bytecapacity-number)
      - [`allocate(byteSize: number, alignment?: number): number`](#allocatebytesize-number-alignment-number-number)
      - [`mark(): number`](#mark-number)
      - [`rewind(mark: number): void`](#rewindmark-number-void)
      - [`reset(): void`](#reset-void)
    - [2.3 BlockPool](#23-blockpool)
      - [`constructor(memory: WasmMemory, offset: number, blockCount: number, blockSize: number)`](#constructormemory-wasmmemory-offset-number-blockcount-number-blocksize-number)
      - [`acquire(): number`](#acquire-number)
      - [`release(pointer: number): void`](#releasepointer-number-void)
    - [2.4 MemoryView](#24-memoryview)
      - [`constructor(memory: WasmMemory)`](#constructormemory-wasmmemory)
      - [`asUint8(byteOffset: number, length: number): Uint8Array`](#asuint8byteoffset-number-length-number-uint8array)
      - [`asInt32(byteOffset: number, length: number): Int32Array`](#asint32byteoffset-number-length-number-int32array)
      - [`asUint32(byteOffset: number, length: number): Uint32Array`](#asuint32byteoffset-number-length-number-uint32array)
      - [`asFloat32(byteOffset: number, length: number): Float32Array`](#asfloat32byteoffset-number-length-number-float32array)
      - [`asFloat64(byteOffset: number, length: number): Float64Array`](#asfloat64byteoffset-number-length-number-float64array)
      - [`asDataView(byteOffset: number, byteLength: number): DataView`](#asdataviewbyteoffset-number-bytelength-number-dataview)
  - [3. ABI & Data Marshalling](#3-abi--data-marshalling)
    - [3.1 StructLayout](#31-structlayout)
      - [`constructor(name?: string)`](#constructorname-string)
      - [`field(name: string, type: StructFieldType, count?: number, explicitAlignment?: number): this`](#fieldname-string-type-structfieldtype-count-number-explicitalignment-number-this)
      - [`finish(packAlignment?: number): StructDescriptor`](#finishpackalignment-number-structdescriptor)
      - [`static getField(descriptor: StructDescriptor, name: string): StructField`](#static-getfielddescriptor-structdescriptor-name-string-structfield)
    - [3.2 Slice](#32-slice)
      - [`constructor(ptr: number, length: number)`](#constructorptr-number-length-number)
      - [`readUint8(memory: WasmMemory): Uint8Array`](#readuint8memory-wasmmemory-uint8array)
      - [`readFloat32(memory: WasmMemory): Float32Array`](#readfloat32memory-wasmmemory-float32array)
      - [`readUint32(memory: WasmMemory): Uint32Array`](#readuint32memory-wasmmemory-uint32array)
      - [`copyFrom(source: ArrayBufferView, memory: WasmMemory): void`](#copyfromsource-arraybufferview-memory-wasmmemory-void)
    - [3.3 StringBuffer](#33-stringbuffer)
      - [`static write(text: string, arena: LinearArena, memory: WasmMemory): Slice`](#static-writetext-string-arena-lineararena-memory-wasmmemory-slice)
      - [`static read(ptr: number, length: number, memory: WasmMemory): string`](#static-readptr-number-length-number-memory-wasmmemory-string)
      - [`static readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes?: number): string`](#static-readnullterminatedptr-number-memory-wasmmemory-maxscanbytes-number-string)
  - [4. Binary & Runtime Lifecycle](#4-binary--runtime-lifecycle)
    - [4.1 ModuleLoader](#41-moduleloader)
      - [`static compile(source: BufferSource | Response | Promise<Response>): Promise<WebAssembly.Module>`](#static-compilesource-buffersource--response--promiseresponse-promisewebassemblymodule)
      - [`static compileCached(key: string, sourceProvider: () => Promise<BufferSource | Response>): Promise<WebAssembly.Module>`](#static-compilecachedkey-string-sourceprovider---promisebuffersource--response-promisewebassemblymodule)
    - [4.2 ModuleInspector](#42-moduleinspector)
      - [`static inspect(module: WebAssembly.Module): ModuleManifest`](#static-inspectmodule-webassemblymodule-modulemanifest)
      - [`static validate(bytes: BufferSource): boolean`](#static-validatebytes-buffersource-boolean)
    - [4.3 HostBridge](#43-hostbridge)
      - [`register(moduleName: string, exportName: string, fn: any): this`](#registermodulename-string-exportname-string-fn-any-this)
      - [`registerModule(moduleName: string, functions: Record<string, any>): this`](#registermodulemodulename-string-functions-recordstring-any-this)
      - [`registerDefaultEnv(options?: HostEnvOptions): this`](#registerdefaultenvoptions-hostenvoptions-this)
      - [`build(): WebAssembly.Imports`](#build-webassemblyimports)
    - [4.4 WasmInstance](#44-wasminstance)
      - [`static instantiate<T>(module: WebAssembly.Module, imports?: WebAssembly.Imports, memory?: WasmMemory): Promise<WasmInstance<T>>`](#static-instantiatetmodule-webassemblymodule-imports-webassemblyimports-memory-wasmmemory-promisewasminstancet)
      - [`call<TResult>(name: string, ...args: number[]): TResult`](#calltresultname-string-args-number-tresult)
  - [5. Threading & Concurrency](#5-threading--concurrency)
    - [5.1 SharedMemory](#51-sharedmemory)
      - [`constructor(descriptor: SharedMemoryDescriptor)`](#constructordescriptor-sharedmemorydescriptor)
      - [`wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult`](#waitbyteoffset-number-expectedvalue-number-timeoutms-number-waitresult)
      - [`notify(byteOffset: number, count?: number): number`](#notifybyteoffset-number-count-number-number)
      - [`load(byteOffset: number): number`](#loadbyteoffset-number-number)
      - [`store(byteOffset: number, value: number): number`](#storebyteoffset-number-value-number-number)
    - [5.2 AtomicQueue](#52-atomicqueue)
      - [`constructor(buffer: SharedArrayBuffer, byteOffset: number, capacityPowerOfTwo?: number)`](#constructorbuffer-sharedarraybuffer-byteoffset-number-capacitypoweroftwo-number)
      - [`enqueue(value: number): boolean`](#enqueuevalue-number-boolean)
      - [`dequeue(): number | null`](#dequeue-number--null)
      - [`static requiredBytes(capacityPowerOfTwo: number): number`](#static-requiredbytescapacitypoweroftwo-number-number)
    - [5.3 WorkerPool](#53-workerpool)
      - [`constructor(workerScriptUrl: string | URL, concurrency?: number)`](#constructorworkerscripturl-string--url-concurrency-number)
      - [`initialize(module: WebAssembly.Module, memory: SharedMemory): Promise<void>`](#initializemodule-webassemblymodule-memory-sharedmemory-promisevoid)
      - [`dispatch<T>(taskIndex: number, arg0?: number, arg1?: number): Promise<T>`](#dispatchttaskindex-number-arg0-number-arg1-number-promiset)
      - [`terminate(): void`](#terminate-void)
  - [6. Usage Patterns](#6-usage-patterns)
    - [6.1 Bump Allocation with Watermark Rewind](#61-bump-allocation-with-watermark-rewind)
    - [6.2 Detachment-Resilient Views across Memory Growth](#62-detachment-resilient-views-across-memory-growth)
    - [6.3 Host Import Bridge & Instance Invocation](#63-host-import-bridge--instance-invocation)
    - [6.4 Shared Memory & Atomic Task Queue](#64-shared-memory--atomic-task-queue)

---

## 1. Architecture & Execution Model

### 1.1 Subsystem Overview

Awasm is organized across four orthogonal functional domains. Subsystems operate as standalone computational components:

| Subsystem | Directory | Description | Primary Exports |
| :--- | :--- | :--- | :--- |
| **Linear Memory** | `memory/` | Page growth tracking, monotonic bump arenas, intrusive slab pools, detachment-resilient views | `WasmMemory`, `LinearArena`, `BlockPool`, `MemoryView` |
| **ABI & Marshalling** | `abi/` | Declarative C/Rust struct layouts, guest memory slices, zero-copy UTF-8 string encoding and decoding | `StructLayout`, `Slice`, `StringBuffer` |
| **Binary & Runtime** | `runtime/` | Streaming compilation, binary manifest inspection, host import table assembly, managed instances | `ModuleLoader`, `ModuleInspector`, `HostBridge`, `WasmInstance` |
| **Threading & Concurrency** | `thread/` | Multi-worker execution, shared memory atomics, lock-free circular ring buffers | `SharedMemory`, `AtomicQueue`, `WorkerPool` |

### 1.2 Core Invariants

1. **Domain-Agnostic Computation**:
   - Models computation and raw linear memory directly: 64 KiB pages, monotonic bump offsets, intrusive free lists, binary field strides, and atomic integer slots.
   - Higher-level simulation, graphics, and numerical engines compose these primitives without translation layers.

2. **Namespace Principle & Zero Aliasing**:
   - Only the library root carries the toolkit prefix (`Awasm`).
   - All exported classes use clean, unaliased canonical nouns: `WasmMemory`, `LinearArena`, `BlockPool`, `MemoryView`, `StructLayout`, `Slice`, `StringBuffer`, `ModuleLoader`, `ModuleInspector`, `HostBridge`, `WasmInstance`, `SharedMemory`, `AtomicQueue`, `WorkerPool`.
   - Aliases (`AwasmBuffer`, `WasmLinearArena`) are forbidden.

3. **Dual-Tier Handle Interoperability**:
   - Exposes raw native handles (`WebAssembly.Instance`, `WebAssembly.Memory`, `WebAssembly.Module`, `ArrayBuffer`, `SharedArrayBuffer`) directly alongside managed abstractions.
   - Functions accept either managed wrappers or raw handles without conversion friction.

4. **Zero-Allocation Hot Path**:
   - Hot computation loops, allocations, and data transfers execute without garbage collection overhead.
   - Memory offsets and pointers pass across host-guest boundaries as plain 32-bit integers.

5. **Detachment Resilience & Memory Growth Synchronization**:
   - WebAssembly linear memory growth detaches existing `ArrayBuffer` instances, setting their byte lengths to zero.
   - Awasm coordinates generation counters and resize event listeners, rebinding typed array views in place without application crashes.

### 1.3 Memory Model & Alignment

Awasm enforces hardware and WebAssembly execution alignment constraints:

| Memory / Resource Type | Minimum Size | Byte Alignment | Specification / Rules |
| :--- | :--- | :--- | :--- |
| **Linear Memory Page** | 65,536 bytes | 64 KiB boundary | WebAssembly core specification fixed page unit (`1 page = 65,536 bytes`) |
| **SIMD Vector (`v128`)** | 16 bytes | 16-byte boundary | WebAssembly SIMD v128 alignment constraint |
| **Double / 64-bit Int (`f64`, `i64`)** | 8 bytes | 8-byte boundary | Natural 64-bit numerical alignment |
| **Float / 32-bit Int (`f32`, `i32`, `ptr`)** | 4 bytes | 4-byte boundary | Natural 32-bit numerical alignment |
| **Short / 16-bit Int (`i16`, `u16`)** | 2 bytes | 2-byte boundary | Natural 16-bit numerical alignment |
| **Byte / 8-bit Int (`i8`, `u8`)** | 1 byte | 1-byte boundary | Single byte alignment |
| **Atomics Operation Slot** | 4 bytes | 4-byte boundary | `Atomics.wait`, `Atomics.notify`, `Atomics.load` 32-bit requirement |

---

## 2. Linear Memory Subsystem

Located in `memory/`. Coordinates WebAssembly linear memory allocation, page growth, bump arenas, intrusive slab pools, and detachment-resilient typed array access.

### 2.1 WasmMemory

Direct lifecycle ownership of native `WebAssembly.Memory`. Coordinates page growth tracking, calculates capacity boundaries, and triggers resize listener events when memory expansion detaches underlying buffers. Exposes `handle: WebAssembly.Memory`, `buffer: ArrayBuffer`, `pageCount: number`, `byteLength: number`, `generation: number`, and `isShared: boolean`.

```typescript
export interface MemoryDescriptor {
    initial: number;
    maximum?: number;
    shared?: boolean;
}

export type MemoryResizeListener = (newBuffer: ArrayBuffer, previousByteLength: number) => void;

export class WasmMemory {
    static readonly PAGE_SIZE: number = 65536;

    constructor(descriptor: MemoryDescriptor);
    static fromNative(memory: WebAssembly.Memory, initialPages?: number): WasmMemory;

    grow(deltaPages: number): number;
    onResize(listener: MemoryResizeListener): () => void;

    get handle(): WebAssembly.Memory;
    get buffer(): ArrayBuffer;
    get pageCount(): number;
    get byteLength(): number;
    get generation(): number;
    get isShared(): boolean;
}
```

#### `constructor(descriptor: MemoryDescriptor)`
Instantiates native `WebAssembly.Memory` with initial and optional maximum page constraints. Sets generation counter to 0.

#### `static fromNative(memory: WebAssembly.Memory, initialPages = 1): WasmMemory`
Adopts existing native `WebAssembly.Memory` handle. Detects whether backing buffer is `SharedArrayBuffer`.

#### `grow(deltaPages: number): number`
Invokes native `memory.grow()`, increments generation counter, notifies registered resize listeners, and returns previous page count.
- `deltaPages`: Number of 64 KiB pages to allocate.
- Throws error if allocation exceeds declared maximum page limit or host capacity.

#### `onResize(listener: MemoryResizeListener): () => void`
Registers callback invoked immediately when memory grows and underlying buffer is reallocated. Returns unregister closure.

---

### 2.2 LinearArena

Monotonic bump allocation within a dedicated address span of linear memory. Supports O(1) stack-based allocation, watermark rewinding, and total reset.

```typescript
export class LinearArena {
    constructor(memory: WasmMemory, baseOffset?: number, byteCapacity?: number);

    allocate(byteSize: number, alignment?: number): number;
    mark(): number;
    rewind(mark: number): void;
    reset(): void;

    get baseOffset(): number;
    get currentOffset(): number;
    get allocatedBytes(): number;
    get availableBytes(): number;
    get byteCapacity(): number;
    get memory(): WasmMemory;
}
```

#### `constructor(memory: WasmMemory, baseOffset = 0, byteCapacity?: number)`
Binds arena to byte region within specified `WasmMemory` instance. Defaults capacity to available space from `baseOffset` to end of memory.

#### `allocate(byteSize: number, alignment = 8): number`
Advances internal offset pointer to next aligned boundary. Returns byte pointer.
- `alignment`: Must be a power of two (1, 2, 4, 8, 16). Defaults to 8 bytes.
- Automatically expands underlying memory if allocation exceeds capacity and maximum page bounds permit.
- Throws error if allocation exceeds hard capacity.

#### `mark(): number`
Returns current allocation watermark pointer.

#### `rewind(mark: number): void`
Restores allocation offset to specified watermark without garbage collection.
- `mark`: Byte offset previously returned by `mark()`.

#### `reset(): void`
Resets allocation offset back to base pointer, recycling all arena memory in O(1) time.

---

### 2.3 BlockPool

Recycles fixed-size memory slots inside linear memory using an intrusive free list stored directly within idle memory blocks.

```typescript
export class BlockPool {
    constructor(memory: WasmMemory, offset: number, blockCount: number, blockSize: number);

    acquire(): number;
    release(pointer: number): void;

    get capacity(): number;
    get available(): number;
    get blockSize(): number;
    get offset(): number;
    get totalByteLength(): number;
    get memory(): WasmMemory;
}
```

#### `constructor(memory: WasmMemory, offset: number, blockCount: number, blockSize: number)`
Formats free-list links across block capacity in linear memory. Automatically expands memory if block span exceeds current memory size.
- `blockSize`: Minimum 4 bytes to accommodate intrusive 32-bit next pointer.

#### `acquire(): number`
Pops next free block offset from intrusive stack in O(1) time. Returns allocated byte pointer, or `-1` when pool is exhausted.

#### `release(pointer: number): void`
Pushes block offset back onto intrusive stack in O(1) time. Validates boundary and block alignment constraints.

---

### 2.4 MemoryView

Provides detachment-resilient typed array views over linear memory. Revalidates views against `WasmMemory` generation counters, transparently rebinding buffers after page growth.

```typescript
export class MemoryView {
    constructor(memory: WasmMemory);

    asUint8(byteOffset: number, length: number): Uint8Array;
    asInt8(byteOffset: number, length: number): Int8Array;
    asInt16(byteOffset: number, length: number): Int16Array;
    asUint16(byteOffset: number, length: number): Uint16Array;
    asInt32(byteOffset: number, length: number): Int32Array;
    asUint32(byteOffset: number, length: number): Uint32Array;
    asFloat32(byteOffset: number, length: number): Float32Array;
    asFloat64(byteOffset: number, length: number): Float64Array;
    asDataView(byteOffset: number, byteLength: number): DataView;

    get memory(): WasmMemory;
}
```

#### `constructor(memory: WasmMemory)`
Binds accessor to `WasmMemory` instance. Caches active generation and buffer handle.

#### `asUint8(byteOffset: number, length: number): Uint8Array`
Returns `Uint8Array` view over specified byte span.

#### `asInt32(byteOffset: number, length: number): Int32Array`
Returns `Int32Array` view over specified byte span. Requires 4-byte offset alignment.

#### `asUint32(byteOffset: number, length: number): Uint32Array`
Returns `Uint32Array` view over specified byte span. Requires 4-byte offset alignment.

#### `asFloat32(byteOffset: number, length: number): Float32Array`
Returns `Float32Array` view over specified byte span. Requires 4-byte offset alignment.

#### `asFloat64(byteOffset: number, length: number): Float64Array`
Returns `Float64Array` view over specified byte span. Requires 8-byte offset alignment.

#### `asDataView(byteOffset: number, byteLength: number): DataView`
Returns `DataView` window over specified byte range.

---

## 3. ABI & Data Marshalling

Located in `abi/`. Manages structured data layouts, binary memory spans, and zero-copy string transfer between JavaScript host and WebAssembly guest.

### 3.1 StructLayout

Calculates member byte offsets, alignment padding, and total stride matching C/Rust `repr(C)` specifications.

```typescript
export type StructFieldType = "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "f32" | "f64" | "v128" | "ptr";

export interface StructField {
    name: string;
    type: StructFieldType;
    count: number;
    byteOffset: number;
    byteSize: number;
    alignment: number;
}

export interface StructDescriptor {
    name: string;
    fields: StructField[];
    stride: number;
    alignment: number;
    fieldMap: Map<string, StructField>;
}

export class StructLayout {
    constructor(name?: string);

    field(name: string, type: StructFieldType, count?: number, explicitAlignment?: number): this;
    finish(packAlignment?: number): StructDescriptor;
    static getField(descriptor: StructDescriptor, name: string): StructField;
}
```

#### `constructor(name = "AnonymousStruct")`
Initializes struct layout builder with specified identifier.

#### `field(name: string, type: StructFieldType, count = 1, explicitAlignment?: number): this`
Appends struct field, computing natural alignment and offset.
- `explicitAlignment`: Optional override for SIMD or custom vector alignment constraints.

#### `finish(packAlignment?: number): StructDescriptor`
Computes total struct stride padded to largest alignment boundary (or pack limit).

#### `static getField(descriptor: StructDescriptor, name: string): StructField`
Retrieves field descriptor by name in O(1) time.

---

### 3.2 Slice

Value object representing a guest memory span `(ptr, length)` without copying or owning buffer memory.

```typescript
export class Slice {
    readonly ptr: number;
    readonly length: number;

    constructor(ptr: number, length: number);

    readUint8(memory: WasmMemory): Uint8Array;
    readFloat32(memory: WasmMemory): Float32Array;
    readUint32(memory: WasmMemory): Uint32Array;
    copyFrom(source: ArrayBufferView, memory: WasmMemory): void;
}
```

#### `constructor(ptr: number, length: number)`
Stores guest memory pointer and byte length. Validates non-negative parameters.

#### `readUint8(memory: WasmMemory): Uint8Array`
Returns sub-array byte window over active linear memory buffer.

#### `readFloat32(memory: WasmMemory): Float32Array`
Returns 4-byte aligned `Float32Array` window over active linear memory buffer.

#### `readUint32(memory: WasmMemory): Uint32Array`
Returns 4-byte aligned `Uint32Array` window over active linear memory buffer.

#### `copyFrom(source: ArrayBufferView, memory: WasmMemory): void`
Copies source bytes into guest memory at slice address span.

---

### 3.3 StringBuffer

UTF-8 string encoding and decoding across host and guest linear memory via singleton `TextEncoder` and `TextDecoder` instances.

```typescript
export class StringBuffer {
    static write(text: string, arena: LinearArena, memory: WasmMemory): Slice;
    static read(ptr: number, length: number, memory: WasmMemory): string;
    static readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes?: number): string;
}
```

#### `static write(text: string, arena: LinearArena, memory: WasmMemory): Slice`
Encodes UTF-8 string directly into linear arena memory and appends null terminator. Returns slice containing guest pointer and byte length.

#### `static read(ptr: number, length: number, memory: WasmMemory): string`
Decodes UTF-8 guest memory range into JavaScript string.

#### `static readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes = 4096): string`
Scans for null terminator `\0` and decodes string.

---

## 4. Binary & Runtime Lifecycle

Located in `runtime/`. Manages compilation, module inspection, host import table assembly, and instance execution.

### 4.1 ModuleLoader

Acquires and compiles WebAssembly bytecode from streaming responses, promises, or raw buffers with optional IndexedDB bytecode caching.

```typescript
export class ModuleLoader {
    static compile(source: BufferSource | Response | Promise<Response>): Promise<WebAssembly.Module>;
    static compileCached(key: string, sourceProvider: () => Promise<BufferSource | Response>): Promise<WebAssembly.Module>;
}
```

#### `static compile(source: BufferSource | Response | Promise<Response>): Promise<WebAssembly.Module>`
Compiles module via `WebAssembly.compileStreaming` when given `Response` objects, falling back to buffered `WebAssembly.compile`.

#### `static compileCached(key: string, sourceProvider: () => Promise<BufferSource | Response>): Promise<WebAssembly.Module>`
Queries IndexedDB cache for pre-compiled module bytecode. Compiles and stores module when cache misses.

---

### 4.2 ModuleInspector

Static binary inspector and validator for uninstantiated WebAssembly modules.

```typescript
export type WasmExportKind = "function" | "table" | "memory" | "global";
export type WasmImportKind = "function" | "table" | "memory" | "global";

export interface ModuleManifest {
    exports: { name: string; kind: WasmExportKind }[];
    imports: { module: string; name: string; kind: WasmImportKind }[];
    declaredMemory: boolean;
    requiredModules: string[];
}

export class ModuleInspector {
    static inspect(module: WebAssembly.Module): ModuleManifest;
    static validate(bytes: BufferSource): boolean;
}
```

#### `static inspect(module: WebAssembly.Module): ModuleManifest`
Extracts exported functions, imported dependencies, and declared memory without executing guest code or allocating memory.

#### `static validate(bytes: BufferSource): boolean`
Validates binary byte sequence against WebAssembly specification.

---

### 4.3 HostBridge

Host function import table builder. Registers host callbacks and standard execution environments.

```typescript
export interface HostEnvOptions {
    onAbort?: (message: string, file: string, line: number, column: number) => void;
    onLog?: (message: string) => void;
    nowProvider?: () => number;
}

export class HostBridge {
    register(moduleName: string, exportName: string, fn: any): this;
    registerModule(moduleName: string, functions: Record<string, any>): this;
    registerDefaultEnv(options?: HostEnvOptions): this;
    build(): WebAssembly.Imports;
}
```

#### `register(moduleName: string, exportName: string, fn: any): this`
Associates JavaScript function pointer with module and export symbol.

#### `registerModule(moduleName: string, functions: Record<string, any>): this`
Registers map of functions under specified module namespace.

#### `registerDefaultEnv(options?: HostEnvOptions): this`
Registers default environment functions: `env.now`, `env.abort`, and `env.log`.

#### `build(): WebAssembly.Imports`
Produces import object formatted for `WebAssembly.instantiate`.

---

### 4.4 WasmInstance

Managed runtime container binding compiled module, active native instance, and linear memory coordinator.

```typescript
export class WasmInstance<TExports extends Record<string, any> = Record<string, any>> {
    constructor(module: WebAssembly.Module, instance: WebAssembly.Instance, memory: WasmMemory);

    static instantiate<T extends Record<string, any> = Record<string, any>>(
        module: WebAssembly.Module,
        imports?: WebAssembly.Imports,
        providedMemory?: WasmMemory
    ): Promise<WasmInstance<T>>;

    call<TResult = number>(name: string, ...args: number[]): TResult;

    get exports(): TExports;
    get handle(): WebAssembly.Instance;
    get memory(): WasmMemory;
    get module(): WebAssembly.Module;
}
```

#### `static instantiate<T>(module: WebAssembly.Module, imports?: WebAssembly.Imports, memory?: WasmMemory): Promise<WasmInstance<T>>`
Instantiates module and resolves linear memory reference from module exports or imported memory handle.

#### `call<TResult>(name: string, ...args: number[]): TResult`
Invokes exported function by name.

---

## 5. Threading & Concurrency

Located in `thread/`. Coordinates multi-threaded execution across Web Workers using `SharedArrayBuffer` linear memory and lock-free atomic queues.

### 5.1 SharedMemory

Shared linear memory coordinator backed by `SharedArrayBuffer` and `Atomics`.

```typescript
export interface SharedMemoryDescriptor {
    initial: number;
    maximum: number;
}

export type WaitResult = "ok" | "not-equal" | "timed-out";

export class SharedMemory {
    constructor(descriptor: SharedMemoryDescriptor);

    wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult;
    notify(byteOffset: number, count?: number): number;
    load(byteOffset: number): number;
    store(byteOffset: number, value: number): number;

    get handle(): WebAssembly.Memory;
    get buffer(): SharedArrayBuffer;
    get initialPages(): number;
    get maximumPages(): number;
}
```

#### `constructor(descriptor: SharedMemoryDescriptor)`
Allocates native `WebAssembly.Memory` configured with `shared: true`.
- `maximum`: Required per WebAssembly specification when shared is enabled.

#### `wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult`
Executes `Atomics.wait` on 32-bit integer location.
- Requires 4-byte offset alignment.
- Cannot execute on browser main UI thread.

#### `notify(byteOffset: number, count = 1): number`
Executes `Atomics.notify` on 32-bit integer location, waking waiting workers.

#### `load(byteOffset: number): number`
Performs atomic 32-bit integer read.

#### `store(byteOffset: number, value: number): number`
Performs atomic 32-bit integer write.

---

### 5.2 AtomicQueue

Lock-free circular ring buffer residing in shared linear memory for inter-thread task dispatch.

```typescript
export class AtomicQueue {
    constructor(buffer: SharedArrayBuffer, byteOffset: number, capacityPowerOfTwo?: number);

    enqueue(value: number): boolean;
    dequeue(): number | null;

    get length(): number;
    get capacity(): number;
    static requiredBytes(capacityPowerOfTwo: number): number;
}
```

#### `constructor(buffer: SharedArrayBuffer, byteOffset: number, capacityPowerOfTwo = 256)`
Initializes atomic ring buffer over shared memory span.
- `capacityPowerOfTwo`: Capacity must be a power of two for mask-based wrapping.

#### `enqueue(value: number): boolean`
Appends 32-bit integer. Returns `false` when ring buffer is full.

#### `dequeue(): number | null`
Reads and removes next 32-bit integer. Returns `null` when ring buffer is empty.

#### `static requiredBytes(capacityPowerOfTwo: number): number`
Calculates byte size required to host ring buffer metadata and slots (`(2 + capacity) * 4` bytes).

---

### 5.3 WorkerPool

Multi-threaded worker pool coordinating compute tasks on shared WebAssembly instances.

```typescript
export interface WorkerTaskMessage {
    type: "init" | "task" | "terminate";
    taskId?: number;
    module?: WebAssembly.Module;
    memory?: WebAssembly.Memory;
    arg0?: number;
    arg1?: number;
}

export class WorkerPool {
    constructor(workerScriptUrl: string | URL, concurrency?: number);

    initialize(module: WebAssembly.Module, memory: SharedMemory): Promise<void>;
    dispatch<T = unknown>(taskIndex: number, arg0?: number, arg1?: number): Promise<T>;
    terminate(): void;

    get concurrency(): number;
    get isInitialized(): boolean;
}
```

#### `constructor(workerScriptUrl: string | URL, concurrency?: number)`
Spawns dedicated Web Workers. Defaults concurrency to `navigator.hardwareConcurrency` (or 4 in headless environments).

#### `initialize(module: WebAssembly.Module, memory: SharedMemory): Promise<void>`
Broadcasts compiled module and shared memory handle to all workers via structured clone.

#### `dispatch<T>(taskIndex: number, arg0 = 0, arg1 = 0): Promise<T>`
Dispatches task to next available worker in round-robin sequence.

#### `terminate(): void`
Halts and cleans up all active worker threads.

---

## 6. Usage Patterns

### 6.1 Bump Allocation with Watermark Rewind

High-throughput allocation with zero garbage collection overhead. Watermark rewinding recycles transient memory per simulation step.

```typescript
import { WasmMemory, LinearArena, MemoryView, StructLayout } from "@asciiz/atoolkit/awasm";

const memory = new WasmMemory({ initial: 4, maximum: 16 });
const arena = new LinearArena(memory, 0, 131072);
const view = new MemoryView(memory);

const Particle = new StructLayout("Particle")
    .field("position", "f32", 4, 16) // 16-byte SIMD alignment
    .field("velocity", "f32", 4, 16)
    .field("mass", "f32", 1)
    .field("active", "u32", 1)
    .finish();

function stepSimulation(count: number): void {
    const watermark = arena.mark();

    const particlesByteSize = Particle.stride * count;
    const ptr = arena.allocate(particlesByteSize, 16);

    const positions = view.asFloat32(ptr, count * 4);
    // Mutate positions directly in linear memory...

    // Recycle all allocations made this step
    arena.rewind(watermark);
}
```

### 6.2 Detachment-Resilient Views across Memory Growth

Maintains valid typed array views when memory expansion invalidates older `ArrayBuffer` references.

```typescript
import { WasmMemory, LinearArena, MemoryView } from "@asciiz/atoolkit/awasm";

const memory = new WasmMemory({ initial: 1 });
const arena = new LinearArena(memory);
const view = new MemoryView(memory);

const offset = arena.allocate(128, 16);
const floatViewBefore = view.asFloat32(offset, 32);
floatViewBefore[0] = 3.14159;

// Trigger page expansion; detaches original ArrayBuffer
memory.grow(2);

// floatViewBefore.buffer is now detached; MemoryView resolves new buffer automatically
const floatViewAfter = view.asFloat32(offset, 32);
console.log(floatViewAfter[0]); // 3.14159
```

### 6.3 Host Import Bridge & Instance Invocation

Links host functions into guest module imports, compiles binary, and executes typed function calls.

```typescript
import { ModuleLoader, HostBridge, WasmInstance } from "@asciiz/atoolkit/awasm";

const bridge = new HostBridge()
    .registerDefaultEnv({
        nowProvider: () => performance.now(),
        onLog: (msg) => console.log(`[Guest]: ${msg}`),
    })
    .register("math", "cos", (val: number) => Math.cos(val));

const module = await ModuleLoader.compile(wasmBytecode);
const instance = await WasmInstance.instantiate(module, bridge.build());

const result = instance.call<number>("compute", 100);
```

### 6.4 Shared Memory & Atomic Task Queue

Coordinates message passing between main thread and worker threads without locks.

```typescript
import { SharedMemory, AtomicQueue } from "@asciiz/atoolkit/awasm";

const sharedMem = new SharedMemory({ initial: 4, maximum: 16 });
const queue = new AtomicQueue(sharedMem.buffer, 0, 128);

// Producer thread
queue.enqueue(42);
queue.enqueue(108);

// Consumer thread
const item1 = queue.dequeue(); // 42
const item2 = queue.dequeue(); // 108
```
