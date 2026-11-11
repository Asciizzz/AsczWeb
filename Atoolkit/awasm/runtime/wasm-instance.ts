// ================================================================
//  Awasm - Runtime: WasmInstance
// ================================================================

import { WasmMemory } from "../memory/wasm-memory.js";

export interface WasmInstantiateOptions {
	/** Explicit name of the exported `WebAssembly.Memory` if the module exports memory under a custom name. */
	memoryExportName?: string;
}

/**
 * Managed WebAssembly instance binding runtime exports and optional guest linear memory.
 *
 * Memory binding contract:
 * - If the guest module exports a `WebAssembly.Memory` (by default `"memory"` or `options.memoryExportName`),
 *   `instance.memory` wraps that exported memory.
 * - If the guest module imports a `WebAssembly.Memory`, `instance.memory` wraps the imported memory
 *   (supplied in `imports` or via `providedMemory`).
 * - If the guest module neither imports nor exports a `WebAssembly.Memory`, `instance.memory` is `null`.
 *   `WasmInstance` never fabricates an unrelated standalone `WasmMemory` when the guest has none.
 */
export class WasmInstance<TExports extends Record<string, any> = Record<string, any>> {
	readonly #module: WebAssembly.Module;
	readonly #instance: WebAssembly.Instance;
	readonly #memory: WasmMemory | null;
	readonly #exports: TExports;

	constructor(
		module: WebAssembly.Module,
		instance: WebAssembly.Instance,
		memory: WasmMemory | null = null
	) {
		this.#module = module;
		this.#instance = instance;
		this.#memory = memory;
		this.#exports = instance.exports as TExports;
	}

	/**
	 * Instantiates a compiled `WebAssembly.Module` and resolves its exported or imported linear memory.
	 */
	static async instantiate<T extends Record<string, any> = Record<string, any>>(
		module: WebAssembly.Module,
		imports?: WebAssembly.Imports,
		providedMemory?: WasmMemory,
		options?: WasmInstantiateOptions
	): Promise<WasmInstance<T>> {
		const moduleImports = WebAssembly.Module.imports(module);
		const memoryImportDesc = moduleImports.find((imp) => imp.kind === "memory");

		let resolvedImports = imports;
		let importedRawMemory: WebAssembly.Memory | undefined;

		if (memoryImportDesc) {
			const existingMod = imports?.[memoryImportDesc.module];
			const existingEntry = existingMod?.[memoryImportDesc.name];
			if (existingEntry instanceof WebAssembly.Memory) {
				importedRawMemory = existingEntry;
				if (providedMemory && providedMemory.handle !== existingEntry) {
					throw new Error(
						`WasmInstance.instantiate: providedMemory does not match the WebAssembly.Memory in imports.${memoryImportDesc.module}.${memoryImportDesc.name}.`
					);
				}
			} else if (providedMemory) {
				importedRawMemory = providedMemory.handle;
				resolvedImports = {
					...imports,
					[memoryImportDesc.module]: {
						...(imports?.[memoryImportDesc.module] ?? {}),
						[memoryImportDesc.name]: providedMemory.handle,
					},
				};
			}
		}

		const instance = await WebAssembly.instantiate(module, resolvedImports);
		const exportsObj = instance.exports as Record<string, unknown>;

		let exportedRawMemory: WebAssembly.Memory | undefined;
		if (options?.memoryExportName !== undefined) {
			const candidate = exportsObj[options.memoryExportName];
			if (!(candidate instanceof WebAssembly.Memory)) {
				throw new Error(
					`WasmInstance.instantiate: expected export '${options.memoryExportName}' to be a WebAssembly.Memory.`
				);
			}
			exportedRawMemory = candidate;
		} else if (exportsObj.memory instanceof WebAssembly.Memory) {
			exportedRawMemory = exportsObj.memory;
		} else {
			const memExports = Object.values(exportsObj).filter(
				(v): v is WebAssembly.Memory => v instanceof WebAssembly.Memory
			);
			if (memExports.length === 1) {
				exportedRawMemory = memExports[0];
			} else if (memExports.length > 1) {
				throw new Error(
					"WasmInstance.instantiate: module exports multiple WebAssembly.Memory instances; specify options.memoryExportName."
				);
			}
		}

		let finalMemory: WasmMemory | null = null;
		if (exportedRawMemory) {
			if (providedMemory) {
				if (providedMemory.handle !== exportedRawMemory) {
					throw new Error(
						"WasmInstance.instantiate: providedMemory does not match the module's exported WebAssembly.Memory."
					);
				}
				providedMemory.refresh();
				finalMemory = providedMemory;
			} else {
				finalMemory = WasmMemory.fromNative(exportedRawMemory);
			}
		} else if (importedRawMemory) {
			if (providedMemory) {
				providedMemory.refresh();
				finalMemory = providedMemory;
			} else {
				finalMemory = WasmMemory.fromNative(importedRawMemory);
			}
		} else if (providedMemory) {
			throw new Error(
				"WasmInstance.instantiate: providedMemory was supplied, but the guest module neither imports nor exports a WebAssembly.Memory."
			);
		}

		return new WasmInstance<T>(module, instance, finalMemory);
	}

	/**
	 * Invokes an exported guest function by name.
	 */
	call<TResult = number>(name: string, ...args: number[]): TResult {
		const fn = (this.#exports as Record<string, unknown>)[name];
		if (typeof fn !== "function") {
			throw new Error(`Exported function '${name}' not found on WebAssembly instance.`);
		}
		const result = (fn as (...a: number[]) => TResult)(...args);
		if (this.#memory) {
			this.#memory.refresh();
		}
		return result;
	}

	/**
	 * Returns the bound `WasmMemory`, or throws an Error if the guest module has no linear memory.
	 */
	requireMemory(): WasmMemory {
		if (!this.#memory) {
			throw new Error("WasmInstance: guest module has no bound WebAssembly.Memory.");
		}
		this.#memory.refresh();
		return this.#memory;
	}

	get exports(): TExports {
		return this.#exports;
	}

	get handle(): WebAssembly.Instance {
		return this.#instance;
	}

	get memory(): WasmMemory | null {
		if (this.#memory) {
			this.#memory.refresh();
		}
		return this.#memory;
	}

	get module(): WebAssembly.Module {
		return this.#module;
	}
}
