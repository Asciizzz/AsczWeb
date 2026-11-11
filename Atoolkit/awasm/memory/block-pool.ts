// ================================================================
//  Awasm - Linear Memory: BlockPool
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

const FREE_LIST_SENTINEL = 0xffffffff;

export interface BlockPoolOptions {
	/**
	 * When true, grows `memory` during construction if `[offset, offset + blockCount * blockSize)`
	 * exceeds `memory.byteLength`. Defaults to `false`.
	 */
	autoGrow?: boolean;
}

/**
 * Single-owner fixed-size slab allocator managing uniform memory blocks in `WasmMemory`.
 *
 * Ownership and concurrency contract:
 * - Maintains an intrusive singly-linked free list in the first 4 bytes of idle blocks and an
 *   allocation bitmap to detect double-release or never-acquired pointers in O(1) time.
 * - Single-owner and non-thread-safe; concurrent access across workers requires external synchronization.
 */
export class BlockPool {
	readonly #memory: WasmMemory;
	readonly #offset: number;
	readonly #blockCount: number;
	readonly #blockSize: number;
	readonly #totalByteLength: number;
	readonly #allocatedBitmap: Uint32Array;
	#freeHead: number;
	#availableCount: number;

	constructor(
		memory: WasmMemory,
		offset: number,
		blockCount: number,
		blockSize: number,
		options?: BlockPoolOptions
	) {
		if (!Number.isSafeInteger(offset) || offset < 0) {
			throw new RangeError(`BlockPool: offset must be a non-negative integer, received ${offset}.`);
		}
		if (!Number.isSafeInteger(blockCount) || blockCount < 1) {
			throw new RangeError(`BlockPool: blockCount must be a positive integer, received ${blockCount}.`);
		}
		if (!Number.isSafeInteger(blockSize) || blockSize < 4) {
			throw new RangeError(
				`BlockPool: blockSize must be an integer >= 4 bytes, received ${blockSize}.`
			);
		}

		const totalBytes = blockCount * blockSize;
		const endOffset = offset + totalBytes;
		if (!Number.isSafeInteger(endOffset) || endOffset > FREE_LIST_SENTINEL) {
			throw new RangeError(
				`BlockPool: span [${offset}, ${endOffset}) exceeds wasm32 address bounds.`
			);
		}

		if (endOffset > memory.byteLength) {
			if (options?.autoGrow) {
				const neededPages = Math.ceil((endOffset - memory.byteLength) / WasmMemory.PAGE_SIZE);
				memory.grow(neededPages);
			} else {
				throw new RangeError(
					`BlockPool: span [${offset}, ${endOffset}) exceeds memory byteLength (${memory.byteLength}).`
				);
			}
		}

		this.#memory = memory;
		this.#offset = offset;
		this.#blockCount = blockCount;
		this.#blockSize = blockSize;
		this.#totalByteLength = totalBytes;
		this.#allocatedBitmap = new Uint32Array(Math.ceil(blockCount / 32));
		this.#freeHead = offset;
		this.#availableCount = blockCount;

		this.reset();
	}

	/**
	 * Reinitializes all blocks as free and clears the allocation bitmap.
	 */
	reset(): void {
		const view = new DataView(this.#memory.buffer);
		let ptr = this.#offset;

		for (let i = 0; i < this.#blockCount - 1; i++) {
			const nextPtr = ptr + this.#blockSize;
			view.setUint32(ptr, nextPtr, true);
			ptr = nextPtr;
		}

		view.setUint32(ptr, FREE_LIST_SENTINEL, true);
		this.#allocatedBitmap.fill(0);
		this.#freeHead = this.#offset;
		this.#availableCount = this.#blockCount;
	}

	/**
	 * Acquires a free block from the pool in O(1) time.
	 * Returns the byte offset pointer, or `-1` when the pool is exhausted.
	 */
	acquire(): number {
		if (this.#freeHead === FREE_LIST_SENTINEL || this.#availableCount === 0) {
			return -1;
		}

		const allocatedPtr = this.#freeHead;
		const blockIdx = (allocatedPtr - this.#offset) / this.#blockSize;
		const view = new DataView(this.#memory.buffer);
		this.#freeHead = view.getUint32(allocatedPtr, true);
		this.#availableCount -= 1;

		const wordIdx = blockIdx >>> 5;
		const bitMask = 1 << (blockIdx & 31);
		this.#allocatedBitmap[wordIdx] |= bitMask;

		return allocatedPtr;
	}

	/**
	 * Releases an allocated block back to the pool in O(1) time.
	 * Throws if `pointer` is outside the pool span, misaligned, or not currently allocated.
	 */
	release(pointer: number): void {
		if (
			!Number.isSafeInteger(pointer) ||
			pointer < this.#offset ||
			pointer >= this.#offset + this.#totalByteLength
		) {
			throw new RangeError(
				`BlockPool.release: pointer ${pointer} falls outside pool span [${this.#offset}, ${this.#offset + this.#totalByteLength}).`
			);
		}

		const offsetWithinPool = pointer - this.#offset;
		if (offsetWithinPool % this.#blockSize !== 0) {
			throw new RangeError(
				`BlockPool.release: pointer ${pointer} is not aligned to block boundary (${this.#blockSize} bytes).`
			);
		}

		const blockIdx = offsetWithinPool / this.#blockSize;
		const wordIdx = blockIdx >>> 5;
		const bitMask = 1 << (blockIdx & 31);

		if ((this.#allocatedBitmap[wordIdx] & bitMask) === 0) {
			throw new Error(
				`BlockPool.release: pointer ${pointer} (block ${blockIdx}) is not currently allocated.`
			);
		}

		this.#allocatedBitmap[wordIdx] &= ~bitMask;
		const view = new DataView(this.#memory.buffer);
		view.setUint32(pointer, this.#freeHead, true);
		this.#freeHead = pointer;
		this.#availableCount += 1;
	}

	get capacity(): number {
		return this.#blockCount;
	}

	get available(): number {
		return this.#availableCount;
	}

	get allocated(): number {
		return this.#blockCount - this.#availableCount;
	}

	get blockSize(): number {
		return this.#blockSize;
	}

	get offset(): number {
		return this.#offset;
	}

	get totalByteLength(): number {
		return this.#totalByteLength;
	}

	get memory(): WasmMemory {
		return this.#memory;
	}
}
