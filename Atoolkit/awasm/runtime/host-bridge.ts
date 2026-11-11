// ================================================================
//  Awasm - Runtime: HostBridge
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";
import { StringBuffer } from "../abi/string-buffer.js";

export type MemoryProvider =
	| WasmMemory
	| WebAssembly.Memory
	| (() => WasmMemory | WebAssembly.Memory | null | undefined);

export interface HostEnvOptions {
	/**
	 * Guest linear memory (or lazy getter returning the guest memory after instantiation)
	 * used by UTF-8 string host imports (`env.log`, `env.log_utf8`, `env.abort_utf8`, `env.abort`).
	 */
	memory?: MemoryProvider;
	/**
	 * Callback invoked on guest abort (`env.abort_utf8` or `env.abort`).
	 */
	onAbort?: (message: string, file: string, line: number, column: number) => void;
	/**
	 * Callback invoked for UTF-8 guest log messages (`env.log(ptr, byteLen)` / `env.log_utf8(ptr, byteLen)`).
	 */
	onLog?: (message: string) => void;
	/**
	 * Callback invoked for numeric guest log values (`env.log_i32(val)`, `env.log_f64(val)`).
	 */
	onLogNumeric?: (value: number) => void;
	/**
	 * Monotonic timestamp provider for `env.now()`.
	 */
	nowProvider?: () => number;
}

/**
 * Host function import table builder with explicit UTF-8 guest memory decoding.
 *
 * String ABI contract:
 * - `env.log(ptr, byteLen)` and `env.log_utf8(ptr, byteLen)` decode `[ptr, ptr + byteLen)` as UTF-8
 *   from the bound `WasmMemory` and pass the decoded JS string to `options.onLog`.
 * - `env.abort_utf8(msgPtr, msgLen, filePtr, fileLen, line, col)` decodes UTF-8 message and file spans
 *   from the bound `WasmMemory`.
 * - `env.abort(msgPtr, filePtr, line, col)` decodes null-terminated UTF-8 strings at `msgPtr` and `filePtr`
 *   when memory is bound and pointers are non-zero, or formats raw pointer addresses (`ptr=0x...`) when
 *   no memory is bound.
 */
export class HostBridge {
	readonly #imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
	#boundMemory: WasmMemory | null = null;
	#memoryProvider?: MemoryProvider;

	constructor(memory?: MemoryProvider) {
		if (memory !== undefined) {
			this.#memoryProvider = memory;
		}
	}

	/**
	 * Binds or updates the guest `WasmMemory` used to decode UTF-8 pointer/length host calls.
	 */
	bindMemory(memory: WasmMemory | WebAssembly.Memory): this {
		this.#boundMemory =
			memory instanceof WasmMemory ? memory : WasmMemory.fromNative(memory);
		return this;
	}

	#resolveMemory(): WasmMemory | null {
		if (this.#boundMemory) {
			this.#boundMemory.refresh();
			return this.#boundMemory;
		}
		const prov = this.#memoryProvider;
		if (!prov) return null;
		const resolved = typeof prov === "function" ? prov() : prov;
		if (!resolved) return null;
		if (resolved instanceof WasmMemory) {
			resolved.refresh();
			return resolved;
		}
		if (resolved instanceof WebAssembly.Memory) {
			this.#boundMemory = WasmMemory.fromNative(resolved);
			return this.#boundMemory;
		}
		return null;
	}

	/**
	 * Registers a single host import value or function under `moduleName.exportName`.
	 */
	register(moduleName: string, exportName: string, fn: WebAssembly.ImportValue): this {
		if (!this.#imports[moduleName]) {
			this.#imports[moduleName] = {};
		}
		this.#imports[moduleName][exportName] = fn;
		return this;
	}

	/**
	 * Registers a map of host functions/values under `moduleName`.
	 */
	registerModule(
		moduleName: string,
		functions: Record<string, WebAssembly.ImportValue>
	): this {
		if (!this.#imports[moduleName]) {
			this.#imports[moduleName] = {};
		}
		Object.assign(this.#imports[moduleName], functions);
		return this;
	}

	/**
	 * Registers standard environment hooks under `env`:
	 * - `env.now()`: returns current timestamp in milliseconds.
	 * - `env.abort_utf8(msgPtr, msgLen, filePtr, fileLen, line, col)`: UTF-8 slice abort hook.
	 * - `env.abort(msgPtr, filePtr, line, col)`: null-terminated UTF-8 (or pointer-formatted) abort hook.
	 * - `env.log(ptr, byteLen)` / `env.log_utf8(ptr, byteLen)`: UTF-8 string logging hook (when `onLog` is provided).
	 * - `env.log_i32(val)` / `env.log_f64(val)`: numeric logging hooks (when `onLogNumeric` is provided).
	 */
	registerDefaultEnv(options: HostEnvOptions = {}): this {
		if (options.memory !== undefined) {
			this.#memoryProvider = options.memory;
		}

		const nowFn =
			options.nowProvider ??
			(() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

		const abortFn =
			options.onAbort ??
			((msg, file, line, col) => {
				throw new Error(`WebAssembly abort at ${file}:${line}:${col} - ${msg}`);
			});

		this.register("env", "now", nowFn);

		this.register(
			"env",
			"abort_utf8",
			(
				msgPtr: number,
				msgLen: number,
				filePtr: number,
				fileLen: number,
				line: number,
				col: number
			) => {
				const mem = this.#resolveMemory();
				if (!mem) {
					throw new Error(
						"HostBridge env.abort_utf8: guest WasmMemory is not bound; call bridge.bindMemory(memory) or pass options.memory."
					);
				}
				const message = StringBuffer.read(msgPtr >>> 0, msgLen >>> 0, mem);
				const file = StringBuffer.read(filePtr >>> 0, fileLen >>> 0, mem);
				abortFn(message, file, line, col);
			}
		);

		this.register(
			"env",
			"abort",
			(msgPtr: number, filePtr: number, line: number, col: number) => {
				const mem = this.#resolveMemory();
				const uMsgPtr = msgPtr >>> 0;
				const uFilePtr = filePtr >>> 0;
				let message = `ptr=0x${uMsgPtr.toString(16)}`;
				let file = `ptr=0x${uFilePtr.toString(16)}`;
				if (mem) {
					if (uMsgPtr > 0 && uMsgPtr < mem.byteLength) {
						try {
							message = StringBuffer.readNullTerminated(uMsgPtr, mem);
						} catch {
							// Keep formatted pointer fallback if null terminator is absent.
						}
					}
					if (uFilePtr > 0 && uFilePtr < mem.byteLength) {
						try {
							file = StringBuffer.readNullTerminated(uFilePtr, mem);
						} catch {
							// Keep formatted pointer fallback if null terminator is absent.
						}
					}
				}
				abortFn(message, file, line, col);
			}
		);

		if (options.onLog) {
			const onLog = options.onLog;
			const logUtf8 = (ptr: number, byteLen: number): void => {
				const mem = this.#resolveMemory();
				if (!mem) {
					throw new Error(
						"HostBridge env.log_utf8: guest WasmMemory is not bound; call bridge.bindMemory(memory) or pass options.memory."
					);
				}
				const decoded = StringBuffer.read(ptr >>> 0, byteLen >>> 0, mem);
				onLog(decoded);
			};
			this.register("env", "log_utf8", logUtf8);
			this.register("env", "log", logUtf8);
		}

		if (options.onLogNumeric) {
			const onLogNumeric = options.onLogNumeric;
			this.register("env", "log_i32", (val: number) => onLogNumeric(val | 0));
			this.register("env", "log_f64", (val: number) => onLogNumeric(+val));
		}

		return this;
	}

	/**
	 * Produces a shallow snapshot of registered imports formatted for `WebAssembly.instantiate`.
	 */
	build(): WebAssembly.Imports {
		const out: WebAssembly.Imports = {};
		for (const [mod, entries] of Object.entries(this.#imports)) {
			out[mod] = { ...entries };
		}
		return out;
	}
}
