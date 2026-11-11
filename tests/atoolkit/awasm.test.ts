import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import {
	WasmMemory,
	MemoryView,
	LinearArena,
	BlockPool,
	SharedMemory,
	AtomicQueue,
	WorkerPool,
	WasmInstance,
	ModuleLoader,
	HostBridge,
	ModuleInspector,
	StructLayout,
	StringBuffer,
	Slice,
	type WorkerLike,
	type WorkerTaskMessage
} from "../../Atoolkit/awasm/index.ts";

// Minimal valid WebAssembly binary modules assembled from byte arrays:

// 1. Module with no memory: exports `add(a: i32, b: i32) -> i32`
const WASM_NO_MEMORY_BYTES = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
	// Type section: 1 func (i32, i32) -> i32
	0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
	// Function section: func 0 uses type 0
	0x03, 0x02, 0x01, 0x00,
	// Export section: "add" -> func 0
	0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
	// Code section: local.get 0, local.get 1, i32.add, end
	0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b
]);

// 2. Module exporting memory ("memory", initial 1 page, max 8 pages) and `growMem(delta: i32) -> i32` (calls `memory.grow`)
const WASM_EXPORTED_MEMORY_GROW_BYTES = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
	// Type section: 1 func (i32) -> i32
	0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
	// Function section: func 0 -> type 0
	0x03, 0x02, 0x01, 0x00,
	// Memory section: 1 memory, limits has_max=1, initial=1, max=8
	0x05, 0x04, 0x01, 0x01, 0x01, 0x08,
	// Export section: "memory" (mem 0) and "growMem" (func 0) -> 20 bytes (0x14)
	0x07, 0x14, 0x02,
	0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
	0x07, 0x67, 0x72, 0x6f, 0x77, 0x4d, 0x65, 0x6d, 0x00, 0x00,
	// Code section: local.get 0, memory.grow 0x00, end
	0x0a, 0x08, 0x01, 0x06, 0x00, 0x20, 0x00, 0x40, 0x00, 0x0b
]);

// 3. Module importing `env.memory` (min 1 page) and exporting `writeWord(offset: i32, val: i32)`
const WASM_IMPORTED_MEMORY_BYTES = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
	// Type section: 1 func (i32, i32) -> void
	0x01, 0x06, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x00,
	// Import section: "env"."memory" memory(min=1)
	0x02, 0x0f, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x01,
	// Function section: func 0 -> type 0
	0x03, 0x02, 0x01, 0x00,
	// Export section: "writeWord" -> func 0
	0x07, 0x0d, 0x01, 0x09, 0x77, 0x72, 0x69, 0x74, 0x65, 0x57, 0x6f, 0x72, 0x64, 0x00, 0x00,
	// Code section: local.get 0, local.get 1, i32.store align=2 offset=0, end
	0x0a, 0x0b, 0x01, 0x09, 0x00, 0x20, 0x00, 0x20, 0x01, 0x36, 0x02, 0x00, 0x0b
]);

function createNodeWorkerAdapter(scriptUrl: string | URL): WorkerLike {
	const nw = new NodeWorker(scriptUrl);
	const wrapper: WorkerLike = {
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage(msg: WorkerTaskMessage) {
			nw.postMessage(msg);
		},
		terminate() {
			return nw.terminate();
		}
	};
	nw.on("message", (data) => {
		wrapper.onmessage?.({ data });
	});
	nw.on("error", (err) => {
		wrapper.onerror?.(err);
	});
	return wrapper;
}

describe("awasm 8A - WasmMemory, SharedMemory, and MemoryView Invariants", () => {
	it("adopts existing multi-page WebAssembly.Memory and refreshes views across wrapper, native, and guest memory.grow", async () => {
		// 1. Adopt a 3-page native memory
		const raw3 = new WebAssembly.Memory({ initial: 3, maximum: 6 });
		const adopted = WasmMemory.fromNative(raw3);
		assert.equal(adopted.pageCount, 3);
		assert.equal(adopted.byteLength, 3 * WasmMemory.PAGE_SIZE);

		const view = new MemoryView(adopted);
		view.asUint32(0, 1)[0] = 0xdeadbeef;
		const borrowedBeforeGrow = view.asUint8(0, 16);
		assert.equal(borrowedBeforeGrow.byteLength, 16);

		// 2. Grow through wrapper
		const gen0 = adopted.generation;
		const prevPages = adopted.grow(1);
		assert.equal(prevPages, 3);
		assert.equal(adopted.pageCount, 4);
		assert.ok(adopted.generation > gen0);
		assert.equal(view.asUint32(0, 1)[0], 0xdeadbeef);
		// Old borrowed subarray on non-shared ArrayBuffer is now detached
		assert.equal(borrowedBeforeGrow.byteLength, 0);

		// 3. Grow directly on raw native handle
		raw3.grow(1);
		assert.equal(adopted.pageCount, 5);
		assert.equal(adopted.byteLength, 5 * WasmMemory.PAGE_SIZE);
		assert.equal(view.asUint32(0, 1)[0], 0xdeadbeef);

		// 4. Guest WASM module calling `memory.grow` internally
		const guestMod = await WebAssembly.compile(WASM_EXPORTED_MEMORY_GROW_BYTES);
		const guestInst = await WasmInstance.instantiate<{ growMem(delta: number): number }>(guestMod);
		const guestMem = guestInst.requireMemory();
		const guestView = new MemoryView(guestMem);
		guestView.asInt32(0, 16)[10] = 123456;
		assert.equal(guestMem.pageCount, 1);

		const oldPages = guestInst.call("growMem", 2);
		assert.equal(oldPages, 1);
		assert.equal(guestMem.pageCount, 3);
		assert.equal(guestMem.byteLength, 3 * WasmMemory.PAGE_SIZE);
		assert.equal(guestView.asInt32(0, 16)[10], 123456);
	});

	it("refreshes SharedMemory atomic Int32Array view across grow()", () => {
		const shared = new SharedMemory({ initial: 1, maximum: 4 });
		assert.equal(shared.buffer instanceof SharedArrayBuffer, true);
		shared.store(0, 777);
		assert.equal(shared.load(0), 777);

		shared.grow(2);
		assert.equal(shared.pageCount, 3);
		assert.equal(shared.byteLength, 3 * WasmMemory.PAGE_SIZE);
		assert.equal(shared.load(0), 777);

		// Write into newly grown 3rd page
		const thirdPageByteOffset = 2 * WasmMemory.PAGE_SIZE;
		shared.store(thirdPageByteOffset, 999);
		assert.equal(shared.load(thirdPageByteOffset), 999);
	});
});

describe("awasm 8B - LinearArena and BlockPool Allocator Invariants", () => {
	it("enforces fixed LinearArena capacity without growing memory or advancing offset on failure", () => {
		const mem = new WasmMemory({ initial: 1, maximum: 4 });
		const arena = new LinearArena(mem, 128, 64);

		assert.throws(() => arena.allocate(8, 0), RangeError);
		assert.throws(() => arena.allocate(8, 3), RangeError);
		assert.throws(() => arena.allocate(-4, 4), RangeError);

		const p1 = arena.allocate(32, 16);
		assert.equal(p1, 128);
		const mark = arena.mark();
		assert.equal(mark, 160);

		// Exceeding the 64-byte arena capacity must fail and leave memory pageCount and cursor untouched
		assert.equal(arena.tryAllocate(48, 8), null);
		assert.throws(() => arena.allocate(48, 8), RangeError);
		assert.equal(arena.currentOffset, 160);
		assert.equal(mem.pageCount, 1);

		// Invalid rewind bounds are rejected
		assert.throws(() => arena.rewind(64), RangeError);
		assert.throws(() => arena.rewind(170), RangeError);

		arena.rewind(128);
		assert.equal(arena.currentOffset, 128);
	});

	it("manages BlockPool free list and rejects double-release or unallocated pointers", () => {
		const mem = new WasmMemory({ initial: 1 });
		const pool = new BlockPool(mem, 256, 3, 16);
		assert.equal(pool.capacity, 3);
		assert.equal(pool.available, 3);

		const b0 = pool.acquire();
		const b1 = pool.acquire();
		const b2 = pool.acquire();
		assert.equal(b0, 256);
		assert.equal(b1, 272);
		assert.equal(b2, 288);
		assert.equal(pool.acquire(), -1);
		assert.equal(pool.available, 0);

		// Release b1 and verify double-release is rejected without corrupting free list
		pool.release(b1);
		assert.equal(pool.available, 1);
		assert.throws(() => pool.release(b1), /not currently allocated/i);
		assert.throws(() => pool.release(260), RangeError); // misaligned
		assert.throws(() => pool.release(128), RangeError); // out of bounds

		// Re-acquiring returns b1 and then exhausts cleanly
		assert.equal(pool.acquire(), b1);
		assert.equal(pool.acquire(), -1);
	});
});

describe("awasm 8C - AtomicQueue SPSC Unsigned Wraparound and Cross-Worker Exchange", () => {
	it("maintains FIFO invariants across 0x7fffffff signed boundary and 0xffffffff uint32 wraparound, and attaches without resetting", () => {
		const sab = new SharedArrayBuffer(AtomicQueue.requiredBytes(4));
		const q = AtomicQueue.initialize(sab, 0, 4);

		// Attach a second view and verify it does NOT zero out live items
		q.enqueue(11);
		q.enqueue(22);
		const attached = AtomicQueue.attach(sab, 0, 4);
		assert.equal(attached.length, 2);
		assert.equal(attached.dequeue(), 11);
		assert.equal(attached.dequeue(), 22);
		assert.equal(q.length, 0);

		// Test signed 32-bit overflow boundary: 0x7ffffffe -> 0x7fffffff -> 0x80000000 -> 0x80000001
		const rawView = new Int32Array(sab);
		Atomics.store(rawView, 0, 0x7ffffffe | 0);
		Atomics.store(rawView, 1, 0x7ffffffe | 0);
		assert.equal(q.enqueue(101), true);
		assert.equal(q.enqueue(102), true);
		assert.equal(q.enqueue(103), true);
		assert.equal(q.enqueue(104), true);
		assert.equal(q.enqueue(105), false); // full at capacity 4
		assert.equal(q.length, 4);
		assert.equal(q.dequeue(), 101);
		assert.equal(q.dequeue(), 102);
		assert.equal(q.dequeue(), 103);
		assert.equal(q.dequeue(), 104);
		assert.equal(q.dequeue(), null);

		// Test 32-bit unsigned wraparound: 0xfffffffe -> 0xffffffff -> 0x00000000 -> 0x00000001
		Atomics.store(rawView, 0, 0xfffffffe | 0);
		Atomics.store(rawView, 1, 0xfffffffe | 0);
		assert.equal(q.enqueue(201), true);
		assert.equal(q.enqueue(202), true);
		assert.equal(q.enqueue(203), true);
		assert.equal(q.enqueue(204), true);
		assert.equal(q.enqueue(205), false);
		assert.equal(q.length, 4);
		assert.equal(q.dequeue(), 201);
		assert.equal(q.dequeue(), 202);
		assert.equal(q.dequeue(), 203);
		assert.equal(q.dequeue(), 204);
		assert.equal(q.dequeue(), null);
	});

	it("transfers a sequence of integers losslessly between producer and worker consumer thread", async () => {
		const capacity = 64;
		const totalItems = 500;
		const sab = new SharedArrayBuffer(AtomicQueue.requiredBytes(capacity));
		const producer = AtomicQueue.initialize(sab, 0, capacity);

		const workerUrl = new URL("./fixtures/awasm-worker.mjs", import.meta.url);
		const worker = new NodeWorker(workerUrl);

		try {
			const consumerDone = new Promise<number[]>((resolve, reject) => {
				worker.on("message", (msg) => {
					if (msg && msg.type === "spsc-done") {
						resolve(msg.received);
					}
				});
				worker.on("error", reject);
			});

			worker.postMessage({
				type: "spsc-consume",
				buffer: sab,
				byteOffset: 0,
				capacity,
				totalItems
			});

			const expected: number[] = [];
			for (let i = 1; i <= totalItems; i++) {
				expected.push(i * 3);
				while (!producer.enqueue(i * 3)) {
					await new Promise((r) => setImmediate(r));
				}
			}

			const received = await consumerDone;
			assert.deepEqual(received, expected);
		} finally {
			await worker.terminate();
		}
	});
});

describe("awasm 8D - WorkerPool Protocol, Backpressure, Cancellation, and Failure Lifecycle", () => {
	it("initializes workers, preserves arg0 and arg1 on dispatch, and deduplicates concurrent initialize()", async () => {
		const workerUrl = new URL("./fixtures/awasm-worker.mjs", import.meta.url);
		const pool = new WorkerPool(workerUrl, {
			concurrency: 2,
			workerFactory: createNodeWorkerAdapter
		});

		try {
			const mod = await WebAssembly.compile(WASM_NO_MEMORY_BYTES);
			const shared = new SharedMemory({ initial: 1, maximum: 2 });

			// Concurrent initialize() calls share the same promise
			const pInit1 = pool.initialize(mod, shared);
			const pInit2 = pool.initialize(mod, shared);
			assert.equal(pInit1, pInit2);
			await pInit1;
			assert.equal(pool.isInitialized, true);

			const res = await pool.dispatch<{
				hasModule: boolean;
				hasMemory: boolean;
				taskIndex: number;
				args: number[];
				arg0: number;
				arg1: number;
				sum: number;
			}>(0, 17, 25);

			assert.equal(res.hasModule, true);
			assert.equal(res.hasMemory, true);
			assert.equal(res.taskIndex, 0);
			assert.equal(res.arg0, 17);
			assert.equal(res.arg1, 25);
			assert.deepEqual(res.args, [17, 25]);
			assert.equal(res.sum, 42);
		} finally {
			pool.terminate();
			// Idempotent second terminate()
			pool.terminate();
			assert.equal(pool.isTerminated, true);
		}
	});

	it("enforces maxPendingTasks, handles timeoutMs and AbortSignal, and cleans up on postMessage throw or worker error", async () => {
		const workerUrl = new URL("./fixtures/awasm-worker.mjs", import.meta.url);
		const pool = new WorkerPool(workerUrl, {
			concurrency: 1,
			maxPendingTasks: 2,
			workerFactory: createNodeWorkerAdapter
		});

		try {
			const mod = await WebAssembly.compile(WASM_NO_MEMORY_BYTES);
			const mem = new SharedMemory({ initial: 1, maximum: 2 });
			await pool.initialize(mod, mem);

			// 1. Timeout rejection + late reply ignored cleanly
			await assert.rejects(
				() => pool.dispatch(1, 60, 999, { timeoutMs: 10 }),
				/timed out/i
			);

			// 2. AbortSignal cancellation
			const ac = new AbortController();
			const abortTask = pool.dispatch(1, 60, 888, { signal: ac.signal });
			ac.abort();
			await assert.rejects(() => abortTask, /aborted/i);

			// Wait for delayed worker replies from tasks 1 & 2 to arrive and be ignored without error
			await new Promise((r) => setTimeout(r, 80));

			// Pool remains healthy for subsequent tasks
			const check = await pool.dispatch<{ sum: number }>(0, 10, 20);
			assert.equal(check.sum, 30);

			// 3. maxPendingTasks backpressure
			const slow1 = pool.dispatch(1, 40, 1);
			const slow2 = pool.dispatch(1, 40, 2);
			await assert.rejects(
				() => pool.dispatch(0, 1, 1),
				/maximum pending tasks/i
			);
			await Promise.all([slow1, slow2]);

			// 4. Uncaught worker error fails the pool and rejects pending tasks
			await assert.rejects(
				() => pool.dispatch(3, 0, 0),
				/worker error/i
			);
			assert.equal(pool.isTerminated, true);
		} finally {
			pool.terminate();
		}

		// 5. Synchronous postMessage throw cleans up pending task entry
		let throwOnTaskPost = false;
		const customPool = new WorkerPool("mock://worker", {
			concurrency: 1,
			workerFactory: () => {
				const w: WorkerLike = {
					onmessage: null,
					postMessage(msg: WorkerTaskMessage) {
						if (msg.type === "init") {
							queueMicrotask(() => w.onmessage?.({ data: { taskId: msg.taskId!, result: true } }));
							return;
						}
						if (throwOnTaskPost) {
							throw new Error("DataCloneError: cannot clone message");
						}
						queueMicrotask(() => w.onmessage?.({ data: { taskId: msg.taskId!, result: "ok" } }));
					},
					terminate() {}
				};
				return w;
			}
		});
		const mod = await WebAssembly.compile(WASM_NO_MEMORY_BYTES);
		await customPool.initialize(mod, new WasmMemory({ initial: 1 }));
		throwOnTaskPost = true;
		await assert.rejects(() => customPool.dispatch(0, 1, 2), /DataCloneError/);
		assert.equal(customPool.pendingTaskCount, 0);
		customPool.terminate();
	});
});

describe("awasm 8E - WasmInstance, ModuleLoader, HostBridge, StructLayout, StringBuffer, and Slice", () => {
	it("distinguishes no-memory, exported-memory, and imported-memory WasmInstance modules", async () => {
		// 1. No-memory module -> instance.memory is null
		const noMemMod = await WebAssembly.compile(WASM_NO_MEMORY_BYTES);
		const noMemInst = await WasmInstance.instantiate<{ add(a: number, b: number): number }>(noMemMod);
		assert.equal(noMemInst.memory, null);
		assert.throws(() => noMemInst.requireMemory(), /no bound WebAssembly\.Memory/);
		assert.equal(noMemInst.call("add", 19, 23), 42);

		// Passing providedMemory to a module that neither imports nor exports memory throws
		await assert.rejects(
			() => WasmInstance.instantiate(noMemMod, {}, new WasmMemory({ initial: 1 })),
			/neither imports nor exports/
		);

		// 2. Imported-memory module binds to provided WasmMemory
		const impMod = await WebAssembly.compile(WASM_IMPORTED_MEMORY_BYTES);
		const hostMem = new WasmMemory({ initial: 1 });
		const impInst = await WasmInstance.instantiate<{ writeWord(offset: number, val: number): void }>(
			impMod,
			{},
			hostMem
		);
		assert.equal(impInst.memory, hostMem);
		impInst.call("writeWord", 64, 0x12345678);
		const view = new MemoryView(hostMem);
		assert.equal(view.asInt32(64, 1)[0], 0x12345678);

		// Inspect module exports/imports via ModuleInspector
		const summary = ModuleInspector.inspect(impMod);
		assert.equal(summary.imports.length, 1);
		assert.equal(summary.imports[0]!.kind, "memory");
		assert.equal(summary.exports.length, 1);
		assert.equal(summary.exports[0]!.name, "writeWord");
	});

	it("preserves WebAssembly.CompileError in ModuleLoader.compile and falls back cleanly on Response", async () => {
		// Invalid bytes must reject with WebAssembly.CompileError
		const badBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0xff, 0xff]);
		await assert.rejects(
			() => ModuleLoader.compile(badBytes),
			(err: unknown) => err instanceof WebAssembly.CompileError
		);

		// Valid Response compiled via fallback when compileStreaming fails (e.g. wrong MIME type)
		const response = new Response(WASM_NO_MEMORY_BYTES, {
			status: 200,
			headers: { "Content-Type": "text/plain" }
		});
		const mod = await ModuleLoader.compile(response);
		assert.ok(mod instanceof WebAssembly.Module);
	});

	it("decodes UTF-8 guest log and abort strings via HostBridge, StringBuffer, and Slice, and validates StructLayout", () => {
		const mem = new WasmMemory({ initial: 1 });
		const arena = new LinearArena(mem, 64, 1024);

		// Multibyte UTF-8 round-trip through StringBuffer
		const text = "Cafe \u00e9 \u03a9 \u6f22";
		const slice = StringBuffer.write(text, arena);
		assert.ok(slice.length > text.length);
		assert.equal(StringBuffer.read(slice.ptr, slice.length, mem), text);
		assert.equal(StringBuffer.readNullTerminated(slice.ptr, mem), text);

		// Missing null terminator within maxScanBytes throws RangeError
		assert.throws(() => {
			StringBuffer.readNullTerminated(slice.ptr, mem, 3);
		}, RangeError);

		// HostBridge UTF-8 log and abort decoding
		const logs: string[] = [];
		const aborts: Array<{ msg: string; file: string; line: number; col: number }> = [];
		const bridge = new HostBridge(mem).registerDefaultEnv({
			onLog: (m) => logs.push(m),
			onAbort: (msg, file, line, col) => aborts.push({ msg, file, line, col })
		});
		const imports = bridge.build() as {
			env: {
				log: (ptr: number, len: number) => void;
				abort_utf8: (mp: number, ml: number, fp: number, fl: number, l: number, c: number) => void;
				abort: (mp: number, fp: number, l: number, c: number) => void;
			};
		};

		imports.env.log(slice.ptr, slice.length);
		assert.deepEqual(logs, [text]);

		const fileSlice = StringBuffer.write("src/main.rs", arena);
		imports.env.abort_utf8(slice.ptr, slice.length, fileSlice.ptr, fileSlice.length, 42, 7);
		assert.equal(aborts.length, 1);
		assert.deepEqual(aborts[0], { msg: text, file: "src/main.rs", line: 42, col: 7 });

		imports.env.abort(slice.ptr, fileSlice.ptr, 99, 1);
		assert.equal(aborts.length, 2);
		assert.deepEqual(aborts[1], { msg: text, file: "src/main.rs", line: 99, col: 1 });

		// Slice alignment and bounds checks
		const alignedPtr = arena.allocate(16, 4);
		const f32Slice = new Slice(alignedPtr, 16);
		const f32View = f32Slice.readFloat32(mem);
		f32View.set([1.5, 2.5, 3.5, 4.5]);
		assert.deepEqual(Array.from(f32Slice.readFloat32(mem)), [1.5, 2.5, 3.5, 4.5]);

		const unalignedSlice = new Slice(alignedPtr + 1, 8);
		assert.throws(() => unalignedSlice.readUint32(mem), RangeError);
		const oobSlice = new Slice(mem.byteLength - 4, 16);
		assert.throws(() => oobSlice.readUint32(mem), RangeError);

		// StructLayout natural vs packed alignment, duplicate rejection, and frozen descriptors
		const layoutBuilder = new StructLayout("TestVertex")
			.field("tag", "u8")
			.field("weight", "f64")
			.field("simd", "v128");

		assert.throws(() => layoutBuilder.field("tag", "u32"), /duplicate field/i);
		assert.throws(() => layoutBuilder.field("badAlign", "u32", 1, 3), RangeError);

		const natural = layoutBuilder.finish();
		assert.ok(Object.isFrozen(natural));
		assert.ok(Object.isFrozen(natural.fields));
		assert.equal(StructLayout.getField(natural, "tag").byteOffset, 0);
		assert.equal(StructLayout.getField(natural, "weight").byteOffset, 8);
		assert.equal(StructLayout.getField(natural, "simd").byteOffset, 16);
		assert.equal(natural.alignment, 16);
		assert.equal(natural.stride, 32);

		const packed1 = layoutBuilder.finish(1);
		assert.equal(StructLayout.getField(packed1, "tag").byteOffset, 0);
		assert.equal(StructLayout.getField(packed1, "weight").byteOffset, 1);
		assert.equal(StructLayout.getField(packed1, "simd").byteOffset, 9);
		assert.equal(packed1.alignment, 1);
		assert.equal(packed1.stride, 25);

		// Adding another field to the builder afterwards does not mutate previous finished snapshots
		layoutBuilder.field("extra", "u32");
		assert.equal(natural.fields.length, 3);
	});
});
