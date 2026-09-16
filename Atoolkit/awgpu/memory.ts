// ================================================================
//  Awgpu - Level 1: Managed Hardware Memory & Handles
// ================================================================

import { type Device, resolveDevice, resolveQueue } from "./device.js";

// ArrayBufferView covers all typed array subtypes (Float32Array, Uint16Array, etc.).
export type BufferSourceData = ArrayBufferView | ArrayBuffer;

// Cache mapping raw GPUTexture -> default GPUTextureView.
// Prevents repeated createView() allocations when a raw GPUTexture is passed to
// resolveTextureView in hot paths. WeakMap allows garbage collection without manual cleanup.
const _gpuTextureViewCache = new WeakMap<GPUTexture, GPUTextureView>();

/**
 * Sub-allocation view pointing to an aligned byte range inside a buffer.
 */
export interface BufferSlice {
    readonly buffer: GPUBuffer | Buffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export interface ResolvedBuffer {
    buffer: GPUBuffer;
    offset: number;
    size: number;
}

/**
 * Resolves a buffer source (native GPUBuffer, Buffer wrapper, or BufferSlice) into concrete hardware descriptors.
 * Accepts an optional mutable ResolvedBuffer target to eliminate heap allocations in hot paths.
 */
export function resolveBuffer(
    source: GPUBuffer | Buffer | BufferSlice,
    out?: ResolvedBuffer
): ResolvedBuffer {
    const target = out ?? { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };
    if ("byteOffset" in source) {
        const rawBuf = "native" in source.buffer ? source.buffer.native : source.buffer;
        target.buffer = rawBuf;
        target.offset = source.byteOffset;
        target.size = source.byteLength;
        return target;
    }
    const raw = "native" in source ? source.native : source;
    target.buffer = raw;
    target.offset = 0;
    target.size = raw.size;
    return target;
}

/**
 * Resolves a texture source into a raw GPUTexture.
 */
export function resolveTexture(source: GPUTexture | Texture): GPUTexture {
    return "native" in source ? source.native : source;
}

/**
 * Resolves GPUTextureView from GPUTextureView, GPUTexture, or Texture wrapper.
 * Raw GPUTexture inputs are cached in a module-level WeakMap so the default view
 * is created only once per texture object, eliminating repeated allocations in hot paths.
 */
export function resolveTextureView(source: GPUTextureView | GPUTexture | Texture): GPUTextureView {
    if ("view" in source) {
        // Texture wrapper: returns pre-cached primary view.
        return source.view;
    }
    if ("createView" in source) {
        // Raw GPUTexture: look up or create and cache the default view.
        const tex = source as GPUTexture;
        let cached = _gpuTextureViewCache.get(tex);
        if (!cached) {
            cached = tex.createView();
            _gpuTextureViewCache.set(tex, cached);
        }
        return cached;
    }
    return source as GPUTextureView;
}

/**
 * Resolves a sampler from Sampler wrapper or GPUSampler.
 */
export function resolveSampler(source: GPUSampler | Sampler): GPUSampler {
    return "native" in source ? source.native : source;
}

/**
 * Managed WebGPU buffer with alignment validation and zero-allocation writing.
 */
export class Buffer {
    readonly native: GPUBuffer;
    readonly size: number;
    readonly usage: GPUBufferUsageFlags;
    readonly label: string;

    constructor(native: GPUBuffer, size: number, usage: GPUBufferUsageFlags, label = "Buffer") {
        this.native = native;
        this.size = size;
        this.usage = usage;
        this.label = label;
    }

    /**
     * Creates a slice view into this buffer without heap allocation.
     */
    slice(byteOffset: number, byteLength?: number): BufferSlice {
        const len = byteLength ?? (this.size - byteOffset);
        return {
            buffer: this,
            byteOffset,
            byteLength: len,
        };
    }

    /**
     * Uploads typed array data in-place into GPU buffer memory via queue.writeBuffer.
     */
    write(device: Device | GPUDevice, data: BufferSourceData, bufferOffset = 0): void {
        const queue = resolveQueue(device);
        const view = data as ArrayBufferView;
        const byteLength = view.byteLength ?? (data as ArrayBuffer).byteLength;
        const buffer = view.buffer ?? (data as ArrayBuffer);
        const byteOffset = view.byteOffset ?? 0;

        queue.writeBuffer(
            this.native,
            bufferOffset,
            buffer as ArrayBuffer,
            byteOffset,
            byteLength
        );
    }

    /**
     * Reads buffer contents back to CPU via a MAP_READ staging buffer.
     * - byteOffset: byte start within this buffer. Default 0.
     * - byteLength: number of bytes to read. Defaults to remaining size from byteOffset.
     * - reusableStaging: optional pre-allocated MAP_READ staging buffer to avoid per-read buffer creation.
     * Returns a detached ArrayBuffer. Staging buffer is destroyed only if allocated internally.
     */
    async read(
        device: Device | GPUDevice,
        byteOffset = 0,
        byteLength?: number,
        reusableStaging?: GPUBuffer
    ): Promise<ArrayBuffer> {
        const gpu = resolveDevice(device);
        const queue = resolveQueue(device);
        const size = byteLength ?? (this.size - byteOffset);

        const staging = reusableStaging ?? gpu.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: `${this.label}_ReadStaging`,
        });

        const encoder = gpu.createCommandEncoder({ label: `${this.label}_ReadEncoder` });
        encoder.copyBufferToBuffer(this.native, byteOffset, staging, 0, size);
        queue.submit([encoder.finish()]);

        await staging.mapAsync(GPUMapMode.READ, 0, size);
        const result = staging.getMappedRange(0, size).slice(0);
        staging.unmap();

        if (!reusableStaging) {
            staging.destroy();
        }

        return result;
    }

    destroy(): void {
        this.native.destroy();
    }

    /**
     * Factory: Allocates a raw GPU buffer with optional initial data upload.
     */
    static create(
        device: Device | GPUDevice,
        desc: {
            size: number;
            usage: GPUBufferUsageFlags;
            data?: BufferSourceData;
            label?: string;
        }
    ): Buffer {
        const gpu = resolveDevice(device);
        const alignedSize = Math.max(4, Math.ceil(desc.size / 4) * 4);
        const usage = desc.usage | (desc.data ? GPUBufferUsage.COPY_DST : 0);
        const label = desc.label ?? "Buffer";

        const native = gpu.createBuffer({
            label,
            size: alignedSize,
            usage,
        });

        const buf = new Buffer(native, alignedSize, usage, label);
        if (desc.data) {
            buf.write(gpu, desc.data);
        }
        return buf;
    }

    /**
     * Aligns byte offset to uniform buffer dynamic offset boundary.
     * WebGPU requires dynamic uniform offsets to align to minUniformBufferOffsetAlignment (256 bytes).
     */
    static alignUniformOffset(offset: number, alignment = 256): number {
        return Math.ceil(offset / alignment) * alignment;
    }

    /**
     * Factory: Allocates uniform buffer enforcing 16-byte minimum and 16-byte alignment.
     */
    static createUniform(
        device: Device | GPUDevice,
        sizeOrData: number | BufferSourceData,
        label = "UniformBuffer"
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData
            ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength
            : (sizeOrData as number);
        const size = Math.max(16, Math.ceil(rawSize / 16) * 16);

        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            data: isData ? (sizeOrData as BufferSourceData) : undefined,
            label,
        });
    }

    /**
     * Factory: Allocates storage buffer aligned to 4 bytes.
     */
    static createStorage(
        device: Device | GPUDevice,
        sizeOrData: number | BufferSourceData,
        options: { readOnly?: boolean; label?: string } = {}
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData
            ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength
            : (sizeOrData as number);
        const size = Math.max(4, Math.ceil(rawSize / 4) * 4);
        const label = options.label ?? "StorageBuffer";

        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            data: isData ? (sizeOrData as BufferSourceData) : undefined,
            label,
        });
    }

    /**
     * Factory: Allocates vertex buffer aligned to 4 bytes.
     */
    static createVertex(
        device: Device | GPUDevice,
        sizeOrData: number | BufferSourceData,
        label = "VertexBuffer"
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData
            ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength
            : (sizeOrData as number);
        const size = Math.max(4, Math.ceil(rawSize / 4) * 4);

        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            data: isData ? (sizeOrData as BufferSourceData) : undefined,
            label,
        });
    }

    /**
     * Factory: Allocates index buffer aligned to 4 bytes.
     */
    static createIndex(
        device: Device | GPUDevice,
        sizeOrData: number | BufferSourceData,
        label = "IndexBuffer"
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData
            ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength
            : (sizeOrData as number);
        const size = Math.max(4, Math.ceil(rawSize / 4) * 4);

        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            data: isData ? (sizeOrData as BufferSourceData) : undefined,
            label,
        });
    }
}

/**
 * Managed WebGPU texture with default view companion.
 */
export class Texture {
    readonly native: GPUTexture;
    readonly view: GPUTextureView;
    readonly width: number;
    readonly height: number;
    readonly depthOrLayers: number;
    readonly format: GPUTextureFormat;
    readonly usage: GPUTextureUsageFlags;
    readonly label: string;

    constructor(
        native: GPUTexture,
        view: GPUTextureView,
        width: number,
        height: number,
        depthOrLayers: number,
        format: GPUTextureFormat,
        usage: GPUTextureUsageFlags,
        label = "Texture"
    ) {
        this.native = native;
        this.view = view;
        this.width = width;
        this.height = height;
        this.depthOrLayers = depthOrLayers;
        this.format = format;
        this.usage = usage;
        this.label = label;
    }

    createView(desc?: GPUTextureViewDescriptor): GPUTextureView {
        return this.native.createView(desc);
    }

    /**
     * Uploads pixel data to 2D texture via queue.writeTexture.
     * Automatically aligns bytesPerRow to 256-byte boundary if omitted.
     */
    write2D(
        device: Device | GPUDevice,
        data: BufferSourceData,
        options: {
            x?: number;
            y?: number;
            width?: number;
            height?: number;
            bytesPerPixel?: number;
            bytesPerRow?: number;
            rowsPerImage?: number;
            mipLevel?: number;
        } = {}
    ): void {
        const queue = resolveQueue(device);
        const w = options.width ?? this.width;
        const h = options.height ?? this.height;
        const bpp = options.bytesPerPixel ?? 4;
        const unalignedBytesPerRow = w * bpp;
        const bytesPerRow = options.bytesPerRow ?? Math.ceil(unalignedBytesPerRow / 256) * 256;

        const view = data as ArrayBufferView;
        const buffer = view.buffer ?? (data as ArrayBuffer);
        const byteOffset = view.byteOffset ?? 0;

        queue.writeTexture(
            {
                texture: this.native,
                mipLevel: options.mipLevel ?? 0,
                origin: { x: options.x ?? 0, y: options.y ?? 0, z: 0 },
            },
            buffer,
            {
                offset: byteOffset,
                bytesPerRow,
                rowsPerImage: options.rowsPerImage ?? h,
            },
            { width: w, height: h, depthOrArrayLayers: 1 }
        );
    }

    /**
     * Copies an external image source (ImageBitmap, HTMLCanvasElement, OffscreenCanvas) directly into the texture.
     */
    copyExternalImage(
        device: Device | GPUDevice,
        source: GPUCopyExternalImageSourceInfo,
        options: {
            x?: number;
            y?: number;
            mipLevel?: number;
        } = {}
    ): void {
        const queue = resolveQueue(device);
        const src = source.source as { width: number; height: number };
        queue.copyExternalImageToTexture(
            source,
            {
                texture: this.native,
                mipLevel: options.mipLevel ?? 0,
                origin: { x: options.x ?? 0, y: options.y ?? 0, z: 0 },
            },
            {
                width: src.width,
                height: src.height,
            }
        );
    }

    destroy(): void {
        this.native.destroy();
    }

    /**
     * Factory: Instantiates Texture from native GPUTextureDescriptor.
     */
    static create(device: Device | GPUDevice, desc: GPUTextureDescriptor): Texture {
        const gpu = resolveDevice(device);
        const native = gpu.createTexture(desc);
        const view = native.createView({ label: `${desc.label ?? "Texture"}_View` });
        const size = desc.size as GPUExtent3DDict;
        const width = "width" in size ? size.width : (desc.size as number[])[0];
        const height = "height" in size ? size.height ?? 1 : ((desc.size as number[])[1] ?? 1);
        const depth = "depthOrArrayLayers" in size ? size.depthOrArrayLayers ?? 1 : ((desc.size as number[])[2] ?? 1);

        return new Texture(native, view, width, height, depth, desc.format, desc.usage, desc.label);
    }

    /**
     * Factory: Allocates 2D color or data texture.
     */
    static create2D(
        device: Device | GPUDevice,
        options: {
            width: number;
            height: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            sampleCount?: number;
            label?: string;
        }
    ): Texture {
        const w = Math.max(1, options.width);
        const h = Math.max(1, options.height);
        const format = options.format ?? "rgba8unorm";
        const usage =
            options.usage ??
            (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST);
        const label = options.label ?? "Texture2D";

        return Texture.create(device, {
            label,
            size: [w, h, 1],
            format,
            usage,
            sampleCount: options.sampleCount ?? 1,
        });
    }

    /**
     * Factory: Allocates 3D volumetric texture.
     */
    static create3D(
        device: Device | GPUDevice,
        options: {
            width: number;
            height: number;
            depth: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            label?: string;
        }
    ): Texture {
        const w = Math.max(1, options.width);
        const h = Math.max(1, options.height);
        const d = Math.max(1, options.depth);
        const format = options.format ?? "r32float";
        const usage =
            options.usage ??
            (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST);
        const label = options.label ?? "Texture3D";

        return Texture.create(device, {
            label,
            size: [w, h, d],
            dimension: "3d",
            format,
            usage,
        });
    }

    /**
     * Factory: Allocates 2D depth or depth-stencil texture.
     */
    static createDepth(
        device: Device | GPUDevice,
        options: {
            width: number;
            height: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            stencil?: boolean;
            sampleCount?: number;
            label?: string;
        }
    ): Texture {
        const w = Math.max(1, options.width);
        const h = Math.max(1, options.height);
        const defaultFormat = options.stencil ? "depth24plus-stencil8" : "depth24plus";
        const format = options.format ?? defaultFormat;
        const usage = options.usage ?? (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
        const label = options.label ?? "DepthTexture";

        return Texture.create(device, {
            label,
            size: [w, h, 1],
            format,
            usage,
            sampleCount: options.sampleCount ?? 1,
        });
    }

    /**
     * Wraps pre-existing native GPUTexture.
     */
    static fromNative(gpuTexture: GPUTexture, view?: GPUTextureView, label?: string): Texture {
        const texView = view ?? gpuTexture.createView();
        return new Texture(
            gpuTexture,
            texView,
            gpuTexture.width,
            gpuTexture.height,
            gpuTexture.depthOrArrayLayers,
            gpuTexture.format,
            gpuTexture.usage,
            label ?? gpuTexture.label
        );
    }

    /**
     * Factory: Allocates cube map texture with 6 equal-width-and-height layers.
     * Primary view stored in .view is configured with dimension "cube" for direct cube
     * sampler access in WGSL. Individual face views can be created with createView().
     * - size: width and height in texels (faces are square).
     * - mipLevelCount: number of mip levels. Default 1.
     */
    static createCube(
        device: Device | GPUDevice,
        options: {
            size: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            mipLevelCount?: number;
            label?: string;
        }
    ): Texture {
        const s = Math.max(1, options.size);
        const format = options.format ?? "rgba8unorm";
        const usage =
            options.usage ??
            (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
        const label = options.label ?? "CubeTexture";
        const mipLevelCount = options.mipLevelCount ?? 1;

        const gpu = resolveDevice(device);
        const native = gpu.createTexture({
            label,
            size: [s, s, 6],
            dimension: "2d",
            format,
            usage,
            mipLevelCount,
        });

        // Cube view for WGSL textureSample(..., textureCube<f32>, ...) sampling.
        const view = native.createView({
            label: `${label}_View`,
            dimension: "cube",
            arrayLayerCount: 6,
        });

        return new Texture(native, view, s, s, 6, format, native.usage, label);
    }
}

/**
 * Managed WebGPU hardware sampler.
 */
export class Sampler {
    readonly native: GPUSampler;
    readonly label: string;

    constructor(native: GPUSampler, label = "Sampler") {
        this.native = native;
        this.label = label;
    }

    static create(device: Device | GPUDevice, desc: GPUSamplerDescriptor = {}): Sampler {
        const gpu = resolveDevice(device);
        const native = gpu.createSampler(desc);
        return new Sampler(native, desc.label);
    }

    static createLinear(device: Device | GPUDevice, label = "LinearSampler"): Sampler {
        return Sampler.create(device, {
            label,
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
        });
    }

    static createNearest(device: Device | GPUDevice, label = "NearestSampler"): Sampler {
        return Sampler.create(device, {
            label,
            magFilter: "nearest",
            minFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            addressModeW: "clamp-to-edge",
        });
    }

    static createComparison(
        device: Device | GPUDevice,
        options: { compare?: GPUCompareFunction; label?: string } = {}
    ): Sampler {
        const label = options.label ?? "ComparisonSampler";
        return Sampler.create(device, {
            label,
            compare: options.compare ?? "less",
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });
    }
}

/**
 * Reusable GPU buffer pool for dynamic per-frame allocation with best-fit recycling.
 */
export class BufferPool {
    private _buckets = new Map<number, Buffer[]>();
    private _inUse: Buffer[] = [];
    private _availableCount = 0;
    readonly usage: GPUBufferUsageFlags;
    readonly label: string;

    constructor(usage: GPUBufferUsageFlags, label = "BufferPool") {
        this.usage = usage;
        this.label = label;
    }

    get totalBuffers(): number {
        return this._availableCount + this._inUse.length;
    }

    get inUseCount(): number {
        return this._inUse.length;
    }

    private _addToBucket(buf: Buffer): void {
        let bucket = this._buckets.get(buf.size);
        if (!bucket) {
            bucket = [];
            this._buckets.set(buf.size, bucket);
        }
        bucket.push(buf);
        this._availableCount++;
    }

    /**
     * Resets active allocations at start of frame, returning all buffers to available pool.
     */
    reset(): void {
        const inUse = this._inUse;
        for (let i = 0; i < inUse.length; i++) {
            this._addToBucket(inUse[i]);
        }
        inUse.length = 0;
    }

    /**
     * Acquires buffer with at least requested byte size using bucketed best-fit matching.
     */
    acquire(device: Device | GPUDevice, requiredSize: number): Buffer {
        const alignedSize = Math.max(16, Math.ceil(requiredSize / 16) * 16);

        const exactBucket = this._buckets.get(alignedSize);
        if (exactBucket && exactBucket.length > 0) {
            const buf = exactBucket.pop()!;
            this._availableCount--;
            this._inUse.push(buf);
            return buf;
        }

        let bestSize = -1;
        let bestDiff = Number.POSITIVE_INFINITY;

        for (const [size, bucket] of this._buckets) {
            if (bucket.length > 0 && size >= alignedSize) {
                const diff = size - alignedSize;
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestSize = size;
                }
            }
        }

        if (bestSize >= 0) {
            const bucket = this._buckets.get(bestSize)!;
            const buf = bucket.pop()!;
            this._availableCount--;
            this._inUse.push(buf);
            return buf;
        }

        const id = this.totalBuffers;
        const newBuf = Buffer.create(device, {
            size: alignedSize,
            usage: this.usage,
            label: `${this.label}_${id}`,
        });
        this._inUse.push(newBuf);
        return newBuf;
    }

    /**
     * Releases an individual buffer back to available pool ahead of frame reset.
     */
    release(buffer: Buffer): boolean {
        const idx = this._inUse.indexOf(buffer);
        if (idx === -1) return false;
        const lastIdx = this._inUse.length - 1;
        this._inUse[idx] = this._inUse[lastIdx];
        this._inUse.pop();
        this._addToBucket(buffer);
        return true;
    }

    destroy(): void {
        for (const bucket of this._buckets.values()) {
            for (let i = 0; i < bucket.length; i++) {
                bucket[i].destroy();
            }
            bucket.length = 0;
        }
        this._buckets.clear();
        this._availableCount = 0;

        for (let i = 0; i < this._inUse.length; i++) {
            this._inUse[i].destroy();
        }
        this._inUse.length = 0;
    }
}
