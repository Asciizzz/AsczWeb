// ================================================================
//  Awasm - Linear Memory: LinearArena
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

const WASM32_MAX_BYTES = 0x100000000;

function isPowerOfTwoAlignment(alignment: number): boolean {
	return (
		Number.isSafeInteger(alignment) &&
		alignment >= 1 &&
		alignment <= 0x40000000 &&
		(alignment & (alignment - 1)) === 0
	);
}

/**
 * Single-owner monotonic bump allocator operating within a fixed reserved span of `WasmMemory`.
 *
 * Ownership and concurrency contract:
 * - Operates strictly within `[baseOffset, baseOffset + byteCapacity)`.
 * - Out-of-capacity allocations fail without growing the underlying `WasmMemory` or advancing `currentOffset`.
 * - Single-owner and non-thread-safe; concurrent access across workers requires external synchronization.
 */
export class LinearArena {
	readonly #memory: WasmMemory;
	readonly #baseOffset: number;
	readonly #byteCapacity: number;
	#currentOffset: number;

	constructor(memory: WasmMemory, baseOffset = 0, byteCapacity?: number) {
		if (!Number.isSafeInteger(baseOffset) || baseOffset < 0) {
			throw new RangeError(`LinearArena: baseOffset must be a non-negative integer, received ${baseOffset}.`);
		}
		const memByteLength = memory.byteLength;
		if (baseOffset > memByteLength) {
			throw new RangeError(
				`LinearArena: baseOffset (${baseOffset}) exceeds memory byteLength (${memByteLength}).`
			);
		}

		const maxAvailable = memByteLength - baseOffset;
		const resolvedCapacity = byteCapacity ?? maxAvailable;
		if (!Number.isSafeInteger(resolvedCapacity) || resolvedCapacity < 0) {
			throw new RangeError(
				`LinearArena: byteCapacity must be a non-negative integer, received ${resolvedCapacity}.`
			);
		}
		if (baseOffset + resolvedCapacity > memByteLength || baseOffset + resolvedCapacity > WASM32_MAX_BYTES) {
			throw new RangeError(
				`LinearArena: reserved span [${baseOffset}, ${baseOffset + resolvedCapacity}) exceeds memory byteLength (${memByteLength}).`
			);
		}

		this.#memory = memory;
		this.#baseOffset = baseOffset;
		this.#byteCapacity = resolvedCapacity;
		this.#currentOffset = baseOffset;
	}

	/**
	 * Attempts to allocate `byteSize` bytes aligned to `alignment` (power of two).
	 * Returns the allocated byte offset, or `null` if the arena does not have sufficient capacity.
	 * Leaves `currentOffset` and `memory` unchanged on failure.
	 */
	tryAllocate(byteSize: number, alignment = 8): number | null {
		if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
			throw new RangeError(`LinearArena.allocate: byteSize must be a non-negative integer, received ${byteSize}.`);
		}
		if (!isPowerOfTwoAlignment(alignment)) {
			throw new RangeError(`LinearArena.allocate: alignment must be a positive power of two, received ${alignment}.`);
		}

		const rem = this.#currentOffset % alignment;
		const alignedOffset = rem === 0 ? this.#currentOffset : this.#currentOffset + (alignment - rem);
		const nextOffset = alignedOffset + byteSize;

		if (nextOffset - this.#baseOffset > this.#byteCapacity) {
			return null;
		}

		this.#currentOffset = nextOffset;
		return alignedOffset;
	}

	/**
	 * Allocates `byteSize` bytes aligned to `alignment` (power of two).
	 * Throws a `RangeError` without growing `memory` or mutating `currentOffset` if capacity is exceeded.
	 */
	allocate(byteSize: number, alignment = 8): number {
		const ptr = this.tryAllocate(byteSize, alignment);
		if (ptr === null) {
			throw new RangeError(
				`LinearArena.allocate: request of ${byteSize} bytes (alignment ${alignment}) exceeds arena capacity (${this.#byteCapacity} bytes).`
			);
		}
		return ptr;
	}

	/**
	 * Returns the current allocation offset watermark.
	 */
	mark(): number {
		return this.#currentOffset;
	}

	/**
	 * Restores the allocation offset to a previously recorded watermark within `[baseOffset, currentOffset]`.
	 */
	rewind(mark: number): void {
		if (!Number.isSafeInteger(mark) || mark < this.#baseOffset || mark > this.#currentOffset) {
			throw new RangeError(
				`LinearArena.rewind: invalid watermark ${mark}; must be an integer in [${this.#baseOffset}, ${this.#currentOffset}].`
			);
		}
		this.#currentOffset = mark;
	}

	/**
	 * Resets the allocation offset to `baseOffset` in O(1) time.
	 */
	reset(): void {
		this.#currentOffset = this.#baseOffset;
	}

	get baseOffset(): number {
		return this.#baseOffset;
	}

	get currentOffset(): number {
		return this.#currentOffset;
	}

	get allocatedBytes(): number {
		return this.#currentOffset - this.#baseOffset;
	}

	get availableBytes(): number {
		return this.#byteCapacity - (this.#currentOffset - this.#baseOffset);
	}

	get byteCapacity(): number {
		return this.#byteCapacity;
	}

	get memory(): WasmMemory {
		return this.#memory;
	}
}
