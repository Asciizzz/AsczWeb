/**
 * Lock-free circular ring buffer residing in shared linear memory.
 *
 * Class Responsibility:
 * Coordinates lock-free message passing between worker threads via atomic load/store
 * operations on shared 32-bit integer slots.
 *
 * Layout in shared memory:
 * - offset + 0: Atomic Head Index (4 bytes)
 * - offset + 4: Atomic Tail Index (4 bytes)
 * - offset + 8: Ring buffer slots (capacity * 4 bytes)
 *
 * Method Contracts:
 * - enqueue(value: number): Appends 32-bit integer. Returns false when ring buffer is full.
 * - dequeue(): Reads and removes next 32-bit integer. Returns null when empty.
 * - get length(): Returns instantaneous pending item count.
 *
 * Operational Invariants:
 * - Capacity must be a power of two for mask-based wrapping.
 * - Zero memory allocations during enqueue and dequeue operations.
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

    public enqueue(value: number): boolean {
        const head = Atomics.load(this._view, this._headIndex);
        const tail = Atomics.load(this._view, this._tailIndex);

        if (tail - head >= this._capacity) {
            return false; // Queue full
        }

        const slotIndex = this._dataBaseIndex + (tail & this._mask);
        Atomics.store(this._view, slotIndex, value);
        Atomics.store(this._view, this._tailIndex, tail + 1);

        return true;
    }

    public dequeue(): number | null {
        const head = Atomics.load(this._view, this._headIndex);
        const tail = Atomics.load(this._view, this._tailIndex);

        if (head >= tail) {
            return null; // Queue empty
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

    public static requiredBytes(capacityPowerOfTwo: number): number {
        return (2 + capacityPowerOfTwo) * 4;
    }
}
