// ================================================================
//  Awasm - Linear Memory: MemoryView
// ================================================================

import { WasmMemory } from "./wasm-memory.js";

/**
 * Detachment-resilient typed array accessors over WebAssembly linear memory.
 * Caches buffer references and revalidates views against WasmMemory generation counters
 * to prevent accessing detached ArrayBuffers following memory expansion.
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

    /**
     * Slices an 8-bit unsigned integer view over linear memory.
     */
    public asUint8(byteOffset: number, length: number): Uint8Array {
        const buffer = this.resolveBuffer();
        return new Uint8Array(buffer, byteOffset, length);
    }

    /**
     * Slices an 8-bit signed integer view over linear memory.
     */
    public asInt8(byteOffset: number, length: number): Int8Array {
        const buffer = this.resolveBuffer();
        return new Int8Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 16-bit signed integer view over linear memory. Requires 2-byte alignment.
     */
    public asInt16(byteOffset: number, length: number): Int16Array {
        if ((byteOffset & 1) !== 0) {
            throw new Error(`Int16 offset must be 2-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Int16Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 16-bit unsigned integer view over linear memory. Requires 2-byte alignment.
     */
    public asUint16(byteOffset: number, length: number): Uint16Array {
        if ((byteOffset & 1) !== 0) {
            throw new Error(`Uint16 offset must be 2-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Uint16Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 32-bit signed integer view over linear memory. Requires 4-byte alignment.
     */
    public asInt32(byteOffset: number, length: number): Int32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Int32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Int32Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 32-bit unsigned integer view over linear memory. Requires 4-byte alignment.
     */
    public asUint32(byteOffset: number, length: number): Uint32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Uint32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Uint32Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 32-bit floating point view over linear memory. Requires 4-byte alignment.
     */
    public asFloat32(byteOffset: number, length: number): Float32Array {
        if ((byteOffset & 3) !== 0) {
            throw new Error(`Float32 offset must be 4-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Float32Array(buffer, byteOffset, length);
    }

    /**
     * Slices a 64-bit floating point view over linear memory. Requires 8-byte alignment.
     */
    public asFloat64(byteOffset: number, length: number): Float64Array {
        if ((byteOffset & 7) !== 0) {
            throw new Error(`Float64 offset must be 8-byte aligned, received ${byteOffset}`);
        }
        const buffer = this.resolveBuffer();
        return new Float64Array(buffer, byteOffset, length);
    }

    /**
     * Slices a DataView window over linear memory.
     */
    public asDataView(byteOffset: number, byteLength: number): DataView {
        const buffer = this.resolveBuffer();
        return new DataView(buffer, byteOffset, byteLength);
    }

    public get memory(): WasmMemory {
        return this._memory;
    }
}
