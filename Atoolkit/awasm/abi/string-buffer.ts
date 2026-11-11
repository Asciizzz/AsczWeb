// ================================================================
//  Awasm - ABI: StringBuffer
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";
import { LinearArena } from "../memory/linear-arena.js";
import { Slice } from "./slice.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * UTF-8 string marshalling between JavaScript host strings and guest `WasmMemory`.
 *
 * Allocation and decoding contract:
 * - `write()` encodes a JS string as UTF-8 into a `LinearArena`, appends a trailing `\0` byte,
 *   and returns a `Slice(ptr, utf8ByteLength)` (excluding the null terminator).
 * - `read()` and `readNullTerminated()` validate guest byte ranges against `memory.byteLength`
 *   and decode UTF-8 bytes into a new JavaScript `string`.
 */
export class StringBuffer {
	/**
	 * Encodes `text` as UTF-8 into `arena` with a trailing null terminator (`\0`) and returns
	 * a `Slice(ptr, byteLength)` covering the UTF-8 payload bytes.
	 */
	static write(text: string, arena: LinearArena, memory: WasmMemory = arena.memory): Slice {
		if (typeof text !== "string") {
			throw new TypeError("StringBuffer.write: text must be a string.");
		}
		if (memory !== arena.memory) {
			throw new Error("StringBuffer.write: provided memory does not match arena.memory.");
		}

		const maxBytes = text.length * 3 + 1;
		if (arena.availableBytes >= maxBytes) {
			const ptr = arena.allocate(maxBytes, 1);
			const memoryBytes = new Uint8Array(memory.buffer, ptr, maxBytes);
			const result = encoder.encodeInto(text, memoryBytes);
			const written = result.written ?? 0;
			memoryBytes[written] = 0;
			arena.rewind(ptr + written + 1);
			return new Slice(ptr, written);
		}

		// When worst-case 3x UTF-8 estimate exceeds remaining arena space, measure exact UTF-8 byte length.
		const encoded = encoder.encode(text);
		const exactAllocated = encoded.byteLength + 1;
		const ptr = arena.allocate(exactAllocated, 1);
		const dst = new Uint8Array(memory.buffer, ptr, exactAllocated);
		dst.set(encoded, 0);
		dst[encoded.byteLength] = 0;
		return new Slice(ptr, encoded.byteLength);
	}

	/**
	 * Decodes a UTF-8 guest memory span `[ptr, ptr + length)` into a JavaScript string.
	 */
	static read(ptr: number, length: number, memory: WasmMemory): string {
		if (!Number.isSafeInteger(ptr) || ptr < 0) {
			throw new RangeError(`StringBuffer.read: ptr must be a non-negative integer, received ${ptr}.`);
		}
		if (!Number.isSafeInteger(length) || length < 0) {
			throw new RangeError(`StringBuffer.read: length must be a non-negative integer, received ${length}.`);
		}
		const memByteLength = memory.byteLength;
		if (ptr + length > memByteLength) {
			throw new RangeError(
				`StringBuffer.read: span [${ptr}, ${ptr + length}) exceeds memory byteLength (${memByteLength}).`
			);
		}
		if (length === 0) {
			return "";
		}
		const view = new Uint8Array(memory.buffer, ptr, length);
		const decodeBytes = memory.isShared ? view.slice() : view;
		return decoder.decode(decodeBytes);
	}

	/**
	 * Scans for a null terminator (`\0`) starting at `ptr` (up to `maxScanBytes`) and decodes the UTF-8 string.
	 * Throws a `RangeError` if `ptr` is out of bounds or if no null terminator is found within the scan bound.
	 */
	static readNullTerminated(
		ptr: number,
		memory: WasmMemory,
		maxScanBytes = 4096
	): string {
		if (!Number.isSafeInteger(ptr) || ptr < 0) {
			throw new RangeError(
				`StringBuffer.readNullTerminated: ptr must be a non-negative integer, received ${ptr}.`
			);
		}
		if (!Number.isSafeInteger(maxScanBytes) || maxScanBytes < 1) {
			throw new RangeError(
				`StringBuffer.readNullTerminated: maxScanBytes must be a positive integer, received ${maxScanBytes}.`
			);
		}

		const memByteLength = memory.byteLength;
		if (ptr >= memByteLength) {
			throw new RangeError(
				`StringBuffer.readNullTerminated: ptr (${ptr}) is outside memory byteLength (${memByteLength}).`
			);
		}

		const memoryBytes = new Uint8Array(memory.buffer);
		const limit = Math.min(memByteLength, ptr + maxScanBytes);
		let end = ptr;

		while (end < limit && memoryBytes[end] !== 0) {
			end++;
		}

		if (end >= limit) {
			throw new RangeError(
				`StringBuffer.readNullTerminated: null terminator not found within ${ limit - ptr } bytes from ptr ${ptr}.`
			);
		}

		const length = end - ptr;
		if (length === 0) {
			return "";
		}
		const view = new Uint8Array(memory.buffer, ptr, length);
		const decodeBytes = memory.isShared ? view.slice() : view;
		return decoder.decode(decodeBytes);
	}
}
