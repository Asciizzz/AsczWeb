export interface MemoryDescriptor {
    initial: number;
    maximum?: number;
    shared?: boolean;
}

export type MemoryResizeListener = (newBuffer: ArrayBuffer, previousByteLength: number) => void;

/**
 * Manages WebAssembly.Memory lifecycle, page expansion, and buffer stability.
 *
 * Class Responsibility:
 * Owns WebAssembly.Memory instance. Tracks page counts, maximum bounds, and allocation
 * generation counter. Dispatches resize notifications upon memory growth.
 *
 * Method Contracts:
 * - constructor(descriptor: MemoryDescriptor): Instantiates native WebAssembly.Memory.
 * - grow(deltaPages: number): Invokes native grow(), increments generation, notifies listeners.
 * - onResize(listener: MemoryResizeListener): Registers callback invoked upon buffer reallocation.
 *
 * Operational Invariants:
 * - WebAssembly page size is exactly 65,536 bytes (64 KiB).
 * - Memory growth detaches old ArrayBuffer. Generation counter increments on every successful grow.
 */
export class WasmMemory {
    private readonly _memory: WebAssembly.Memory;
    private readonly _isShared: boolean;
    private _pageCount: number;
    private _generation: number;
    private _listeners: MemoryResizeListener[];

    public static readonly PAGE_SIZE: number = 65536;

    constructor(descriptor: MemoryDescriptor) {
        this._isShared = descriptor.shared ?? false;
        this._pageCount = descriptor.initial;
        this._generation = 0;
        this._listeners = [];

        this._memory = new WebAssembly.Memory({
            initial: descriptor.initial,
            maximum: descriptor.maximum,
            shared: descriptor.shared,
        });
    }

    public static fromNative(memory: WebAssembly.Memory, initialPages: number = 1): WasmMemory {
        const instance = Object.create(WasmMemory.prototype) as WasmMemory;
        (instance as any)._memory = memory;
        (instance as any)._isShared = memory.buffer instanceof SharedArrayBuffer;
        (instance as any)._pageCount = initialPages;
        (instance as any)._generation = 0;
        (instance as any)._listeners = [];
        return instance;
    }

    public grow(deltaPages: number): number {
        if (deltaPages <= 0) {
            return this._pageCount;
        }

        const previousByteLength = this._pageCount * WasmMemory.PAGE_SIZE;
        const previousPages = this._memory.grow(deltaPages);
        this._pageCount += deltaPages;
        this._generation += 1;

        const newBuffer = this._memory.buffer as ArrayBuffer;
        for (let i = 0; i < this._listeners.length; i++) {
            this._listeners[i](newBuffer, previousByteLength);
        }

        return previousPages;
    }

    public onResize(listener: MemoryResizeListener): () => void {
        this._listeners.push(listener);
        return () => {
            const index = this._listeners.indexOf(listener);
            if (index !== -1) {
                this._listeners.splice(index, 1);
            }
        };
    }

    public get handle(): WebAssembly.Memory {
        return this._memory;
    }

    public get buffer(): ArrayBuffer {
        return this._memory.buffer as ArrayBuffer;
    }

    public get pageCount(): number {
        return this._pageCount;
    }

    public get byteLength(): number {
        return this._pageCount * WasmMemory.PAGE_SIZE;
    }

    public get generation(): number {
        return this._generation;
    }

    public get isShared(): boolean {
        return this._isShared;
    }
}
