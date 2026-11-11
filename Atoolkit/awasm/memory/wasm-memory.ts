// ================================================================
//  Awasm - Linear Memory: WasmMemory
// ================================================================

export interface MemoryDescriptor {
	initial: number;
	maximum?: number;
	shared?: boolean;
}

export type MemoryResizeListener = (newBuffer: ArrayBuffer, previousByteLength: number) => void;

const WASM32_MAX_PAGES = 65536;

function isSharedBuffer(buf: unknown): boolean {
	return typeof SharedArrayBuffer !== "undefined" && buf instanceof SharedArrayBuffer;
}

/**
 * Managed WebAssembly linear memory coordinator tracking page count, byte length, and buffer identity.
 *
 * Growth and refresh contract:
 * - Native `WebAssembly.Memory` can grow via `WasmMemory.grow()`, direct calls to `memory.handle.grow()`,
 *   or guest WebAssembly `memory.grow` instructions.
 * - `refresh()` inspects `handle.buffer` identity and `byteLength`. When growth is detected, `pageCount`,
 *   `byteLength`, and `generation` are updated and registered resize listeners are invoked.
 * - `buffer`, `pageCount`, `byteLength`, and `generation` getters automatically call `refresh()`, so external
 *   or guest memory growth is observed at the next getter or `MemoryView` access.
 */
export class WasmMemory {
	static readonly PAGE_SIZE = 65536;

	readonly #memory: WebAssembly.Memory;
	readonly #isShared: boolean;
	readonly #maximumPages?: number;
	#lastBuffer: ArrayBufferLike;
	#lastByteLength: number;
	#pageCount: number;
	#generation = 0;
	readonly #listeners: MemoryResizeListener[] = [];

	constructor(descriptor: MemoryDescriptor) {
		if (descriptor instanceof WebAssembly.Memory) {
			this.#memory = descriptor;
			this.#lastBuffer = descriptor.buffer;
			this.#lastByteLength = this.#lastBuffer.byteLength;
			this.#pageCount = Math.floor(this.#lastByteLength / WasmMemory.PAGE_SIZE);
			this.#isShared = isSharedBuffer(this.#lastBuffer);
			this.#maximumPages = undefined;
			return;
		}

		if (
			!descriptor ||
			!Number.isInteger(descriptor.initial) ||
			descriptor.initial < 0 ||
			descriptor.initial > WASM32_MAX_PAGES
		) {
			throw new RangeError(
				`WasmMemory: initial pages must be an integer in [0, ${WASM32_MAX_PAGES}], got ${descriptor?.initial}.`
			);
		}
		if (descriptor.maximum !== undefined) {
			if (
				!Number.isInteger(descriptor.maximum) ||
				descriptor.maximum < descriptor.initial ||
				descriptor.maximum > WASM32_MAX_PAGES
			) {
				throw new RangeError(
					`WasmMemory: maximum pages (${descriptor.maximum}) must be an integer in [${descriptor.initial}, ${WASM32_MAX_PAGES}].`
				);
			}
		}
		if (descriptor.shared && typeof SharedArrayBuffer === "undefined") {
			throw new Error("WasmMemory: SharedArrayBuffer is not available in this environment.");
		}

		this.#isShared = descriptor.shared ?? false;
		this.#maximumPages = descriptor.maximum;
		this.#memory = new WebAssembly.Memory({
			initial: descriptor.initial,
			maximum: descriptor.maximum,
			shared: descriptor.shared,
		});
		this.#lastBuffer = this.#memory.buffer;
		this.#lastByteLength = this.#lastBuffer.byteLength;
		this.#pageCount = Math.floor(this.#lastByteLength / WasmMemory.PAGE_SIZE);
	}

	/**
	 * Adopts an existing native `WebAssembly.Memory` instance, deriving `pageCount` from
	 * the actual `memory.buffer.byteLength`.
	 * If `expectedPages` is provided, validates that it matches the actual page count.
	 */
	static fromNative(memory: WebAssembly.Memory, expectedPages?: number): WasmMemory {
		if (!(memory instanceof WebAssembly.Memory)) {
			throw new TypeError("WasmMemory.fromNative: expected a WebAssembly.Memory instance.");
		}
		const actualByteLength = memory.buffer.byteLength;
		const actualPages = Math.floor(actualByteLength / WasmMemory.PAGE_SIZE);
		if (expectedPages !== undefined) {
			if (!Number.isInteger(expectedPages) || expectedPages < 0) {
				throw new RangeError(
					`WasmMemory.fromNative: expectedPages must be a non-negative integer, got ${expectedPages}.`
				);
			}
			if (expectedPages !== actualPages) {
				throw new RangeError(
					`WasmMemory.fromNative: expectedPages (${expectedPages}) does not match actual memory page count (${actualPages}).`
				);
			}
		}

		return new WasmMemory(memory as unknown as MemoryDescriptor);
	}

	/**
	 * Checks whether the underlying `WebAssembly.Memory` buffer identity or byte length has changed
	 * (for example due to guest `memory.grow` or `handle.grow()`).
	 * Returns `true` if a change was observed and `generation` was incremented.
	 */
	refresh(): boolean {
		const currentBuffer = this.#memory.buffer;
		const currentByteLength = currentBuffer.byteLength;
		if (currentBuffer !== this.#lastBuffer || currentByteLength !== this.#lastByteLength) {
			const previousByteLength = this.#lastByteLength;
			this.#lastBuffer = currentBuffer;
			this.#lastByteLength = currentByteLength;
			this.#pageCount = Math.floor(currentByteLength / WasmMemory.PAGE_SIZE);
			this.#generation += 1;

			const listenersSnapshot = [...this.#listeners];
			for (let i = 0; i < listenersSnapshot.length; i++) {
				listenersSnapshot[i](currentBuffer as ArrayBuffer, previousByteLength);
			}
			return true;
		}
		return false;
	}

	/**
	 * Grows linear memory by `deltaPages` (64 KiB each).
	 * Returns the previous page count before growth.
	 */
	grow(deltaPages: number): number {
		if (!Number.isInteger(deltaPages) || deltaPages < 0) {
			throw new RangeError(`WasmMemory.grow: deltaPages must be a non-negative integer, got ${deltaPages}.`);
		}
		this.refresh();
		if (deltaPages === 0) {
			return this.#pageCount;
		}
		if (this.#maximumPages !== undefined && this.#pageCount + deltaPages > this.#maximumPages) {
			throw new RangeError(
				`WasmMemory.grow: growing by ${deltaPages} pages from ${this.#pageCount} exceeds maximumPages (${this.#maximumPages}).`
			);
		}

		const previousPages = this.#memory.grow(deltaPages);
		this.refresh();
		return previousPages;
	}

	/**
	 * Registers a listener invoked when memory growth is observed (immediately on `grow()`,
	 * or on the next `refresh()` / getter access after guest `memory.grow`).
	 * Returns an unsubscribe function.
	 */
	onResize(listener: MemoryResizeListener): () => void {
		this.#listeners.push(listener);
		return () => {
			const index = this.#listeners.indexOf(listener);
			if (index !== -1) {
				this.#listeners.splice(index, 1);
			}
		};
	}

	get handle(): WebAssembly.Memory {
		return this.#memory;
	}

	get buffer(): ArrayBuffer {
		this.refresh();
		return this.#lastBuffer as ArrayBuffer;
	}

	get pageCount(): number {
		this.refresh();
		return this.#pageCount;
	}

	get byteLength(): number {
		this.refresh();
		return this.#lastByteLength;
	}

	get generation(): number {
		this.refresh();
		return this.#generation;
	}

	get isShared(): boolean {
		return this.#isShared;
	}

	get maximumPages(): number | undefined {
		return this.#maximumPages;
	}
}
