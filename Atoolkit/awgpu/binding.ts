// ================================================================
//  Awgpu - Level 3: Resource Binding System (BindLayout, BindTable)
// ================================================================

import { type Device, resolveDevice } from "./device.js";
import { type Buffer, type Texture, type Sampler, type BufferSlice, resolveTextureView } from "./memory.js";

/**
 * Standardized 4-tier WebGPU update frequency slots.
 */
export enum SlotFrequency {
    PerFrame = 0,     // ViewProj, Viewport, Time, Globals
    PerPhase = 1,     // Environment maps, shadow atlases, phase buffers
    PerBatch = 2,     // Surface properties, data textures, samplers, storage buffers
    PerInstance = 3,  // Per-draw dynamic transforms, bone matrices
}

export type ResourceBinding =
    | GPUBufferBinding
    | GPUTextureView
    | GPUSampler
    | Buffer
    | Texture
    | Sampler
    | BufferSlice
    | GPUBuffer
    | GPUTexture;

/**
 * Resolves a high-level or raw resource into a native GPUBindingResource descriptor.
 */
export function resolveBindingResource(res: ResourceBinding): GPUBindingResource {
    if ("byteOffset" in res) {
        // BufferSlice
        const rawBuf = "native" in res.buffer ? res.buffer.native : res.buffer;
        return {
            buffer: rawBuf,
            offset: res.byteOffset,
            size: res.byteLength,
        };
    }
    if ("native" in res) {
        // Buffer, Sampler, or Texture wrapper
        if ("view" in res) {
            return (res as Texture).view;
        }
        if ("usage" in res) {
            return { buffer: (res as Buffer).native };
        }
        return (res as Sampler).native;
    }
    if ("createView" in res) {
        // Raw GPUTexture: resolve via cached default view
        return resolveTextureView(res as GPUTexture);
    }
    if ("size" in res && "usage" in res) {
        // Raw GPUBuffer
        return { buffer: res as GPUBuffer };
    }
    return res as GPUBindingResource;
}

/**
 * Fluent builder for creating GPUBindGroupLayout descriptors.
 */
export class BindLayout {
    readonly native: GPUBindGroupLayout;
    readonly label: string;

    constructor(native: GPUBindGroupLayout, label = "BindLayout") {
        this.native = native;
        this.label = label;
    }

    /**
     * Builder factory for fluent layout construction.
     */
    static builder(): BindLayoutBuilder {
        return new BindLayoutBuilder();
    }

    /**
     * Creates BindLayout from raw GPUBindGroupLayoutEntry array.
     */
    static create(
        device: Device | GPUDevice,
        entries: GPUBindGroupLayoutEntry[],
        label = "BindLayout"
    ): BindLayout {
        const gpu = resolveDevice(device);
        const native = gpu.createBindGroupLayout({ label, entries });
        return new BindLayout(native, label);
    }
}

export class BindLayoutBuilder {
    private entries: GPUBindGroupLayoutEntry[] = [];

    addUniform(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        options: { hasDynamicOffset?: boolean; minBindingSize?: number } = {}
    ): this {
        this.entries.push({
            binding,
            visibility,
            buffer: {
                type: "uniform",
                hasDynamicOffset: options.hasDynamicOffset ?? false,
                minBindingSize: options.minBindingSize,
            },
        });
        return this;
    }

    addStorage(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        options: { readOnly?: boolean; hasDynamicOffset?: boolean; minBindingSize?: number } = {}
    ): this {
        const type: GPUBufferBindingType = (options.readOnly ?? true) ? "read-only-storage" : "storage";
        this.entries.push({
            binding,
            visibility,
            buffer: {
                type,
                hasDynamicOffset: options.hasDynamicOffset ?? false,
                minBindingSize: options.minBindingSize,
            },
        });
        return this;
    }

    addTexture(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT,
        options: {
            sampleType?: GPUTextureSampleType;
            viewDimension?: GPUTextureViewDimension;
            multisampled?: boolean;
        } = {}
    ): this {
        this.entries.push({
            binding,
            visibility,
            texture: {
                sampleType: options.sampleType ?? "float",
                viewDimension: options.viewDimension ?? "2d",
                multisampled: options.multisampled ?? false,
            },
        });
        return this;
    }

    addStorageTexture(
        binding: number,
        format: GPUTextureFormat,
        visibility: GPUShaderStageFlags = GPUShaderStage.COMPUTE,
        options: {
            access?: GPUStorageTextureAccess;
            viewDimension?: GPUTextureViewDimension;
        } = {}
    ): this {
        this.entries.push({
            binding,
            visibility,
            storageTexture: {
                access: options.access ?? "write-only",
                format,
                viewDimension: options.viewDimension ?? "2d",
            },
        });
        return this;
    }

    addSampler(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT,
        options: { comparison?: boolean } = {}
    ): this {
        this.entries.push({
            binding,
            visibility,
            sampler: {
                type: options.comparison ? "comparison" : "filtering",
            },
        });
        return this;
    }

    build(device: Device | GPUDevice, label = "BindLayout"): BindLayout {
        return BindLayout.create(device, this.entries, label);
    }
}

export interface BindingEntry {
    binding: number;
    resource: ResourceBinding;
}

/**
 * GPU bind group wrapper tracking slot index and native GPUBindGroup.
 */
export class BindTable {
    readonly native: GPUBindGroup;
    readonly layout: GPUBindGroupLayout;
    readonly slot: number;
    readonly label: string;

    constructor(
        native: GPUBindGroup,
        layout: GPUBindGroupLayout,
        slot: number = SlotFrequency.PerFrame,
        label = "BindTable"
    ) {
        this.native = native;
        this.layout = layout;
        this.slot = slot;
        this.label = label;
    }

    /**
     * Factory: Instantiates GPUBindGroup with automated resource resolution.
     */
    static create(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options: { slot?: number; label?: string } = {}
    ): BindTable {
        const gpu = resolveDevice(device);
        const rawLayout = "native" in layout ? layout.native : layout;
        const slot = options.slot ?? SlotFrequency.PerFrame;
        const label = options.label ?? "BindTable";

        const resolvedEntries: GPUBindGroupEntry[] = new Array(entries.length);
        for (let i = 0; i < entries.length; i++) {
            resolvedEntries[i] = {
                binding: entries[i].binding,
                resource: resolveBindingResource(entries[i].resource),
            };
        }

        const native = gpu.createBindGroup({
            label,
            layout: rawLayout,
            entries: resolvedEntries,
        });

        return new BindTable(native, rawLayout, slot, label);
    }

    private static _defaultCache?: BindTableCache;

    /**
     * Retrieves existing cached BindTable or creates new instance if not present.
     */
    static getOrCreate(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options: { slot?: number; label?: string } = {}
    ): BindTable {
        if (!BindTable._defaultCache) {
            BindTable._defaultCache = new BindTableCache();
        }
        return BindTable._defaultCache.getOrCreate(device, layout, entries, options);
    }

    /**
     * Clears default BindTable deduplication cache.
     */
    static clearCache(): void {
        BindTable._defaultCache?.clear();
    }
}

let _nextBindResourceId = 1;
const _bindResourceIdMap = new WeakMap<object, number>();

function getResourceId(obj: object): number {
    let id = _bindResourceIdMap.get(obj);
    if (id === undefined) {
        id = _nextBindResourceId++;
        _bindResourceIdMap.set(obj, id);
    }
    return id;
}

/**
 * Computes deterministic lookup key for GPUBindGroupLayout and resource entries.
 */
export function hashBindingEntries(
    layout: GPUBindGroupLayout,
    entries: BindingEntry[]
): string {
    const layoutId = getResourceId(layout);
    const sorted = entries.length > 1
        ? entries.slice().sort((a, b) => a.binding - b.binding)
        : entries;

    let key = `${layoutId};`;
    for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const res = resolveBindingResource(entry.resource);
        key += `${entry.binding}:`;
        if ("buffer" in res) {
            const bufId = getResourceId(res.buffer);
            key += `b_${bufId}_${res.offset ?? 0}_${res.size ?? 0};`;
        } else if (typeof res === "object" && res !== null) {
            const resId = getResourceId(res as object);
            key += `r_${resId};`;
        }
    }
    return key;
}

/**
 * Cache preventing redundant allocation of identical GPUBindGroup instances.
 */
export class BindTableCache {
    private _cache = new Map<string, BindTable>();

    get(key: string): BindTable | undefined {
        return this._cache.get(key);
    }

    set(key: string, table: BindTable): void {
        this._cache.set(key, table);
    }

    getOrCreate(
        device: Device | GPUDevice,
        layout: GPUBindGroupLayout | BindLayout,
        entries: BindingEntry[],
        options: { slot?: number; label?: string } = {}
    ): BindTable {
        const rawLayout = "native" in layout ? layout.native : layout;
        const key = hashBindingEntries(rawLayout, entries);
        let cached = this._cache.get(key);
        if (!cached) {
            cached = BindTable.create(device, rawLayout, entries, options);
            this._cache.set(key, cached);
        }
        return cached;
    }

    clear(): void {
        this._cache.clear();
    }
}
