export type BufferData =
    | BufferSource
    | ArrayBufferView
    | Float32Array
    | Uint16Array
    | Uint32Array
    | Uint8Array
    | Int32Array
    | ArrayBuffer;

/**
 * GPU buffer wrapper supporting uniform, storage, vertex, and index operations.
 */
export class Buffer {
    readonly gpuBuffer: GPUBuffer;
    readonly size: number;
    readonly usage: GPUBufferUsageFlags;
    readonly label: string;
    readonly gpuOwned: boolean;

    constructor(
        gpuBuffer: GPUBuffer,
        size: number,
        usage: GPUBufferUsageFlags,
        options: { label?: string; gpuOwned?: boolean } = {}
    ) {
        this.gpuBuffer = gpuBuffer;
        this.size = size;
        this.usage = usage;
        this.label = options.label ?? gpuBuffer.label ?? "Buffer";
        this.gpuOwned = options.gpuOwned ?? true;
    }

    /**
     * Uploads fresh data to GPU buffer using queue.writeBuffer.
     */
    write(device: GPUDevice, data: BufferData, bufferOffset = 0): void {
        const view = data as ArrayBufferView;
        const byteLength = view.byteLength ?? (data as ArrayBuffer).byteLength;
        const buffer = view.buffer ?? (data as ArrayBuffer);
        const byteOffset = view.byteOffset ?? 0;
        device.queue.writeBuffer(
            this.gpuBuffer,
            bufferOffset,
            buffer as ArrayBuffer,
            byteOffset,
            byteLength
        );
    }

    destroy(): void {
        if (this.gpuOwned) {
            this.gpuBuffer.destroy();
        }
    }

    /**
     * Creates raw GPU buffer with optional initial data upload.
     */
    static create(
        device: GPUDevice,
        options: {
            size: number;
            usage: GPUBufferUsageFlags;
            data?: BufferData;
            label?: string;
        }
    ): Buffer {
        // Enforce 4-byte alignment
        const alignedSize = Math.max(4, Math.ceil(options.size / 4) * 4);
        const usage = options.usage | (options.data ? GPUBufferUsage.COPY_DST : 0);
        const label = options.label ?? "Buffer";

        const gpuBuffer = device.createBuffer({
            label,
            size: alignedSize,
            usage,
        });

        const buf = new Buffer(gpuBuffer, alignedSize, usage, { label });
        if (options.data) {
            buf.write(device, options.data);
        }
        return buf;
    }

    /**
     * Creates uniform buffer with automatic 16-byte minimum alignment.
     */
    static createUniform(
        device: GPUDevice,
        sizeOrData: number | BufferData,
        label = "UniformBuffer"
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength : (sizeOrData as number);
        // Minimum uniform size is 16 bytes, aligned to 16
        const size = Math.max(16, Math.ceil(rawSize / 16) * 16);
        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            data: isData ? (sizeOrData as BufferData) : undefined,
            label,
        });
    }

    /**
     * Creates storage buffer with read-only or read-write usage.
     */
    static createStorage(
        device: GPUDevice,
        sizeOrData: number | BufferData,
        options: { readOnly?: boolean; label?: string } = {}
    ): Buffer {
        const isData = typeof sizeOrData !== "number";
        const rawSize = isData ? (sizeOrData as ArrayBufferView).byteLength ?? (sizeOrData as ArrayBuffer).byteLength : (sizeOrData as number);
        const size = Math.max(16, Math.ceil(rawSize / 4) * 4);
        const label = options.label ?? "StorageBuffer";
        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            data: isData ? (sizeOrData as BufferData) : undefined,
            label,
        });
    }

    /**
     * Creates vertex buffer with uploaded vertex data.
     */
    static createVertex(
        device: GPUDevice,
        dataOrSize: BufferData | number,
        label = "VertexBuffer"
    ): Buffer {
        const isData = typeof dataOrSize !== "number";
        const rawSize = isData ? (dataOrSize as ArrayBufferView).byteLength ?? (dataOrSize as ArrayBuffer).byteLength : (dataOrSize as number);
        const size = Math.max(4, Math.ceil(rawSize / 4) * 4);
        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            data: isData ? (dataOrSize as BufferData) : undefined,
            label,
        });
    }

    /**
     * Creates index buffer with uploaded index data.
     */
    static createIndex(
        device: GPUDevice,
        dataOrSize: BufferData | number,
        label = "IndexBuffer"
    ): Buffer {
        const isData = typeof dataOrSize !== "number";
        const rawSize = isData ? (dataOrSize as ArrayBufferView).byteLength ?? (dataOrSize as ArrayBuffer).byteLength : (dataOrSize as number);
        const size = Math.max(4, Math.ceil(rawSize / 4) * 4);
        return Buffer.create(device, {
            size,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            data: isData ? (dataOrSize as BufferData) : undefined,
            label,
        });
    }
}

/**
 * Reusable GPU buffer pool for dynamic per-frame allocation without destruction thrashing.
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

    /** Total number of allocated buffers currently managed by pool. */
    get totalBuffers(): number {
        return this._availableCount + this._inUse.length;
    }

    /** Number of buffers currently acquired and active in frame. */
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
     * Acquires buffer with at least requested byte size using bucketed matching from available pool.
     */
    acquire(device: GPUDevice, requiredSize: number): Buffer {
        const alignedSize = Math.max(16, Math.ceil(requiredSize / 16) * 16);

        // 1. Fast O(1) exact size lookup
        const exactBucket = this._buckets.get(alignedSize);
        if (exactBucket && exactBucket.length > 0) {
            const buf = exactBucket.pop()!;
            this._availableCount--;
            this._inUse.push(buf);
            return buf;
        }

        // 2. Best-fit scan over distinct bucket sizes
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

        // 3. Allocate new buffer
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
            for (const b of bucket) {
                b.destroy();
            }
            bucket.length = 0;
        }
        this._buckets.clear();
        this._availableCount = 0;

        for (const b of this._inUse) {
            b.destroy();
        }
        this._inUse.length = 0;
    }
}


