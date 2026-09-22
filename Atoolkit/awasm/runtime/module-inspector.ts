export type WasmExportKind = "function" | "table" | "memory" | "global";
export type WasmImportKind = "function" | "table" | "memory" | "global";

export interface ModuleExportDescriptor {
    name: string;
    kind: WasmExportKind;
}

export interface ModuleImportDescriptor {
    module: string;
    name: string;
    kind: WasmImportKind;
}

export interface ModuleManifest {
    exports: ModuleExportDescriptor[];
    imports: ModuleImportDescriptor[];
    declaredMemory: boolean;
    requiredModules: string[];
}

/**
 * Static binary inspector and validator for WebAssembly modules.
 *
 * Class Responsibility:
 * Analyzes compiled WebAssembly modules without instantiating them.
 * Extracts interface schemas, import dependencies, and export symbols.
 *
 * Method Contracts:
 * - inspect(module: WebAssembly.Module): Extracts manifest of exports, imports, and memory.
 * - validate(bytes: BufferSource): Validates binary byte sequence against WebAssembly spec.
 *
 * Operational Invariants:
 * - Executes synchronously using native WebAssembly.Module static methods.
 * - Instantiation-free introspection: executes no guest start code and allocates no linear memory.
 */
export class ModuleInspector {
    public static inspect(module: WebAssembly.Module): ModuleManifest {
        const rawExports = WebAssembly.Module.exports(module);
        const rawImports = WebAssembly.Module.imports(module);

        const exports: ModuleExportDescriptor[] = rawExports.map((e) => ({
            name: e.name,
            kind: e.kind as WasmExportKind,
        }));

        const imports: ModuleImportDescriptor[] = rawImports.map((i) => ({
            module: i.module,
            name: i.name,
            kind: i.kind as WasmImportKind,
        }));

        const requiredModulesSet = new Set<string>();
        for (let i = 0; i < imports.length; i++) {
            requiredModulesSet.add(imports[i].module);
        }

        const declaredMemory = exports.some((e) => e.kind === "memory") || imports.some((i) => i.kind === "memory");

        return {
            exports,
            imports,
            declaredMemory,
            requiredModules: Array.from(requiredModulesSet),
        };
    }

    public static validate(bytes: BufferSource): boolean {
        return WebAssembly.validate(bytes);
    }
}
