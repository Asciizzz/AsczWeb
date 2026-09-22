import { WasmMemory } from "./wasm-memory.js";

/**
 * Detachment-resilient typed array accessors over WebAssembly linear memory.
 *
 * Class Responsibility:
 * Provides typed array views that remain valid across WebAssembly memory growth.
 * Automatically synchronizes with WasmMemory generation counters to prevent accessing
 * detached ArrayBuffers.
 *
 * Method Contracts:
 * - asUint8(byteOffset: number, length: number): Returns Uint8Array slice view.
 * - asInt32(byteOffset: number, length: number): Returns Int32Array slice view.
 * - asUint32(byteOffset: number, length: number): Returns Uint32Array slice view.
 * - asFloat32(byteOffset: number, length: number): Returns Float32Array slice view.
 * - asFloat64(byteOffset: number, length: number): Returns Float64Array slice view.
 * - asDataView(byteOffset: number, byteLength: number): Returns DataView window.
 *
 * Operational Invariants:
 * - Validates natural element byte alignment for multi-byte types.
 * - Caches reference to current buffer, updating references when memory generation advances.
 */
export class MemoryView {
    private readonly _memory: WasmMemory;
    private _cachedGeneration: number;
    private _cachedBuffer: ArrayBuffer;

    constructor(memory: WasmMemory) {
        this._memory = memory;
        this._cachedGeneration = memory.generation;
        this._cachedBuffer = memory.buffer;
    }

    private resolveBuffer(): ArrayBuffer {
        if (this._cachedGeneration !== this._memory.generation) {
            this._cachedBuffer = this._memory.buffer;
            this._cachedGeneration = this._memory.generation;
        }
        return this._cachedBuffer;
    }

    public asUint8(byteOffset: number, length: number): Uint8Array {
        const buffer = this.resolveBuffer();
        return new Uint8Array(buffer, byteOffset, length);
    }

    public asInt8(byteOffset: number, length: number): Int8Array {
        const buffer = this.resolveBuffer();
        return new Int8Array(buffer, byteOffset, length);
    }

    public asInt16(byteOffset: number, length: number): Int16Array {
        if ((byteOffset & 1) !== 0) {
            throw new Error(`Int16 offset must be 2-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Int16Array(buffer, byteOffset, length);
    }

    public asUint16(byteOffset: number, length: number): Uint16Array {
        if ((byteOffset & 1) !== 0) {
            throw new Error(`Uint16 offset must be 2-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Uint16Array(buffer, byteOffset, length);
    }

    public asInt32(byteOffset: number, length: number): Int32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Int32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Int32Array(buffer, byteOffset, length);
    }

    public asUint32(byteOffset: number, length: number): Uint32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Uint32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Uint32Array(buffer, byteOffset, length);
    }

    public asFloat32(byteOffset: number, length: number): Float32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Float32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Float32Array(buffer, byteOffset, length);
    }

    public asFloat64(byteOffset: number, length: number): Float64Array {
        if ((byteOffset & 7) !== 0) {
            throw new Error(`Float64 offset must be 8-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Float64Array(buffer, byteOffset, length);
    }

    public asDataView(byteOffset: number, byteLength: number): DataView {
        const buffer = this.resolveBuffer();
        return new DataView(buffer, byteOffset, byteLength);
    }

    public get memory(): WasmMemory {
        return this._memory;
    }
}
