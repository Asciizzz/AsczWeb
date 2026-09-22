// ================================================================
//  Awasm - Linear Memory: BlockPool
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

/**
 * Fixed-size slab allocator managing uniform memory blocks in linear memory.
 * Maintains an intrusive single-linked free-list in the first 4 bytes of idle blocks.
 */
export class BlockPool {
    private readonly _memory: WasmMemory;
    private readonly _offset: number;
    private readonly _blockCount: number;
    private readonly _blockSize: number;
    private _freeHead: number;
    private _availableCount: number;

    constructor(memory: WasmMemory, offset: number, blockCount: number, blockSize: number) {
        if (blockSize < 4) {
            throw new Error(`Block size must be at least 4 bytes for intrusive pointer, received ${blockSize}`);
        }
        if (blockCount <= 0) {
            throw new Error(`Block count must be positive, received ${blockCount}`);
        }

        const totalBytes = blockCount * blockSize;
        if (offset + totalBytes > memory.byteLength) {
            const neededPages = Math.ceil((offset + totalBytes - memory.byteLength) / WasmMemory.PAGE_SIZE);
            memory.grow(neededPages);
        }

        this._memory = memory;
        this._offset = offset;
        this._blockCount = blockCount;
        this._blockSize = blockSize;
        this._freeHead = offset;
        this._availableCount = blockCount;

        this.formatFreeList();
    }

    private formatFreeList(): void {
        const view = new DataView(this._memory.buffer);
        let ptr = this._offset;

        for (let i = 0; i < this._blockCount - 1; i++) {
            const nextPtr = ptr + this._blockSize;
            view.setUint32(ptr, nextPtr, true);
            ptr = nextPtr;
        }

        // Final block terminator: 0xFFFFFFFF
        view.setUint32(ptr, 0xffffffff, true);
        this._freeHead = this._offset;
        this._availableCount = this._blockCount;
    }

    /**
     * Acquires a free block from the intrusive stack in O(1) time.
     * Returns byte offset pointer, or -1 when pool is exhausted.
     */
    public acquire(): number {
        if (this._freeHead === 0xffffffff || this._availableCount === 0) {
            return -1;
        }

        const allocatedPtr = this._freeHead;
        const view = new DataView(this._memory.buffer);
        this._freeHead = view.getUint32(allocatedPtr, true);
        this._availableCount -= 1;

        return allocatedPtr;
    }

    /**
     * Releases an allocated block back to the intrusive stack in O(1) time.
     */
    public release(pointer: number): void {
        if (pointer < this._offset || pointer >= this._offset + this._blockCount * this._blockSize) {
            throw new Error(`Pointer ${pointer} falls outside block pool span`);
        }

        const offsetWithinPool = pointer - this._offset;
        if (offsetWithinPool % this._blockSize !== 0) {
            throw new Error(`Pointer ${pointer} is not aligned to block boundary of ${this._blockSize} bytes`);
        }

        const view = new DataView(this._memory.buffer);
        view.setUint32(pointer, this._freeHead, true);
        this._freeHead = pointer;
        this._availableCount += 1;
    }

    public get capacity(): number {
        return this._blockCount;
    }

    public get available(): number {
        return this._availableCount;
    }

    public get blockSize(): number {
        return this._blockSize;
    }

    public get offset(): number {
        return this._offset;
    }

    public get totalByteLength(): number {
        return this._blockCount * this._blockSize;
    }

    public get memory(): WasmMemory {
        return this._memory;
    }
}
