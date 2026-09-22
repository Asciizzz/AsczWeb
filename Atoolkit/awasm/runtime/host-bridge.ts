export interface HostEnvOptions {
    onAbort?: (message: string, file: string, line: number, column: number) => void;
    onLog?: (message: string) => void;
    nowProvider?: () => number;
}

/**
 * Host function import table builder.
 *
 * Class Responsibility:
 * Registers JavaScript functions to be linked into WebAssembly modules.
 * Supplies default environment hooks for timing, abort/panic reporting, and diagnostics.
 *
 * Method Contracts:
 * - register(moduleName: string, exportName: string, fn: Function): Registers host function.
 * - registerDefaultEnv(options?: HostEnvOptions): Injects env.now, env.abort, and env.log.
 * - build(): Compiles internal dictionary into WebAssembly.Imports format.
 *
 * Operational Invariants:
 * - Direct function binding without intermediate wrapper allocations on hot paths.
 * - Supports nested namespace mapping matching WebAssembly import structures.
 */
export class HostBridge {
    private readonly _imports: Record<string, Record<string, any>>;

    constructor() {
        this._imports = {};
    }

    public register(moduleName: string, exportName: string, fn: any): this {
        if (!this._imports[moduleName]) {
            this._imports[moduleName] = {};
        }
        this._imports[moduleName][exportName] = fn;
        return this;
    }

    public registerModule(moduleName: string, functions: Record<string, any>): this {
        if (!this._imports[moduleName]) {
            this._imports[moduleName] = {};
        }
        Object.assign(this._imports[moduleName], functions);
        return this;
    }

    public registerDefaultEnv(options: HostEnvOptions = {}): this {
        const nowFn = options.nowProvider ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        const abortFn = options.onAbort ?? ((msg, file, line, col) => {
            throw new Error(`WebAssembly abort at ${file}:${line}:${col} - ${msg}`);
        });

        this.register("env", "now", nowFn);
        this.register("env", "abort", (msgPtr: number, filePtr: number, line: number, col: number) => {
            abortFn(String(msgPtr), String(filePtr), line, col);
        });

        if (options.onLog) {
            this.register("env", "log", options.onLog);
        }

        return this;
    }

    public build(): WebAssembly.Imports {
        return this._imports as WebAssembly.Imports;
    }
}
