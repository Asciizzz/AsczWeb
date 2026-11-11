// ================================================================
//  Awasm - ABI: Slice
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";

/**
 * Value object encapsulating a byte span `(ptr, length)` in guest `WasmMemory`.
 *
 * View lifetime contract:
 * - `readUint8`, `readFloat32`, and `readUint32` validate bounds against the current `memory.byteLength`
 *   and return a borrowed typed array view over `memory.buffer`.
 * - As with `MemoryView`, returned typed array views are invalidated if the underlying `WasmMemory`
 *   subsequently grows.
 */
export class Slice {
	readonly ptr: number;
	readonly length: number;

	constructor(ptr: number, length: number) {
		if (!Number.isSafeInteger(ptr) || ptr < 0) {
			throw new RangeError(`Slice: ptr must be a non-negative integer, received ${ptr}.`);
		}
		if (!Number.isSafeInteger(length) || length < 0) {
			throw new RangeError(`Slice: length must be a non-negative integer, received ${length}.`);
		}
		this.ptr = ptr;
		this.length = length;
	}

	/**
	 * Creates a borrowed `Uint8Array` view across `[ptr, ptr + length)`.
	 */
	readUint8(memory: WasmMemory): Uint8Array {
		this.#assertBounds(memory);
		return new Uint8Array(memory.buffer, this.ptr, this.length);
	}

	/**
	 * Creates a borrowed `Float32Array` view across `[ptr, ptr + length)`.
	 * Requires both `ptr` and `length` to be multiples of 4 bytes.
	 */
	readFloat32(memory: WasmMemory): Float32Array {
		this.#assertBounds(memory);
		if (this.ptr % 4 !== 0) {
			throw new RangeError(`Slice.readFloat32: ptr (${this.ptr}) is not 4-byte aligned.`);
		}
		if (this.length % 4 !== 0) {
			throw new RangeError(
				`Slice.readFloat32: byte length (${this.length}) is not a multiple of 4.`
			);
		}
		return new Float32Array(memory.buffer, this.ptr, this.length / 4);
	}

	/**
	 * Creates a borrowed `Uint32Array` view across `[ptr, ptr + length)`.
	 * Requires both `ptr` and `length` to be multiples of 4 bytes.
	 */
	readUint32(memory: WasmMemory): Uint32Array {
		this.#assertBounds(memory);
		if (this.ptr % 4 !== 0) {
			throw new RangeError(`Slice.readUint32: ptr (${this.ptr}) is not 4-byte aligned.`);
		}
		if (this.length % 4 !== 0) {
			throw new RangeError(
				`Slice.readUint32: byte length (${this.length}) is not a multiple of 4.`
			);
		}
		return new Uint32Array(memory.buffer, this.ptr, this.length / 4);
	}

	/**
	 * Copies `source` bytes into guest linear memory starting at `ptr`.
	 */
	copyFrom(source: ArrayBufferView, memory: WasmMemory): void {
		this.#assertBounds(memory);
		const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
		if (sourceBytes.byteLength > this.length) {
			throw new RangeError(
				`Slice.copyFrom: source byteLength (${sourceBytes.byteLength}) exceeds slice capacity (${this.length} bytes).`
			);
		}
		const targetBytes = new Uint8Array(memory.buffer, this.ptr, sourceBytes.byteLength);
		targetBytes.set(sourceBytes);
	}

	#assertBounds(memory: WasmMemory): void {
		const memByteLength = memory.byteLength;
		if (this.ptr + this.length > memByteLength) {
			throw new RangeError(
				`Slice: span [${this.ptr}, ${this.ptr + this.length}) exceeds memory byteLength (${memByteLength}).`
			);
		}
	}
}
