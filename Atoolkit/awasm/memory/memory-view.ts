// ================================================================
//  Awasm - Linear Memory: MemoryView
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

/**
 * Typed-array and DataView factory over `WasmMemory`.
 *
 * Borrowed view lifetime contract:
 * - Each `as*` method refreshes the underlying `WasmMemory` buffer reference and constructs a new view
 *   over the current `ArrayBuffer` or `SharedArrayBuffer`.
 * - Previously returned typed arrays cannot be updated in place after memory growth: on non-shared
 *   `WebAssembly.Memory`, growth detaches the prior `ArrayBuffer`; on shared `WebAssembly.Memory`,
 *   prior views remain bound to the older, shorter `SharedArrayBuffer`. Always re-acquire views via
 *   `MemoryView` after any operation that may grow linear memory.
 */
export class MemoryView {
	readonly #memory: WasmMemory;
	#cachedGeneration: number;
	#cachedBuffer: ArrayBuffer;
	#cachedByteLength: number;

	constructor(memory: WasmMemory) {
		this.#memory = memory;
		this.#cachedBuffer = memory.buffer;
		this.#cachedByteLength = memory.byteLength;
		this.#cachedGeneration = memory.generation;
	}

	#resolveBuffer(): ArrayBuffer {
		this.#memory.refresh();
		const gen = this.#memory.generation;
		const buf = this.#memory.buffer;
		const byteLen = buf.byteLength;
		if (
			this.#cachedGeneration !== gen ||
			this.#cachedBuffer !== buf ||
			this.#cachedByteLength !== byteLen
		) {
			this.#cachedBuffer = buf;
			this.#cachedByteLength = byteLen;
			this.#cachedGeneration = gen;
		}
		return this.#cachedBuffer;
	}

	#validateSpan(
		byteOffset: number,
		elementCount: number,
		bytesPerElement: number,
		typeName: string
	): ArrayBuffer {
		if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
			throw new RangeError(`${typeName} byteOffset must be a non-negative integer, received ${byteOffset}.`);
		}
		if (!Number.isSafeInteger(elementCount) || elementCount < 0) {
			throw new RangeError(`${typeName} length must be a non-negative integer, received ${elementCount}.`);
		}
		if (bytesPerElement > 1 && byteOffset % bytesPerElement !== 0) {
			throw new RangeError(
				`${typeName} byteOffset must be ${bytesPerElement}-byte aligned, received ${byteOffset}.`
			);
		}
		const buffer = this.#resolveBuffer();
		const byteLength = elementCount * bytesPerElement;
		if (byteOffset + byteLength > buffer.byteLength) {
			throw new RangeError(
				`${typeName} span [${byteOffset}, ${byteOffset + byteLength}) exceeds memory byteLength (${buffer.byteLength}).`
			);
		}
		return buffer;
	}

	/**
	 * Creates a borrowed `Uint8Array` view over `[byteOffset, byteOffset + length)`.
	 */
	asUint8(byteOffset: number, length: number): Uint8Array {
		const buffer = this.#validateSpan(byteOffset, length, 1, "Uint8");
		return new Uint8Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Int8Array` view over `[byteOffset, byteOffset + length)`.
	 */
	asInt8(byteOffset: number, length: number): Int8Array {
		const buffer = this.#validateSpan(byteOffset, length, 1, "Int8");
		return new Int8Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Int16Array` view over `[byteOffset, byteOffset + length * 2)`. Requires 2-byte alignment.
	 */
	asInt16(byteOffset: number, length: number): Int16Array {
		const buffer = this.#validateSpan(byteOffset, length, 2, "Int16");
		return new Int16Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Uint16Array` view over `[byteOffset, byteOffset + length * 2)`. Requires 2-byte alignment.
	 */
	asUint16(byteOffset: number, length: number): Uint16Array {
		const buffer = this.#validateSpan(byteOffset, length, 2, "Uint16");
		return new Uint16Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Int32Array` view over `[byteOffset, byteOffset + length * 4)`. Requires 4-byte alignment.
	 */
	asInt32(byteOffset: number, length: number): Int32Array {
		const buffer = this.#validateSpan(byteOffset, length, 4, "Int32");
		return new Int32Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Uint32Array` view over `[byteOffset, byteOffset + length * 4)`. Requires 4-byte alignment.
	 */
	asUint32(byteOffset: number, length: number): Uint32Array {
		const buffer = this.#validateSpan(byteOffset, length, 4, "Uint32");
		return new Uint32Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Float32Array` view over `[byteOffset, byteOffset + length * 4)`. Requires 4-byte alignment.
	 */
	asFloat32(byteOffset: number, length: number): Float32Array {
		const buffer = this.#validateSpan(byteOffset, length, 4, "Float32");
		return new Float32Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `Float64Array` view over `[byteOffset, byteOffset + length * 8)`. Requires 8-byte alignment.
	 */
	asFloat64(byteOffset: number, length: number): Float64Array {
		const buffer = this.#validateSpan(byteOffset, length, 8, "Float64");
		return new Float64Array(buffer, byteOffset, length);
	}

	/**
	 * Creates a borrowed `DataView` window over `[byteOffset, byteOffset + byteLength)`.
	 */
	asDataView(byteOffset: number, byteLength: number): DataView {
		const buffer = this.#validateSpan(byteOffset, byteLength, 1, "DataView");
		return new DataView(buffer, byteOffset, byteLength);
	}

	get memory(): WasmMemory {
		return this.#memory;
	}
}
