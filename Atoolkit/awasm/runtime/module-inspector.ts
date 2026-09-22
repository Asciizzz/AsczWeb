// ================================================================
//  Awasm - Runtime: ModuleInspector
// ================================================================

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
 * Static binary inspector and validator for uninstantiated WebAssembly modules.
 * Extracts interface schemas, import dependencies, and export symbols synchronously.
 */
export class ModuleInspector {
    /**
     * Inspects module exports and imports without instantiating or executing guest code.
     */
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

    /**
     * Validates binary byte sequence against the WebAssembly specification.
     */
    public static validate(bytes: BufferSource): boolean {
        return WebAssembly.validate(bytes);
    }
}
