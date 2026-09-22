// ================================================================
//  Awasm - Runtime: HostBridge
// ================================================================

export interface HostEnvOptions {
    onAbort?: (message: string, file: string, line: number, column: number) => void;
    onLog?: (message: string) => void;
    nowProvider?: () => number;
}

/**
 * Host function import table builder.
 * Registers JavaScript functions and default environment hooks to link into WebAssembly modules.
 */
export class HostBridge {
    private readonly _imports: Record<string, Record<string, any>>;

    constructor() {
        this._imports = {};
    }

    /**
     * Registers a single host function under the specified module and export name.
     */
    public register(moduleName: string, exportName: string, fn: any): this {
        if (!this._imports[moduleName]) {
            this._imports[moduleName] = {};
        }
        this._imports[moduleName][exportName] = fn;
        return this;
    }

    /**
     * Registers a record of host functions under the specified module namespace.
     */
    public registerModule(moduleName: string, functions: Record<string, any>): this {
        if (!this._imports[moduleName]) {
            this._imports[moduleName] = {};
        }
        Object.assign(this._imports[moduleName], functions);
        return this;
    }

    /**
     * Injects standard default environment hooks: env.now, env.abort, and optional env.log.
     */
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

    /**
     * Compiles registered imports into the WebAssembly.Imports dictionary format.
     */
    public build(): WebAssembly.Imports {
        return this._imports as WebAssembly.Imports;
    }
}
