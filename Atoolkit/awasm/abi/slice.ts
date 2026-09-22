import { WasmMemory } from "../memory/wasm-memory.js";

/**
 * Value object encapsulating a span of WebAssembly linear memory (pointer + length).
 *
 * Class Responsibility:
 * Represents guest memory boundaries. Exposes typed sub-array views and transfer
 * methods without duplicating memory buffers.
 *
 * Method Contracts:
 * - readUint8(memory: WasmMemory): Returns Uint8Array window across slice span.
 * - readFloat32(memory: WasmMemory): Returns Float32Array window across slice span.
 * - readUint32(memory: WasmMemory): Returns Uint32Array window across slice span.
 * - copyFrom(source: ArrayBufferView, memory: WasmMemory): Writes external bytes into guest memory.
 *
 * Operational Invariants:
 * - Operates strictly as an address window over active linear memory buffer.
 * - Validates pointer and length against memory byte length.
 */
export class Slice {
    public readonly ptr: number;
    public readonly length: number;

    constructor(ptr: number, length: number) {
        if (ptr < 0) {
            throw new Error(`Pointer must be non-negative, received ${ptr}`);
        }
        if (length < 0) {
            throw new Error(`Length must be non-negative, received ${length}`);
        }
        this.ptr = ptr;
        this.length = length;
    }

    public readUint8(memory: WasmMemory): Uint8Array {
        this.assertBounds(memory);
        return new Uint8Array(memory.buffer, this.ptr, this.length);
    }

    public readFloat32(memory: WasmMemory): Float32Array {
        this.assertBounds(memory);
        if ((this.ptr & 3) !== 0) {
            throw new Error(`Slice pointer ${this.ptr} is not 4-byte aligned for Float32`);
        }
        const elementCount = Math.floor(this.length / 4);
        return new Float32Array(memory.buffer, this.ptr, elementCount);
    }

    public readUint32(memory: WasmMemory): Uint32Array {
        this.assertBounds(memory);
        if ((this.ptr & 3) !== 0) {
            throw new Error(`Slice pointer ${this.ptr} is not 4-byte aligned for Uint32`);
        }
        const elementCount = Math.floor(this.length / 4);
        return new Uint32Array(memory.buffer, this.ptr, elementCount);
    }

    public copyFrom(source: ArrayBufferView, memory: WasmMemory): void {
        this.assertBounds(memory);
        const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        if (sourceBytes.byteLength > this.length) {
            throw new Error(
                `Source byte length ${sourceBytes.byteLength} exceeds slice capacity of ${this.length} bytes`
            );
        }
        const targetBytes = new Uint8Array(memory.buffer, this.ptr, sourceBytes.byteLength);
        targetBytes.set(sourceBytes);
    }

    private assertBounds(memory: WasmMemory): void {
        if (this.ptr + this.length > memory.byteLength) {
            throw new Error(
                `Slice span [${this.ptr}, ${this.ptr + this.length}) exceeds memory byte length ${memory.byteLength}`
            );
        }
    }
}
