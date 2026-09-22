// ================================================================
//  Awasm - Threading: SharedMemory
// ================================================================

export interface SharedMemoryDescriptor {
    initial: number;
    maximum: number;
}

export type WaitResult = "ok" | "not-equal" | "timed-out";

/**
 * Shared linear memory coordinator backed by SharedArrayBuffer and Atomics.
 * Provides thread-safe WebAssembly memory accessible across Web Workers.
 */
export class SharedMemory {
    private readonly _memory: WebAssembly.Memory;
    private readonly _int32View: Int32Array;
    private readonly _initialPages: number;
    private readonly _maximumPages: number;

    constructor(descriptor: SharedMemoryDescriptor) {
        if (descriptor.maximum < descriptor.initial) {
            throw new Error(
                `Maximum pages (${descriptor.maximum}) must be greater than or equal to initial (${descriptor.initial})`
            );
        }

        this._initialPages = descriptor.initial;
        this._maximumPages = descriptor.maximum;

        this._memory = new WebAssembly.Memory({
            initial: descriptor.initial,
            maximum: descriptor.maximum,
            shared: true,
        });

        this._int32View = new Int32Array(this._memory.buffer);
    }

    /**
     * Executes Atomics.wait on the 32-bit integer location at the specified byte offset.
     * Note: Cannot execute on browser main UI thread.
     */
    public wait(byteOffset: number, expectedValue: number, timeoutMs?: number): WaitResult {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Byte offset must be 4-byte aligned for 32-bit atomics, received ${byteOffset}`);
        }
        const index = byteOffset >> 2;
        return Atomics.wait(this._int32View, index, expectedValue, timeoutMs);
    }

    /**
     * Executes Atomics.notify on the 32-bit integer location at the specified byte offset.
     */
    public notify(byteOffset: number, count: number = 1): number {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Byte offset must be 4-byte aligned for 32-bit atomics, received ${byteOffset}`);
        }
        const index = byteOffset >> 2;
        return Atomics.notify(this._int32View, index, count);
    }

    /**
     * Performs an atomic 32-bit integer read at the specified byte offset.
     */
    public load(byteOffset: number): number {
        const index = byteOffset >> 2;
        return Atomics.load(this._int32View, index);
    }

    /**
     * Performs an atomic 32-bit integer write at the specified byte offset.
     */
    public store(byteOffset: number, value: number): number {
        const index = byteOffset >> 2;
        return Atomics.store(this._int32View, index, value);
    }

    public get handle(): WebAssembly.Memory {
        return this._memory;
    }

    public get buffer(): SharedArrayBuffer {
        return this._memory.buffer as unknown as SharedArrayBuffer;
    }

    public get initialPages(): number {
        return this._initialPages;
    }

    public get maximumPages(): number {
        return this._maximumPages;
    }
}
