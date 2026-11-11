// ================================================================
//  Awasm - Threading: SharedMemory
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";

export interface SharedMemoryDescriptor {
	initial: number;
	maximum: number;
}

export type WaitResult = "ok" | "not-equal" | "timed-out";

const WASM32_MAX_PAGES = 65536;

function assertSharedEnvironment(): void {
	if (typeof SharedArrayBuffer === "undefined" || typeof Atomics === "undefined") {
		throw new Error(
			"SharedMemory: SharedArrayBuffer and Atomics are required but unavailable in this environment."
		);
	}
}

/**
 * Shared linear memory coordinator backed by `SharedArrayBuffer` and `Atomics`.
 * Automatically refreshes its internal `Int32Array` atomic view when the underlying shared
 * `WebAssembly.Memory` grows.
 */
export class SharedMemory {
	readonly #memory: WebAssembly.Memory;
	readonly #initialPages: number;
	readonly #maximumPages: number;
	#cachedBuffer: SharedArrayBuffer;
	#cachedByteLength: number;
	#int32View: Int32Array;

	constructor(descriptor: SharedMemoryDescriptor) {
		assertSharedEnvironment();

		if (descriptor instanceof WebAssembly.Memory) {
			if (!(descriptor.buffer instanceof SharedArrayBuffer)) {
				throw new TypeError("SharedMemory.fromNative: WebAssembly.Memory must be backed by a SharedArrayBuffer.");
			}
			this.#memory = descriptor;
			this.#cachedBuffer = descriptor.buffer;
			this.#cachedByteLength = this.#cachedBuffer.byteLength;
			this.#initialPages = Math.floor(this.#cachedByteLength / WasmMemory.PAGE_SIZE);
			this.#maximumPages = WASM32_MAX_PAGES;
			this.#int32View = new Int32Array(this.#cachedBuffer);
			return;
		}

		if (
			!descriptor ||
			!Number.isInteger(descriptor.initial) ||
			descriptor.initial < 0 ||
			descriptor.initial > WASM32_MAX_PAGES
		) {
			throw new RangeError(
				`SharedMemory: initial pages must be an integer in [0, ${WASM32_MAX_PAGES}], received ${descriptor?.initial}.`
			);
		}
		if (
			!Number.isInteger(descriptor.maximum) ||
			descriptor.maximum < descriptor.initial ||
			descriptor.maximum > WASM32_MAX_PAGES
		) {
			throw new RangeError(
				`SharedMemory: maximum pages (${descriptor.maximum}) must be an integer in [${descriptor.initial}, ${WASM32_MAX_PAGES}].`
			);
		}

		this.#initialPages = descriptor.initial;
		this.#maximumPages = descriptor.maximum;

		this.#memory = new WebAssembly.Memory({
			initial: descriptor.initial,
			maximum: descriptor.maximum,
			shared: true,
		});

		this.#cachedBuffer = this.#memory.buffer as unknown as SharedArrayBuffer;
		this.#cachedByteLength = this.#cachedBuffer.byteLength;
		this.#int32View = new Int32Array(this.#cachedBuffer);
	}

	/**
	 * Adopts an existing shared `WebAssembly.Memory` instance.
	 */
	static fromNative(memory: WebAssembly.Memory): SharedMemory {
		assertSharedEnvironment();
		if (!(memory instanceof WebAssembly.Memory) || !(memory.buffer instanceof SharedArrayBuffer)) {
			throw new TypeError("SharedMemory.fromNative: expected a shared WebAssembly.Memory instance.");
		}
		return new SharedMemory(memory as unknown as SharedMemoryDescriptor);
	}

	#refreshView(): Int32Array {
		const currentBuffer = this.#memory.buffer as unknown as SharedArrayBuffer;
		const currentByteLength = currentBuffer.byteLength;
		if (currentBuffer !== this.#cachedBuffer || currentByteLength !== this.#cachedByteLength) {
			this.#cachedBuffer = currentBuffer;
			this.#cachedByteLength = currentByteLength;
			this.#int32View = new Int32Array(currentBuffer);
		}
		return this.#int32View;
	}

	#resolveInt32Index(byteOffset: number, opName: string): { view: Int32Array; index: number } {
		if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
			throw new RangeError(`${opName}: byteOffset must be a non-negative integer, received ${byteOffset}.`);
		}
		if (byteOffset % 4 !== 0) {
			throw new RangeError(`${opName}: byteOffset must be 4-byte aligned, received ${byteOffset}.`);
		}
		const view = this.#refreshView();
		if (byteOffset + 4 > this.#cachedByteLength) {
			throw new RangeError(
				`${opName}: byteOffset (${byteOffset}) out of bounds for shared memory byteLength (${this.#cachedByteLength}).`
			);
		}
		return { view, index: byteOffset / 4 };
	}

	/**
	 * Grows shared linear memory by `deltaPages` (64 KiB each) and refreshes the cached atomic view.
	 */
	grow(deltaPages: number): number {
		if (!Number.isInteger(deltaPages) || deltaPages < 0) {
			throw new RangeError(`SharedMemory.grow: deltaPages must be a non-negative integer, received ${deltaPages}.`);
		}
		this.#refreshView();
		const currentPages = Math.floor(this.#cachedByteLength / WasmMemory.PAGE_SIZE);
		if (deltaPages === 0) {
			return currentPages;
		}
		if (currentPages + deltaPages > this.#maximumPages) {
			throw new RangeError(
				`SharedMemory.grow: growing by ${deltaPages} pages from ${currentPages} exceeds maximumPages (${this.#maximumPages}).`
			);
		}
		const prev = this.#memory.grow(deltaPages);
		this.#refreshView();
		return prev;
	}

	/**
	 * Executes `Atomics.wait` on the 32-bit integer at `byteOffset`.
	 * Note: Blocking `Atomics.wait` is disallowed on browser main UI threads.
	 */
	wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult {
		const { view, index } = this.#resolveInt32Index(byteOffset, "SharedMemory.wait");
		return Atomics.wait(view, index, expectedValue, timeoutMs);
	}

	/**
	 * Executes `Atomics.notify` on the 32-bit integer at `byteOffset`.
	 */
	notify(byteOffset: number, count = 1): number {
		const { view, index } = this.#resolveInt32Index(byteOffset, "SharedMemory.notify");
		return Atomics.notify(view, index, count);
	}

	/**
	 * Performs an atomic 32-bit integer read at `byteOffset`.
	 */
	load(byteOffset: number): number {
		const { view, index } = this.#resolveInt32Index(byteOffset, "SharedMemory.load");
		return Atomics.load(view, index);
	}

	/**
	 * Performs an atomic 32-bit integer write at `byteOffset`.
	 */
	store(byteOffset: number, value: number): number {
		const { view, index } = this.#resolveInt32Index(byteOffset, "SharedMemory.store");
		return Atomics.store(view, index, value);
	}

	get handle(): WebAssembly.Memory {
		return this.#memory;
	}

	get buffer(): SharedArrayBuffer {
		this.#refreshView();
		return this.#cachedBuffer;
	}

	get byteLength(): number {
		this.#refreshView();
		return this.#cachedByteLength;
	}

	get pageCount(): number {
		this.#refreshView();
		return Math.floor(this.#cachedByteLength / WasmMemory.PAGE_SIZE);
	}

	get initialPages(): number {
		return this.#initialPages;
	}

	get maximumPages(): number {
		return this.#maximumPages;
	}
}
