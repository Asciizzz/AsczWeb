import { WasmMemory } from "../memory/wasm-memory.js";

/**
 * Managed WebAssembly instance binding runtime exports and linear memory.
 *
 * Class Responsibility:
 * Encapsulates native WebAssembly.Instance. Pairs exported functions with
 * associated linear memory and provides type-safe function invocations.
 *
 * Method Contracts:
 * - instantiate<T>(module: WebAssembly.Module, imports?: WebAssembly.Imports, memory?: WasmMemory): Instantiates instance.
 * - call<TResult>(name: string, ...args: number[]): Invokes exported function by name.
 * - get exports(): Accesses strongly typed exported functions and globals.
 * - get handle(): Returns native WebAssembly.Instance.
 * - get memory(): Returns associated WasmMemory coordinator.
 *
 * Operational Invariants:
 * - Dual-tier interoperability: exposes native handles alongside managed properties.
 * - Automatically discovers exported WebAssembly.Memory when not explicitly passed.
 */
export class WasmInstance<TExports extends Record<string, any> = Record<string, any>> {
    private readonly _module: WebAssembly.Module;
    private readonly _instance: WebAssembly.Instance;
    private readonly _memory: WasmMemory;
    private readonly _exports: TExports;

    constructor(module: WebAssembly.Module, instance: WebAssembly.Instance, memory: WasmMemory) {
        this._module = module;
        this._instance = instance;
        this._memory = memory;
        this._exports = instance.exports as TExports;
    }

    public static async instantiate<T extends Record<string, any> = Record<string, any>>(
        module: WebAssembly.Module,
        imports?: WebAssembly.Imports,
        providedMemory?: WasmMemory
    ): Promise<WasmInstance<T>> {
        const instance = await WebAssembly.instantiate(module, imports);

        let memory = providedMemory;
        if (!memory) {
            const rawMemory = (instance.exports as any).memory;
            if (rawMemory instanceof WebAssembly.Memory) {
                memory = WasmMemory.fromNative(rawMemory);
            } else {
                // Default fallback 1 page memory if module declares no memory
                memory = new WasmMemory({ initial: 1 });
            }
        }

        return new WasmInstance<T>(module, instance, memory);
    }

    public call<TResult = number>(name: string, ...args: number[]): TResult {
        const fn = (this._exports as any)[name];
        if (typeof fn !== "function") {
            throw new Error(`Exported function '${name}' not found on WebAssembly instance`);
        }
        return fn(...args);
    }

    public get exports(): TExports {
        return this._exports;
    }

    public get handle(): WebAssembly.Instance {
        return this._instance;
    }

    public get memory(): WasmMemory {
        return this._memory;
    }

    public get module(): WebAssembly.Module {
        return this._module;
    }
}
