export {
	ModuleInspector,
	type WasmExportKind,
	type WasmImportKind,
	type ModuleExportDescriptor,
	type ModuleImportDescriptor,
	type ModuleManifest,
} from "./module-inspector.js";
export {
	HostBridge,
	type HostEnvOptions,
	type MemoryProvider,
} from "./host-bridge.js";
export {
	ModuleLoader,
	type ModuleCacheOptions,
} from "./module-loader.js";
export {
	WasmInstance,
	type WasmInstantiateOptions,
} from "./wasm-instance.js";
