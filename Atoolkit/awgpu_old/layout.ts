import type { Buffer } from "./buffer.js";
import type { Texture, Sampler } from "./target.js";

/**
 * Standardized 4-tier WebGPU bind group frequency slots.
 */
export enum BindSlot {
    Pass = 0,       // Updated once per pass (ViewProj, Viewport, Time, Globals)
    Phase = 1,      // Updated once per phase (Environment maps, global phase buffers, phase textures)
    Material = 2,   // Updated per material switch (Material parameters, Color/Normal textures, Standard samplers)
    Instance = 3,   // Updated per draw/batch (Model matrix, Normal matrix, Bone palette storage)
}

/**
 * Fluent builder for creating GPUBindGroupLayout descriptors.
 */
export class BindGroupLayoutBuilder {
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
        visibility: GPUShaderStageFlags = GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
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

    addDepthTexture(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT,
        options: { viewDimension?: GPUTextureViewDimension; multisampled?: boolean } = {}
    ): this {
        return this.addTexture(binding, visibility, {
            sampleType: "depth",
            viewDimension: options.viewDimension,
            multisampled: options.multisampled,
        });
    }

    addSampler(
        binding: number,
        visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT,
        optionsOrType: GPUSamplerBindingType | { comparison?: boolean } = "filtering"
    ): this {
        const type: GPUSamplerBindingType =
            typeof optionsOrType === "object"
                ? (optionsOrType.comparison ? "comparison" : "filtering")
                : optionsOrType;
        this.entries.push({
            binding,
            visibility,
            sampler: { type },
        });
        return this;
    }

    build(device: GPUDevice, label = "BindGroupLayout"): GPUBindGroupLayout {
        return device.createBindGroupLayout({
            label,
            entries: this.entries,
        });
    }
}

export type ResourceBinding =
    | GPUBufferBinding
    | GPUTextureView
    | GPUSampler
    | Buffer
    | Texture
    | Sampler;

export interface BindingEntry {
    binding: number;
    resource: ResourceBinding;
}

/**
 * GPU bind group wrapper tracking slot index and layout.
 */
export class BindGroup {
    readonly gpuBindGroup: GPUBindGroup;
    readonly layout: GPUBindGroupLayout;
    readonly slot: number;
    readonly label: string;

    constructor(
        gpuBindGroup: GPUBindGroup,
        layout: GPUBindGroupLayout,
        slot: number = BindSlot.Pass,
        label = "BindGroup"
    ) {
        this.gpuBindGroup = gpuBindGroup;
        this.layout = layout;
        this.slot = slot;
        this.label = label;
    }

    /**
     * Resolves resource wrappers into native GPUBindingResource descriptors.
     */
    static resolveResource(res: ResourceBinding): GPUBindingResource {
        if ("gpuBuffer" in res) {
            return { buffer: res.gpuBuffer };
        }
        if ("gpuView" in res) {
            return res.gpuView;
        }
        if ("gpuSampler" in res) {
            return res.gpuSampler;
        }
        return res as GPUBindingResource;
    }

    /**
     * Factory: Creates GPUBindGroup from typed entries.
     */
    static create(
        device: GPUDevice,
        layout: GPUBindGroupLayout,
        entries: BindingEntry[],
        options: { slot?: number; label?: string } = {}
    ): BindGroup {
        const label = options.label ?? "BindGroup";
        const slot = options.slot ?? BindSlot.Pass;

        const resolvedEntries: GPUBindGroupEntry[] = entries.map((e) => ({
            binding: e.binding,
            resource: BindGroup.resolveResource(e.resource),
        }));

        const gpuBindGroup = device.createBindGroup({
            label,
            layout,
            entries: resolvedEntries,
        });

        return new BindGroup(gpuBindGroup, layout, slot, label);
    }
}
