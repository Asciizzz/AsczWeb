// ================================================================
//  Awgpu - Level 2: Composable State (SwapBuffer)
// ================================================================

import type { Buffer, Texture } from "./memory.js";

/**
 * Double-buffer state container for multi-pass compute iterations and feedback operations.
 * Provides O(1) handle swapping without GPU memory copying.
 */
export class SwapBuffer<T extends Buffer | Texture | GPUBuffer | GPUTexture> {
    private _current: T;
    private _next: T;

    constructor(initial: T, secondary: T) {
        this._current = initial;
        this._next = secondary;
    }

    /**
     * Active state resource for reading.
     */
    get read(): T {
        return this._current;
    }

    /**
     * Target state resource for writing.
     */
    get write(): T {
        return this._next;
    }

    /**
     * Flips active read and write handles.
     */
    swap(): void {
        const temp = this._current;
        this._current = this._next;
        this._next = temp;
    }

    /**
     * Re-assigns internal buffers.
     */
    set(initial: T, secondary: T): void {
        this._current = initial;
        this._next = secondary;
    }
}
