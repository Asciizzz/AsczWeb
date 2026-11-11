// ================================================================
//  Awgpu - Level 2: Composable State (SwapBuffer, State Types)
// ================================================================

import type { Buffer, Texture } from "./memory.js";

export type BlendState = GPUBlendState;
export type DepthStencilState = GPUDepthStencilState;
export type RasterState = GPUPrimitiveState;

/**
 * Double-buffer state container for multi-pass compute iterations and feedback operations.
 * Provides O(1) handle swapping without GPU memory copying.
 */
export class SwapBuffer<T extends Buffer | Texture | GPUBuffer | GPUTexture> {
	#current: T;
	#next: T;

	constructor(initial: T, secondary: T) {
		this.#current = initial;
		this.#next = secondary;
	}

	/**
	 * Active state resource for reading.
	 */
	get read(): T {
		return this.#current;
	}

	/**
	 * Target state resource for writing.
	 */
	get write(): T {
		return this.#next;
	}

	/**
	 * Flips active read and write handles.
	 */
	swap(): void {
		const temp = this.#current;
		this.#current = this.#next;
		this.#next = temp;
	}

	/**
	 * Re-assigns internal buffers.
	 */
	set(initial: T, secondary: T): void {
		this.#current = initial;
		this.#next = secondary;
	}
}
