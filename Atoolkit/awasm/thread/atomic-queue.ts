// ================================================================
//  Awasm - Threading: AtomicQueue
// ================================================================

/**
 * Lock-free circular ring buffer residing in shared linear memory.
 * Coordinates message passing between worker threads via atomic load and store operations.
 *
 * Memory layout:
 * - offset + 0: Atomic Head Index (4 bytes)
 * - offset + 4: Atomic Tail Index (4 bytes)
 * - offset + 8: Ring buffer slots (capacity * 4 bytes)
 */
export class AtomicQueue {
    private readonly _view: Int32Array;
    private readonly _headIndex: number;
    private readonly _tailIndex: number;
    private readonly _dataBaseIndex: number;
    private readonly _capacity: number;
    private readonly _mask: number;

    constructor(buffer: SharedArrayBuffer, byteOffset: number, capacityPowerOfTwo: number = 256) {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Byte offset must be 4-byte aligned, received ${byteOffset}`);
        }
        if ((capacityPowerOfTwo & (capacityPowerOfTwo - 1)) !== 0 || capacityPowerOfTwo <= 0) {
            throw new Error(`Capacity must be a positive power of two, received ${capacityPowerOfTwo}`);
        }

        this._view = new Int32Array(buffer);
        const base = byteOffset >> 2;
        this._headIndex = base;
        this._tailIndex = base + 1;
        this._dataBaseIndex = base + 2;
        this._capacity = capacityPowerOfTwo;
        this._mask = capacityPowerOfTwo - 1;
    }

    /**
     * Appends a 32-bit integer to the ring buffer. Returns false when full.
     */
    public enqueue(value: number): boolean {
        const head = Atomics.load(this._view, this._headIndex);
        const tail = Atomics.load(this._view, this._tailIndex);

        if (tail - head >= this._capacity) {
            return false;
        }

        const slotIndex = this._dataBaseIndex + (tail & this._mask);
        Atomics.store(this._view, slotIndex, value);
        Atomics.store(this._view, this._tailIndex, tail + 1);

        return true;
    }

    /**
     * Reads and removes the next 32-bit integer from the ring buffer. Returns null when empty.
     */
    public dequeue(): number | null {
        const head = Atomics.load(this._view, this._headIndex);
        const tail = Atomics.load(this._view, this._tailIndex);

        if (head >= tail) {
            return null;
        }

        const slotIndex = this._dataBaseIndex + (head & this._mask);
        const value = Atomics.load(this._view, slotIndex);
        Atomics.store(this._view, this._headIndex, head + 1);

        return value;
    }

    public get length(): number {
        const head = Atomics.load(this._view, this._headIndex);
        const tail = Atomics.load(this._view, this._tailIndex);
        return Math.max(0, tail - head);
    }

    public get capacity(): number {
        return this._capacity;
    }

    /**
     * Calculates the total byte size required to host ring buffer metadata and slots.
     */
    public static requiredBytes(capacityPowerOfTwo: number): number {
        return (2 + capacityPowerOfTwo) * 4;
    }
}
