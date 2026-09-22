import { WasmMemory } from "../memory/wasm-memory.js";
import { LinearArena } from "../memory/linear-arena.js";
import { Slice } from "./slice.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * UTF-8 string marshalling across host JavaScript and guest linear memory.
 *
 * Class Responsibility:
 * Encodes JavaScript strings directly into WebAssembly linear memory allocations and
 * decodes guest memory byte sequences into host strings.
 *
 * Method Contracts:
 * - write(text: string, arena: LinearArena, memory: WasmMemory): Slice: Allocates arena memory and encodes string.
 * - read(ptr: number, length: number, memory: WasmMemory): string: Decodes UTF-8 byte span.
 * - readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes?: number): string: Scans for null terminator and decodes.
 *
 * Operational Invariants:
 * - Uses singleton TextEncoder and TextDecoder instances to eliminate garbage collection.
 * - Allocates 1 extra byte for null terminator when writing strings to linear arena.
 */
export class StringBuffer {
    public static write(text: string, arena: LinearArena, memory: WasmMemory): Slice {
        // Upper bound byte length for UTF-8 is 3 bytes per UTF-16 code unit
        const maxBytes = text.length * 3 + 1;
        const ptr = arena.allocate(maxBytes, 1);

        const memoryBytes = new Uint8Array(memory.buffer, ptr, maxBytes);
        const result = encoder.encodeInto(text, memoryBytes);

        // Append null terminator
        const written = result.written ?? 0;
        memoryBytes[written] = 0;

        // Rewind unused allocated bytes
        const actualAllocated = written + 1;
        arena.rewind(ptr + actualAllocated);

        return new Slice(ptr, written);
    }

    public static read(ptr: number, length: number, memory: WasmMemory): string {
        if (ptr + length > memory.byteLength) {
            throw new Error(`String span [${ptr}, ${ptr + length}) exceeds memory byte length ${memory.byteLength}`);
        }
        const bytes = new Uint8Array(memory.buffer, ptr, length);
        return decoder.decode(bytes);
    }

    public static readNullTerminated(ptr: number, memory: WasmMemory, maxScanBytes: number = 4096): string {
        const memoryBytes = new Uint8Array(memory.buffer);
        const limit = Math.min(memory.byteLength, ptr + maxScanBytes);
        let end = ptr;

        while (end < limit && memoryBytes[end] !== 0) {
            end++;
        }

        const length = end - ptr;
        const bytes = new Uint8Array(memory.buffer, ptr, length);
        return decoder.decode(bytes);
    }
}
