import { type Device, resolveDevice, getResourceId } from "./device.js";
import { Buffer, type BufferSlice, isBufferSlice, Texture, getRegisteredTextureViewOwner } from "./memory.js";
import { resolveTextureView, type TextureSourceRef } from "./stream.js";

/**
 * Optional semantic slot-frequency convention (0..3).
 * Raw numeric bind group indices (0, 1, 2, 3) can be used directly everywhere.
 */
export enum SlotFrequency {
	PerFrame = 0,
	PerPass = 1,
	PerBatch = 2,
	PerInstance = 3,
}

export type BindResource =
	| Buffer
	| BufferSlice
	| GPUBufferBinding
	| Texture
	| GPUTexture
	| GPUTextureView
	| GPUSampler
	| GPUExternalTexture;

export type ResourceBinding = BindResource;
export type BindingEntry = BindEntry;

export interface BindEntry {
	binding: number;
	resource: BindResource;
}

export class BindLayout {
	readonly native: GPUBindGroupLayout;
	readonly entries: readonly GPUBindGroupLayoutEntry[];
	readonly label?: string;

	constructor(
		device: Device | GPUDevice,
		entries: GPUBindGroupLayoutEntry[],
		label?: string
	) {
		const rawDevice = resolveDevice(device);
		const clonedEntries = entries.map((e) => ({ ...e }));
		this.entries = Object.freeze(clonedEntries);
		this.label = label;
		this.native = rawDevice.createBindGroupLayout({
			label,
			entries: clonedEntries,
		});
	}

	static builder(): BindLayoutBuilder {
		return new BindLayoutBuilder();
	}
}

export class BindLayoutBuilder {
	readonly #entries: GPUBindGroupLayoutEntry[] = [];

	addUniform(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: { hasDynamicOffset?: boolean; minBindingSize?: number }
	): this {
		this.#entries.push({
			binding,
			visibility,
			buffer: {
				type: "uniform",
				hasDynamicOffset: options?.hasDynamicOffset ?? false,
				minBindingSize: options?.minBindingSize,
			},
		});
		return this;
	}

	addStorage(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: { readOnly?: boolean; hasDynamicOffset?: boolean; minBindingSize?: number }
	): this {
		this.#entries.push({
			binding,
			visibility,
			buffer: {
				type: options?.readOnly ? "read-only-storage" : "storage",
				hasDynamicOffset: options?.hasDynamicOffset ?? false,
				minBindingSize: options?.minBindingSize,
			},
		});
		return this;
	}

	addTexture(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: {
			sampleType?: GPUTextureSampleType;
			viewDimension?: GPUTextureViewDimension;
			multisampled?: boolean;
		}
	): this {
		this.#entries.push({
			binding,
			visibility,
			texture: {
				sampleType: options?.sampleType ?? "float",
				viewDimension: options?.viewDimension ?? "2d",
				multisampled: options?.multisampled ?? false,
			},
		});
		return this;
	}

	addStorageTexture(
		binding: number,
		visibility: GPUShaderStageFlags,
		format: GPUTextureFormat,
		options?: {
			access?: GPUStorageTextureAccess;
			viewDimension?: GPUTextureViewDimension;
		}
	): this {
		this.#entries.push({
			binding,
			visibility,
			storageTexture: {
				access: options?.access ?? "write-only",
				format,
				viewDimension: options?.viewDimension ?? "2d",
			},
		});
		return this;
	}

	addSampler(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: {
			type?: GPUSamplerBindingType;
			comparison?: boolean;
		}
	): this {
		const type = options?.type ?? (options?.comparison ? "comparison" : "filtering");
		this.#entries.push({
			binding,
			visibility,
			sampler: { type },
		});
		return this;
	}

	build(device: Device | GPUDevice, label?: string): BindLayout {
		return new BindLayout(device, [...this.#entries], label);
	}

	uniform(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: { hasDynamicOffset?: boolean; minBindingSize?: number }
	): this {
		return this.addUniform(binding, visibility, options);
	}

	storage(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: { readOnly?: boolean; hasDynamicOffset?: boolean; minBindingSize?: number }
	): this {
		return this.addStorage(binding, visibility, options);
	}

	texture(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: {
			sampleType?: GPUTextureSampleType;
			viewDimension?: GPUTextureViewDimension;
			multisampled?: boolean;
		}
	): this {
		return this.addTexture(binding, visibility, options);
	}

	storageTexture(
		binding: number,
		visibility: GPUShaderStageFlags,
		format: GPUTextureFormat,
		options?: {
			access?: GPUStorageTextureAccess;
			viewDimension?: GPUTextureViewDimension;
		}
	): this {
		return this.addStorageTexture(binding, visibility, format, options);
	}

	sampler(
		binding: number,
		visibility: GPUShaderStageFlags,
		options?: {
			type?: GPUSamplerBindingType;
			comparison?: boolean;
		}
	): this {
		return this.addSampler(binding, visibility, options);
	}
}

export interface BindTableDescriptor {
	layout: BindLayout | GPUBindGroupLayout;
	entries: BindEntry[];
	/** Optional slot index or SlotFrequency hint associated with this wrapper. */
	slot?: SlotFrequency | number;
	label?: string;
	/** Explicit number of dynamic offset bindings if layout is a raw GPUBindGroupLayout. */
	dynamicOffsetCount?: number;
}

export function resolveBindingResource(res: BindResource): GPUBindingResource {
	return resolveNativeBindingResource(res);
}

export function hashBindingEntries(entries: BindEntry[]): string {
	const sorted = [...entries].sort((a, b) => a.binding - b.binding);
	return sorted
		.map((e) => `${e.binding}=${serializeBindResourceKey(e.resource).keyPart}`)
		.join(";");
}

function resolveNativeBindingResource(res: BindResource): GPUBindingResource {
	if (res instanceof Buffer) {
		return { buffer: res.native, offset: 0, size: res.size };
	}
	if (isBufferSlice(res)) {
		return {
			buffer: res.buffer.native,
			offset: res.offset,
			size: res.size,
		};
	}
	if (res instanceof Texture) {
		return res.view;
	}
	if (typeof res === "object" && res !== null && "createView" in res && typeof (res as GPUTexture).createView === "function") {
		return resolveTextureView(res as TextureSourceRef);
	}
	return res as GPUBindingResource;
}

/**
 * Wrapper around a WebGPU `GPUBindGroup`.
 */
export class BindTable {
	readonly native: GPUBindGroup;
	readonly layout: BindLayout | GPUBindGroupLayout;
	readonly slot?: SlotFrequency | number;
	readonly dynamicCount: number;
	readonly label?: string;

	private constructor(
		native: GPUBindGroup,
		layout: BindLayout | GPUBindGroupLayout,
		slot: SlotFrequency | number | undefined,
		dynamicCount: number,
		label?: string
	) {
		this.native = native;
		this.layout = layout;
		this.slot = slot;
		this.dynamicCount = dynamicCount;
		this.label = label;
	}

	static create(device: Device | GPUDevice, desc: BindTableDescriptor): BindTable {
		const rawDevice = resolveDevice(device);
		const rawLayout = desc.layout instanceof BindLayout ? desc.layout.native : desc.layout;

		let dynamicCount = desc.dynamicOffsetCount ?? 0;
		if (desc.layout instanceof BindLayout && desc.dynamicOffsetCount === undefined) {
			for (const entry of desc.layout.entries) {
				if (entry.buffer?.hasDynamicOffset) {
					dynamicCount++;
				}
			}
		}

		const gpuEntries: GPUBindGroupEntry[] = desc.entries.map((entry) => ({
			binding: entry.binding,
			resource: resolveNativeBindingResource(entry.resource),
		}));

		const native = rawDevice.createBindGroup({
			label: desc.label,
			layout: rawLayout,
			entries: gpuEntries,
		});

		return new BindTable(
			native,
			desc.layout,
			desc.slot,
			dynamicCount,
			desc.label
		);
	}
}

export interface BindTableCacheOptions {
	/** Maximum number of cached BindTables per device before LRU eviction. Defaults to 1024. */
	maxEntries?: number;
}

function serializeBindResourceKey(res: BindResource): { keyPart: string; trackedObjects: object[] } {
	if (res instanceof Buffer) {
		return {
			keyPart: `B:${getResourceId(res.native)}:0:${res.size}`,
			trackedObjects: [res, res.native],
		};
	}
	if (isBufferSlice(res)) {
		return {
			keyPart: `B:${getResourceId(res.buffer.native)}:${res.offset}:${res.size}`,
			trackedObjects: [res.buffer, res.buffer.native],
		};
	}
	if (res instanceof Texture) {
		const v = res.view;
		return {
			keyPart: `V:${getResourceId(v as unknown as object)}`,
			trackedObjects: [res, res.native, v as unknown as object],
		};
	}
	if (typeof res === "object" && res !== null && "buffer" in res && !("createView" in res)) {
		const bBinding = res as GPUBufferBinding;
		const offset = bBinding.offset ?? 0;
		const size = bBinding.size ?? (bBinding.buffer.size - offset);
		return {
			keyPart: `B:${getResourceId(bBinding.buffer)}:${offset}:${size}`,
			trackedObjects: [bBinding.buffer],
		};
	}
	if (typeof res === "object" && res !== null && "createView" in res && typeof (res as GPUTexture).createView === "function") {
		const view = resolveTextureView(res as GPUTexture);
		return {
			keyPart: `V:${getResourceId(view as unknown as object)}`,
			trackedObjects: [res as object, view as unknown as object],
		};
	}
	const obj = res as unknown as object;
	const ownerTex = getRegisteredTextureViewOwner(res as GPUTextureView);
	if (ownerTex !== undefined) {
		return {
			keyPart: `V:${getResourceId(obj)}`,
			trackedObjects: [obj, ownerTex as unknown as object],
		};
	}
	return {
		keyPart: `R:${getResourceId(obj)}`,
		trackedObjects: [obj],
	};
}

interface CachedBindTableEntry {
	readonly table: BindTable;
	readonly resources: Set<object>;
}

interface DeviceBindTableStore {
	readonly map: Map<string, CachedBindTableEntry>;
	readonly keysByResource: WeakMap<object, Set<string>>;
}

/**
 * Device-scoped `BindTable` cache with LRU capacity bounding and resource-targeted eviction.
 *
 * Ownership contract:
 * - Can be constructed bound to a single `GPUDevice` (`new BindTableCache(device, options)`)
 *   or unbound (`new BindTableCache(options)`), in which case entries are partitioned per `GPUDevice`.
 * - A `BindTable` created on one `GPUDevice` is never returned for another `GPUDevice`.
 * - `clear()` / `dispose()` evicts cached wrappers without destroying the borrowed `GPUDevice`.
 */
export class BindTableCache {
	readonly #boundDevice: GPUDevice | null = null;
	readonly #maxEntries: number;
	readonly #stores = new WeakMap<GPUDevice, DeviceBindTableStore>();
	readonly #knownDevices = new Set<GPUDevice>();

	constructor(
		deviceOrOptions?: Device | GPUDevice | BindTableCacheOptions,
		maybeOptions?: BindTableCacheOptions
	) {
		let opts: BindTableCacheOptions | undefined;
		if (
			deviceOrOptions &&
			typeof deviceOrOptions === "object" &&
			("native" in deviceOrOptions || "createBindGroup" in deviceOrOptions)
		) {
			this.#boundDevice = resolveDevice(deviceOrOptions as Device | GPUDevice);
			opts = maybeOptions;
		} else {
			opts = deviceOrOptions as BindTableCacheOptions | undefined;
		}
		const maxEntries = opts?.maxEntries ?? 1024;
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new RangeError(`BindTableCache: maxEntries must be a positive integer, got ${maxEntries}.`);
		}
		this.#maxEntries = maxEntries;
	}

	/** Bound native `GPUDevice` if constructed for a specific device, or null. */
	get device(): GPUDevice | null {
		return this.#boundDevice;
	}

	/** Maximum cached entries per device before LRU eviction. */
	get maxEntries(): number {
		return this.#maxEntries;
	}

	/** Total number of cached `BindTable` entries across active device stores. */
	get size(): number {
		let total = 0;
		for (const dev of this.#knownDevices) {
			const store = this.#stores.get(dev);
			if (store) {
				total += store.map.size;
			}
		}
		return total;
	}

	#getStore(deviceArg?: Device | GPUDevice): { rawDevice: GPUDevice; store: DeviceBindTableStore } {
		let rawDevice: GPUDevice;
		if (deviceArg !== undefined) {
			rawDevice = resolveDevice(deviceArg);
			if (this.#boundDevice !== null && this.#boundDevice !== rawDevice) {
				throw new Error("BindTableCache: device argument does not match the cache's bound GPUDevice.");
			}
		} else if (this.#boundDevice !== null) {
			rawDevice = this.#boundDevice;
		} else {
			throw new Error("BindTableCache: a GPUDevice must be provided.");
		}

		let store = this.#stores.get(rawDevice);
		if (!store) {
			store = {
				map: new Map<string, CachedBindTableEntry>(),
				keysByResource: new WeakMap<object, Set<string>>(),
			};
			this.#stores.set(rawDevice, store);
			this.#knownDevices.add(rawDevice);
		}
		return { rawDevice, store };
	}

	#removeEntry(store: DeviceBindTableStore, key: string): boolean {
		const entry = store.map.get(key);
		if (!entry) {
			return false;
		}
		store.map.delete(key);
		for (const obj of entry.resources) {
			const set = store.keysByResource.get(obj);
			if (set) {
				set.delete(key);
				if (set.size === 0) {
					store.keysByResource.delete(obj);
				}
			}
		}
		return true;
	}

	getOrCreate(
		device: Device | GPUDevice,
		layout: BindLayout | GPUBindGroupLayout,
		entries: BindEntry[],
		options?: { slot?: SlotFrequency | number; label?: string; dynamicOffsetCount?: number }
	): BindTable {
		const { rawDevice, store } = this.#getStore(device);
		const rawLayout = layout instanceof BindLayout ? layout.native : layout;
		const layoutId = getResourceId(rawLayout);

		let dynamicCount = options?.dynamicOffsetCount ?? 0;
		if (layout instanceof BindLayout && options?.dynamicOffsetCount === undefined) {
			for (const e of layout.entries) {
				if (e.buffer?.hasDynamicOffset) {
					dynamicCount++;
				}
			}
		}

		const sortedEntries = [...entries].sort((a, b) => a.binding - b.binding);
		const trackedResources = new Set<object>();
		const entryKeyParts: string[] = [];

		for (let i = 0; i < sortedEntries.length; i++) {
			const e = sortedEntries[i];
			const { keyPart, trackedObjects } = serializeBindResourceKey(e.resource);
			entryKeyParts.push(`${e.binding}=${keyPart}`);
			for (let j = 0; j < trackedObjects.length; j++) {
				trackedResources.add(trackedObjects[j]);
			}
		}

		const slotKey = options?.slot !== undefined ? String(options.slot) : "none";
		const key = `D:${getResourceId(rawDevice)}|L:${layoutId}|S:${slotKey}|DC:${dynamicCount}|${entryKeyParts.join(";")}`;

		const existing = store.map.get(key);
		if (existing !== undefined) {
			// Refresh LRU order
			store.map.delete(key);
			store.map.set(key, existing);
			return existing.table;
		}

		const table = BindTable.create(rawDevice, {
			layout,
			entries: sortedEntries,
			slot: options?.slot,
			label: options?.label,
			dynamicOffsetCount: dynamicCount,
		});

		if (store.map.size >= this.#maxEntries) {
			const oldestKey = store.map.keys().next().value;
			if (oldestKey !== undefined) {
				this.#removeEntry(store, oldestKey);
			}
		}

		store.map.set(key, { table, resources: trackedResources });
		for (const obj of trackedResources) {
			let set = store.keysByResource.get(obj);
			if (!set) {
				set = new Set<string>();
				store.keysByResource.set(obj, set);
			}
			set.add(key);
		}

		return table;
	}

	/** Evicts all cached `BindTable` entries that reference `res`. */
	evictResource(res: object): number {
		const targets: object[] = [res];
		if ((res instanceof Texture || res instanceof Buffer) && res.native !== (res as unknown as object)) {
			targets.push(res.native as unknown as object);
		}
		let evicted = 0;
		for (const dev of this.#knownDevices) {
			const store = this.#stores.get(dev);
			if (!store) continue;
			for (let i = 0; i < targets.length; i++) {
				const target = targets[i];
				const keys = store.keysByResource.get(target);
				if (keys) {
					const keysSnapshot = [...keys];
					for (let j = 0; j < keysSnapshot.length; j++) {
						if (this.#removeEntry(store, keysSnapshot[j])) {
							evicted++;
						}
					}
					store.keysByResource.delete(target);
				}
			}
		}
		return evicted;
	}

	/** Clears all cached `BindTable` entries without destroying any GPUDevice. */
	clear(): void {
		for (const dev of this.#knownDevices) {
			const store = this.#stores.get(dev);
			if (store) {
				store.map.clear();
			}
			this.#stores.delete(dev);
		}
		this.#knownDevices.clear();
	}

	/** Alias for `clear()`. */
	dispose(): void {
		this.clear();
	}
}
