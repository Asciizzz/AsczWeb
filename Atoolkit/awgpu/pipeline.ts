import { type Device, resolveDevice, getResourceId } from "./device.js";
import type { BindLayout } from "./binding.js";
import type { StreamSet } from "./stream.js";
import type { BlendState, DepthStencilState, RasterState } from "./state.js";

export interface ShaderStageConfig {
	code: string;
	entryPoint?: string;
	constants?: Record<string, number>;
}

export interface ColorTargetConfig {
	format: GPUTextureFormat;
	blend?: GPUBlendState | BlendState;
	writeMask?: GPUColorWriteFlags;
}

export interface ShaderDiagnosticMessage {
	type: GPUCompilationMessageType;
	message: string;
	lineNum: number;
	linePos: number;
	offset: number;
	length: number;
	stage: "vertex" | "fragment" | "compute";
}

export type ShaderDiagnosticCallback = (msg: ShaderDiagnosticMessage) => void;
export type ShaderMessage = ShaderDiagnosticMessage;
export type RasterPipelineDesc = RasterPipelineDescriptor;
export type ComputePipelineDesc = ComputePipelineDescriptor;

export interface RasterPipelineDescriptor {
	label?: string;
	layouts?: (BindLayout | GPUBindGroupLayout | null | undefined)[];
	vertex: ShaderStageConfig & {
		buffers?: GPUVertexBufferLayout[];
	};
	fragment?: ShaderStageConfig & {
		targets: ColorTargetConfig[];
	};
	/**
	 * Optional StreamSet from which vertex buffer layouts are derived.
	 * Mutually exclusive with `vertex.buffers`; specifying both throws an Error.
	 */
	streamSet?: StreamSet;
	primitive?: RasterState | GPUPrimitiveState;
	depthStencil?: DepthStencilState | GPUDepthStencilState;
	multisample?: GPUMultisampleState;
	/**
	 * Optional callback invoked with shader compilation messages when the pipeline is compiled.
	 * Note: on a synchronous or asynchronous cache hit, compilation is not re-executed.
	 */
	onShaderMessage?: ShaderDiagnosticCallback;
}

export interface ComputePipelineDescriptor {
	label?: string;
	layouts?: (BindLayout | GPUBindGroupLayout | null | undefined)[];
	compute: ShaderStageConfig;
	onShaderMessage?: ShaderDiagnosticCallback;
}

async function inspectShaderModule(
	module: GPUShaderModule,
	stage: "vertex" | "fragment" | "compute",
	callback?: ShaderDiagnosticCallback
): Promise<void> {
	if (!callback || typeof module.getCompilationInfo !== "function") return;
	try {
		const info = await module.getCompilationInfo();
		for (const msg of info.messages) {
			callback({
				type: msg.type,
				message: msg.message,
				lineNum: msg.lineNum,
				linePos: msg.linePos,
				offset: msg.offset,
				length: msg.length,
				stage,
			});
		}
	} catch {
		// Ignore environments that do not implement getCompilationInfo.
	}
}

function serializeConstants(constants?: Record<string, number>): string {
	if (!constants) return "";
	const keys = Object.keys(constants).sort();
	if (keys.length === 0) return "";
	const parts: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i];
		parts.push(`${JSON.stringify(k)}:${constants[k]}`);
	}
	return parts.join(",");
}

function resolveVertexBufferLayouts(desc: RasterPipelineDescriptor): GPUVertexBufferLayout[] {
	if (desc.streamSet !== undefined && desc.vertex.buffers !== undefined) {
		throw new Error(
			"RasterPipeline: 'streamSet' and 'vertex.buffers' are mutually exclusive; specify only one."
		);
	}
	if (desc.streamSet !== undefined) {
		return desc.streamSet.deriveVertexLayouts();
	}
	return desc.vertex.buffers ? [...desc.vertex.buffers] : [];
}

function serializeVertexBufferLayouts(buffers: GPUVertexBufferLayout[]): string {
	const parts: string[] = [];
	for (let i = 0; i < buffers.length; i++) {
		const b = buffers[i];
		if (!b) {
			parts.push("null");
			continue;
		}
		const attrs = Array.from(b.attributes).map(
			(a) => `${a.shaderLocation}@${a.offset}:${a.format}`
		);
		parts.push(`${b.arrayStride}:${b.stepMode ?? "vertex"}:[${attrs.join(",")}]`);
	}
	return parts.join(";");
}

function serializeBlendComponent(c?: GPUBlendComponent): string {
	if (!c) return "default";
	return `${c.operation ?? "add"}:${c.srcFactor ?? "one"}:${c.dstFactor ?? "zero"}`;
}

function serializeTargets(targets: ColorTargetConfig[]): string {
	return targets
		.map((t) => {
			const blendStr = t.blend
				? `${serializeBlendComponent(t.blend.color)}/${serializeBlendComponent(t.blend.alpha)}`
				: "none";
			return `${t.format}:${t.writeMask ?? 0xf}:${blendStr}`;
		})
		.join(";");
}

function serializeStencilFace(s?: GPUStencilFaceState): string {
	if (!s) return "default";
	return `${s.compare ?? "always"}:${s.failOp ?? "keep"}:${s.depthFailOp ?? "keep"}:${s.passOp ?? "keep"}`;
}

function serializeDepthStencil(ds?: DepthStencilState | GPUDepthStencilState): string {
	if (!ds) return "none";
	return [
		ds.format,
		ds.depthWriteEnabled ?? false,
		ds.depthCompare ?? "always",
		serializeStencilFace(ds.stencilFront),
		serializeStencilFace(ds.stencilBack),
		ds.stencilReadMask ?? 0xffffffff,
		ds.stencilWriteMask ?? 0xffffffff,
		ds.depthBias ?? 0,
		ds.depthBiasSlopeScale ?? 0,
		ds.depthBiasClamp ?? 0,
	].join(":");
}

function serializePrimitive(p?: RasterState | GPUPrimitiveState): string {
	const topology = p?.topology ?? "triangle-list";
	const strip = p?.stripIndexFormat ?? "none";
	const frontFace = p?.frontFace ?? "ccw";
	const cullMode = p?.cullMode ?? "none";
	const unclipped = (p as GPUPrimitiveState | undefined)?.unclippedDepth ?? false;
	return `${topology}:${strip}:${frontFace}:${cullMode}:${unclipped}`;
}

function serializeMultisample(ms?: GPUMultisampleState): string {
	return `${ms?.count ?? 1}:${ms?.mask ?? 0xffffffff}:${ms?.alphaToCoverageEnabled ?? false}`;
}

function serializeLayouts(layouts?: (BindLayout | GPUBindGroupLayout | null | undefined)[]): string {
	if (!layouts || layouts.length === 0) return "auto";
	return layouts
		.map((l) => {
			if (!l) return "null";
			const raw = "native" in l ? l.native : l;
			return String(getResourceId(raw));
		})
		.join(",");
}

/**
 * Normalizes a `RasterPipelineDescriptor` and produces its canonical cache key for `rawDevice`.
 */
export function normalizeRasterDescriptor(
	rawDevice: GPUDevice,
	desc: RasterPipelineDescriptor
): { vertexBuffers: GPUVertexBufferLayout[]; key: string } {
	const vertexBuffers = resolveVertexBufferLayouts(desc);
	const vsEntry = desc.vertex.entryPoint ?? "vs_main";
	const vsConsts = serializeConstants(desc.vertex.constants);
	const vbKey = serializeVertexBufferLayouts(vertexBuffers);

	const fsKey = desc.fragment
		? [
				JSON.stringify(desc.fragment.code),
				desc.fragment.entryPoint ?? "fs_main",
				serializeConstants(desc.fragment.constants),
				serializeTargets(desc.fragment.targets),
			].join("|")
		: "no-fragment";

	const key = [
		`D:${getResourceId(rawDevice)}`,
		`L:${serializeLayouts(desc.layouts)}`,
		`VS:${JSON.stringify(desc.vertex.code)}|${vsEntry}|${vsConsts}`,
		`VB:${vbKey}`,
		`FS:${fsKey}`,
		`P:${serializePrimitive(desc.primitive)}`,
		`DS:${serializeDepthStencil(desc.depthStencil)}`,
		`MS:${serializeMultisample(desc.multisample)}`,
	].join("||");

	return { vertexBuffers, key };
}

/**
 * Normalizes a `ComputePipelineDescriptor` and produces its canonical cache key for `rawDevice`.
 */
export function normalizeComputeDescriptor(
	rawDevice: GPUDevice,
	desc: ComputePipelineDescriptor
): { key: string } {
	const entry = desc.compute.entryPoint ?? "cs_main";
	const consts = serializeConstants(desc.compute.constants);
	const key = [
		`D:${getResourceId(rawDevice)}`,
		`L:${serializeLayouts(desc.layouts)}`,
		`CS:${JSON.stringify(desc.compute.code)}|${entry}|${consts}`,
	].join("||");
	return { key };
}

/**
 * Wrapper around a WebGPU `GPURenderPipeline`.
 */
export class RasterPipeline {
	readonly native: GPURenderPipeline;
	readonly label?: string;

	private constructor(native: GPURenderPipeline, label?: string) {
		this.native = native;
		this.label = label;
	}

	private static _buildDescriptor(
		rawDevice: GPUDevice,
		desc: RasterPipelineDescriptor,
		vertexBuffers: GPUVertexBufferLayout[]
	): GPURenderPipelineDescriptor {
		let pipelineLayout: GPUPipelineLayout | "auto" = "auto";
		if (desc.layouts && desc.layouts.length > 0) {
			const bindGroupLayouts = desc.layouts.map((l) => (l ? ("native" in l ? l.native : l) : null));
			pipelineLayout = rawDevice.createPipelineLayout({
				label: desc.label ? `${desc.label}_Layout` : undefined,
				bindGroupLayouts,
			});
		}

		const vertexModule = rawDevice.createShaderModule({
			label: desc.label ? `${desc.label}_VS` : undefined,
			code: desc.vertex.code,
		});
		if (desc.onShaderMessage) {
			inspectShaderModule(vertexModule, "vertex", desc.onShaderMessage);
		}

		let fragmentState: GPUFragmentState | undefined;
		if (desc.fragment) {
			const isSameCode = desc.fragment.code === desc.vertex.code;
			const fragmentModule = isSameCode
				? vertexModule
				: rawDevice.createShaderModule({
						label: desc.label ? `${desc.label}_FS` : undefined,
						code: desc.fragment.code,
					});

			if (!isSameCode && desc.onShaderMessage) {
				inspectShaderModule(fragmentModule, "fragment", desc.onShaderMessage);
			}

			fragmentState = {
				module: fragmentModule,
				entryPoint: desc.fragment.entryPoint ?? "fs_main",
				constants: desc.fragment.constants,
				targets: desc.fragment.targets.map((t) => ({
					format: t.format,
					blend: t.blend,
					writeMask: t.writeMask ?? 0xf,
				})),
			};
		}

		return {
			label: desc.label,
			layout: pipelineLayout,
			vertex: {
				module: vertexModule,
				entryPoint: desc.vertex.entryPoint ?? "vs_main",
				constants: desc.vertex.constants,
				buffers: vertexBuffers,
			},
			fragment: fragmentState,
			primitive: desc.primitive ?? {
				topology: "triangle-list",
				cullMode: "back",
				frontFace: "ccw",
			},
			depthStencil: desc.depthStencil,
			multisample: desc.multisample ?? { count: 1 },
		};
	}

	static create(device: Device | GPUDevice, desc: RasterPipelineDescriptor): RasterPipeline {
		const rawDevice = resolveDevice(device);
		const vertexBuffers = resolveVertexBufferLayouts(desc);
		const gpuDesc = RasterPipeline._buildDescriptor(rawDevice, desc, vertexBuffers);
		const native = rawDevice.createRenderPipeline(gpuDesc);
		return new RasterPipeline(native, desc.label);
	}

	static async createAsync(
		device: Device | GPUDevice,
		desc: RasterPipelineDescriptor
	): Promise<RasterPipeline> {
		const rawDevice = resolveDevice(device);
		const vertexBuffers = resolveVertexBufferLayouts(desc);
		const gpuDesc = RasterPipeline._buildDescriptor(rawDevice, desc, vertexBuffers);
		const native = await rawDevice.createRenderPipelineAsync(gpuDesc);
		return new RasterPipeline(native, desc.label);
	}

	getBindGroupLayout(index: number): GPUBindGroupLayout {
		return this.native.getBindGroupLayout(index);
	}
}

/**
 * Wrapper around a WebGPU `GPUComputePipeline`.
 */
export class ComputePipeline {
	readonly native: GPUComputePipeline;
	readonly label?: string;

	private constructor(native: GPUComputePipeline, label?: string) {
		this.native = native;
		this.label = label;
	}

	private static _buildDescriptor(
		rawDevice: GPUDevice,
		desc: ComputePipelineDescriptor
	): GPUComputePipelineDescriptor {
		let pipelineLayout: GPUPipelineLayout | "auto" = "auto";
		if (desc.layouts && desc.layouts.length > 0) {
			const bindGroupLayouts = desc.layouts.map((l) => (l ? ("native" in l ? l.native : l) : null));
			pipelineLayout = rawDevice.createPipelineLayout({
				label: desc.label ? `${desc.label}_Layout` : undefined,
				bindGroupLayouts,
			});
		}

		const computeModule = rawDevice.createShaderModule({
			label: desc.label ? `${desc.label}_CS` : undefined,
			code: desc.compute.code,
		});
		if (desc.onShaderMessage) {
			inspectShaderModule(computeModule, "compute", desc.onShaderMessage);
		}

		return {
			label: desc.label,
			layout: pipelineLayout,
			compute: {
				module: computeModule,
				entryPoint: desc.compute.entryPoint ?? "cs_main",
				constants: desc.compute.constants,
			},
		};
	}

	static create(device: Device | GPUDevice, desc: ComputePipelineDescriptor): ComputePipeline {
		const rawDevice = resolveDevice(device);
		const gpuDesc = ComputePipeline._buildDescriptor(rawDevice, desc);
		const native = rawDevice.createComputePipeline(gpuDesc);
		return new ComputePipeline(native, desc.label);
	}

	static async createAsync(
		device: Device | GPUDevice,
		desc: ComputePipelineDescriptor
	): Promise<ComputePipeline> {
		const rawDevice = resolveDevice(device);
		const gpuDesc = ComputePipeline._buildDescriptor(rawDevice, desc);
		const native = await rawDevice.createComputePipelineAsync(gpuDesc);
		return new ComputePipeline(native, desc.label);
	}

	getBindGroupLayout(index: number): GPUBindGroupLayout {
		return this.native.getBindGroupLayout(index);
	}
}

interface DevicePipelineStore {
	readonly raster: Map<string, RasterPipeline>;
	readonly compute: Map<string, ComputePipeline>;
	readonly rasterInFlight: Map<string, Promise<RasterPipeline>>;
	readonly computeInFlight: Map<string, Promise<ComputePipeline>>;
}

/**
 * Device-scoped `RasterPipeline` and `ComputePipeline` cache with normalized descriptor keys,
 * in-flight async compilation deduplication, and generation-safe clearing.
 *
 * Ownership contract:
 * - Can be constructed bound to a single `GPUDevice` (`new PipelineCache(device)`) or unbound
 *   (`new PipelineCache()`), in which case entries are partitioned per `GPUDevice`.
 * - A pipeline created on one `GPUDevice` is never returned for another `GPUDevice`.
 * - Concurrent `getOrCreateRasterAsync` / `getOrCreateComputeAsync` calls for an identical normalized
 *   descriptor share one in-flight compilation promise. Failed compilations are evicted so retries work.
 * - `clear()` / `dispose()` increments the cache generation so in-flight compilations started prior to
 *   `clear()` cannot repopulate the cache after completion.
 */
export class PipelineCache {
	readonly #boundDevice: GPUDevice | null = null;
	readonly #stores = new WeakMap<GPUDevice, DevicePipelineStore>();
	readonly #knownDevices = new Set<GPUDevice>();
	#generation = 0;

	constructor(device?: Device | GPUDevice) {
		if (device !== undefined) {
			this.#boundDevice = resolveDevice(device);
		}
	}

	/** Bound native `GPUDevice` if constructed for a specific device, or null. */
	get device(): GPUDevice | null {
		return this.#boundDevice;
	}

	/** Total number of resolved raster pipelines currently cached. */
	get rasterCount(): number {
		let total = 0;
		for (const dev of this.#knownDevices) {
			const s = this.#stores.get(dev);
			if (s) total += s.raster.size;
		}
		return total;
	}

	/** Total number of resolved compute pipelines currently cached. */
	get computeCount(): number {
		let total = 0;
		for (const dev of this.#knownDevices) {
			const s = this.#stores.get(dev);
			if (s) total += s.compute.size;
		}
		return total;
	}

	#getStore(device: Device | GPUDevice): { rawDevice: GPUDevice; store: DevicePipelineStore } {
		const rawDevice = resolveDevice(device);
		if (this.#boundDevice !== null && this.#boundDevice !== rawDevice) {
			throw new Error("PipelineCache: device argument does not match the cache's bound GPUDevice.");
		}
		let store = this.#stores.get(rawDevice);
		if (!store) {
			store = {
				raster: new Map<string, RasterPipeline>(),
				compute: new Map<string, ComputePipeline>(),
				rasterInFlight: new Map<string, Promise<RasterPipeline>>(),
				computeInFlight: new Map<string, Promise<ComputePipeline>>(),
			};
			this.#stores.set(rawDevice, store);
			this.#knownDevices.add(rawDevice);
		}
		return { rawDevice, store };
	}

	getOrCreateRaster(device: Device | GPUDevice, desc: RasterPipelineDescriptor): RasterPipeline {
		const { rawDevice, store } = this.#getStore(device);
		const { key } = normalizeRasterDescriptor(rawDevice, desc);

		const existing = store.raster.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const pipeline = RasterPipeline.create(rawDevice, desc);
		store.raster.set(key, pipeline);
		return pipeline;
	}

	getOrCreateRasterAsync(
		device: Device | GPUDevice,
		desc: RasterPipelineDescriptor
	): Promise<RasterPipeline> {
		let rawDevice: GPUDevice;
		let store: DevicePipelineStore;
		let key: string;
		try {
			({ rawDevice, store } = this.#getStore(device));
			({ key } = normalizeRasterDescriptor(rawDevice, desc));
		} catch (err) {
			return Promise.reject(err);
		}

		const existing = store.raster.get(key);
		if (existing !== undefined) {
			return Promise.resolve(existing);
		}

		const inFlight = store.rasterInFlight.get(key);
		if (inFlight !== undefined) {
			return inFlight;
		}

		const startGen = this.#generation;
		const promise = RasterPipeline.createAsync(rawDevice, desc).then(
			(pipeline) => {
				store.rasterInFlight.delete(key);
				if (this.#generation === startGen && this.#stores.get(rawDevice) === store) {
					store.raster.set(key, pipeline);
				}
				return pipeline;
			},
			(err) => {
				store.rasterInFlight.delete(key);
				throw err;
			}
		);

		store.rasterInFlight.set(key, promise);
		return promise;
	}

	getOrCreateCompute(device: Device | GPUDevice, desc: ComputePipelineDescriptor): ComputePipeline {
		const { rawDevice, store } = this.#getStore(device);
		const { key } = normalizeComputeDescriptor(rawDevice, desc);

		const existing = store.compute.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const pipeline = ComputePipeline.create(rawDevice, desc);
		store.compute.set(key, pipeline);
		return pipeline;
	}

	getOrCreateComputeAsync(
		device: Device | GPUDevice,
		desc: ComputePipelineDescriptor
	): Promise<ComputePipeline> {
		let rawDevice: GPUDevice;
		let store: DevicePipelineStore;
		let key: string;
		try {
			({ rawDevice, store } = this.#getStore(device));
			({ key } = normalizeComputeDescriptor(rawDevice, desc));
		} catch (err) {
			return Promise.reject(err);
		}

		const existing = store.compute.get(key);
		if (existing !== undefined) {
			return Promise.resolve(existing);
		}

		const inFlight = store.computeInFlight.get(key);
		if (inFlight !== undefined) {
			return inFlight;
		}

		const startGen = this.#generation;
		const promise = ComputePipeline.createAsync(rawDevice, desc).then(
			(pipeline) => {
				store.computeInFlight.delete(key);
				if (this.#generation === startGen && this.#stores.get(rawDevice) === store) {
					store.compute.set(key, pipeline);
				}
				return pipeline;
			},
			(err) => {
				store.computeInFlight.delete(key);
				throw err;
			}
		);

		store.computeInFlight.set(key, promise);
		return promise;
	}

	/**
	 * Clears all cached pipelines and invalidates any in-flight asynchronous compilations
	 * so they cannot repopulate the cache upon completion. Does not destroy the borrowed GPUDevice.
	 */
	clear(): void {
		this.#generation++;
		for (const dev of this.#knownDevices) {
			const store = this.#stores.get(dev);
			if (store) {
				store.raster.clear();
				store.compute.clear();
			}
			this.#stores.delete(dev);
		}
		this.#knownDevices.clear();
	}

	/** Alias for `clear()`. */
	dispose(): void {
		this.clear();
	}

	/** Alias for `getOrCreateRaster`. */
	getRaster(device: Device | GPUDevice, desc: RasterPipelineDescriptor): RasterPipeline {
		return this.getOrCreateRaster(device, desc);
	}

	/** Alias for `getOrCreateRasterAsync`. */
	getRasterAsync(device: Device | GPUDevice, desc: RasterPipelineDescriptor): Promise<RasterPipeline> {
		return this.getOrCreateRasterAsync(device, desc);
	}

	/** Alias for `getOrCreateCompute`. */
	getCompute(device: Device | GPUDevice, desc: ComputePipelineDescriptor): ComputePipeline {
		return this.getOrCreateCompute(device, desc);
	}

	/** Alias for `getOrCreateComputeAsync`. */
	getComputeAsync(device: Device | GPUDevice, desc: ComputePipelineDescriptor): Promise<ComputePipeline> {
		return this.getOrCreateComputeAsync(device, desc);
	}
}
