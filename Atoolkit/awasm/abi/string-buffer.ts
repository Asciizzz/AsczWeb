// ================================================================
//  Awasm - ABI: StringBuffer
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";
import { LinearArena } from "../memory/linear-arena.js";
import { Slice } from "./slice.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * UTF-8 string marshalling across host JavaScript and guest linear memory.
 * Uses singleton TextEncoder and TextDecoder instances to eliminate garbage collection.
 */
export class StringBuffer {
    /**
     * Encodes a JavaScript string directly into arena memory and appends a null terminator.
     * Rewinds unused allocated bytes and returns a Slice containing guest pointer and byte length.
     */
    public static write(text: string, arena: LinearArena, memory: WasmMemory): Slice {
        const maxBytes = text.length * 3 + 1;
        const ptr = arena.allocate(maxBytes, 1);

        const memoryBytes = new Uint8Array(memory.buffer, ptr, maxBytes);
        const result = encoder.encodeInto(text, memoryBytes);

        const written = result.written ?? 0;
        memoryBytes[written] = 0;

        const actualAllocated = written + 1;
        arena.rewind(ptr + actualAllocated);

        return new Slice(ptr, written);
    }

    /**
     * Decodes a UTF-8 guest memory byte span into a JavaScript string.
     */
    public static read(ptr: number, length: number, memory: WasmMemory): string {
        if (ptr + length > memory.byteLength) {
            throw new Error(`String span [${ptr}, ${ptr + length}) exceeds memory byte length ${memory.byteLength}`);
        }
        const bytes = new Uint8Array(memory.buffer, ptr, length);
        return decoder.decode(bytes);
    }

    /**
     * Scans for a null terminator in linear memory and decodes the resulting UTF-8 string.
     */
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
