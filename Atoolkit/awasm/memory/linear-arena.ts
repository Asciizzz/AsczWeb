// ================================================================
//  Awasm - Linear Memory: LinearArena
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

/**
 * Monotonic bump allocator operating within a reserved span of linear memory.
 * Enforces power-of-two alignments and provides O(1) watermark rewind and reset operations.
 */
export class LinearArena {
    private readonly _memory: WasmMemory;
    private readonly _baseOffset: number;
    private readonly _byteCapacity: number;
    private _currentOffset: number;

    constructor(memory: WasmMemory, baseOffset: number = 0, byteCapacity?: number) {
        if (baseOffset < 0) {
            throw new Error(`Base offset must be non-negative, received ${baseOffset}`);
        }
        this._memory = memory;
        this._baseOffset = baseOffset;
        this._currentOffset = baseOffset;

        const maxAvailable = memory.byteLength - baseOffset;
        if (maxAvailable < 0) {
            throw new Error(`Base offset ${baseOffset} exceeds memory byte length ${memory.byteLength}`);
        }

        this._byteCapacity = byteCapacity !== undefined ? Math.min(byteCapacity, maxAvailable) : maxAvailable;
    }

    /**
     * Allocates a contiguous byte span with the specified power-of-two alignment.
     * Automatically expands underlying linear memory when permitted.
     */
    public allocate(byteSize: number, alignment: number = 8): number {
        if (byteSize <= 0) {
            return this._currentOffset;
        }

        const mask = alignment - 1;
        if ((alignment & mask) !== 0) {
            throw new Error(`Alignment must be a power of two, received ${alignment}`);
        }

        const alignedOffset = (this._currentOffset + mask) & ~mask;
        const nextOffset = alignedOffset + byteSize;

        if (nextOffset - this._baseOffset > this._byteCapacity) {
            const requiredBytes = nextOffset - this._memory.byteLength;
            if (requiredBytes > 0) {
                const pagesNeeded = Math.ceil(requiredBytes / WasmMemory.PAGE_SIZE);
                this._memory.grow(pagesNeeded);
            }

            if (nextOffset - this._baseOffset > this._byteCapacity) {
                throw new Error(
                    `Arena allocation of ${byteSize} bytes exceeds capacity ${this._byteCapacity} at offset ${alignedOffset}`
                );
            }
        }

        this._currentOffset = nextOffset;
        return alignedOffset;
    }

    /**
     * Returns the current allocation offset watermark.
     */
    public mark(): number {
        return this._currentOffset;
    }

    /**
     * Restores the allocation offset to a previously recorded watermark.
     */
    public rewind(mark: number): void {
        if (mark < this._baseOffset || mark > this._currentOffset) {
            throw new Error(`Invalid watermark ${mark}; must be between ${this._baseOffset} and ${this._currentOffset}`);
        }
        this._currentOffset = mark;
    }

    /**
     * Resets the allocation offset to the base pointer, recycling all arena memory in O(1) time.
     */
    public reset(): void {
        this._currentOffset = this._baseOffset;
    }

    public get baseOffset(): number {
        return this._baseOffset;
    }

    public get currentOffset(): number {
        return this._currentOffset;
    }

    public get allocatedBytes(): number {
        return this._currentOffset - this._baseOffset;
    }

    public get availableBytes(): number {
        return this._byteCapacity - (this._currentOffset - this._baseOffset);
    }

    public get byteCapacity(): number {
        return this._byteCapacity;
    }

    public get memory(): WasmMemory {
        return this._memory;
    }
}
