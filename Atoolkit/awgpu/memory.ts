import { type Device, resolveDevice } from "./device.js";

const BUFFER_USAGE_COPY_SRC = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.COPY_SRC : 0x0004;
const BUFFER_USAGE_COPY_DST = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.COPY_DST : 0x0008;
const BUFFER_USAGE_INDEX = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.INDEX : 0x0010;
const BUFFER_USAGE_VERTEX = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.VERTEX : 0x0020;
const BUFFER_USAGE_UNIFORM = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.UNIFORM : 0x0040;
const BUFFER_USAGE_STORAGE = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.STORAGE : 0x0080;
const BUFFER_USAGE_MAP_READ = typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage.MAP_READ : 0x0001;

const TEXTURE_USAGE_COPY_SRC = typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.COPY_SRC : 0x01;
const TEXTURE_USAGE_COPY_DST = typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.COPY_DST : 0x02;
const TEXTURE_USAGE_TEXTURE_BINDING = typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.TEXTURE_BINDING : 0x04;
const TEXTURE_USAGE_STORAGE_BINDING = typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.STORAGE_BINDING : 0x08;
const TEXTURE_USAGE_RENDER_ATTACHMENT = typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.RENDER_ATTACHMENT : 0x10;

const MAP_MODE_READ = typeof GPUMapMode !== "undefined" ? GPUMapMode.READ : 0x0001;

/**
 * Uncompressed texture formats supported for tight/validated CPU-to-GPU 2D uploads via `Texture.write2D`,
 * mapped to bytes per texel block (1x1 block).
 */
export const UNCOMPRESSED_TEXTURE_FORMAT_BPP: Readonly<Record<string, number>> = Object.freeze({
	"r8unorm": 1,
	"r8snorm": 1,
	"r8uint": 1,
	"r8sint": 1,
	"r16uint": 2,
	"r16sint": 2,
	"r16float": 2,
	"rg8unorm": 2,
	"rg8snorm": 2,
	"rg8uint": 2,
	"rg8sint": 2,
	"r32uint": 4,
	"r32sint": 4,
	"r32float": 4,
	"rg16uint": 4,
	"rg16sint": 4,
	"rg16float": 4,
	"rgba8unorm": 4,
	"rgba8unorm-srgb": 4,
	"rgba8snorm": 4,
	"rgba8uint": 4,
	"rgba8sint": 4,
	"bgra8unorm": 4,
	"bgra8unorm-srgb": 4,
	"rgb10a2uint": 4,
	"rgb10a2unorm": 4,
	"rg11b10ufloat": 4,
	"rgb9e5ufloat": 4,
	"rg32uint": 8,
	"rg32sint": 8,
	"rg32float": 8,
	"rgba16uint": 8,
	"rgba16sint": 8,
	"rgba16float": 8,
	"rgba32uint": 16,
	"rgba32sint": 16,
	"rgba32float": 16,
});

const _viewToTextureOwner = new WeakMap<object, GPUTexture>();
const _defaultTextureView = new WeakMap<GPUTexture, GPUTextureView>();

/**
 * Registers the backing native `GPUTexture` for a `GPUTextureView` so `PassGraph` and `BindTableCache`
 * can track hazards and evictions across views of the same texture.
 * Views created through `Texture.createView()` and `resolveTextureView()` are registered automatically.
 */
export function registerTextureViewOwner(view: GPUTextureView, texture: Texture | GPUTexture): void {
	const rawTex = texture instanceof Texture ? texture.native : texture;
	_viewToTextureOwner.set(view as unknown as object, rawTex);
}

/**
 * Resolves the registered parent `GPUTexture` for a `GPUTextureView`, or undefined if unregistered.
 */
export function getRegisteredTextureViewOwner(view: GPUTextureView): GPUTexture | undefined {
	return _viewToTextureOwner.get(view as unknown as object);
}

function getOrCreateDefaultTextureView(rawTex: GPUTexture): GPUTextureView {
	let view = _defaultTextureView.get(rawTex);
	if (!view) {
		view = rawTex.createView();
		registerTextureViewOwner(view, rawTex);
		_defaultTextureView.set(rawTex, view);
	}
	return view;
}

function assertNonNegativeInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative integer, got ${value}.`);
	}
}

function normalizeBufferSource(data: BufferSource | SharedArrayBuffer): {
	buffer: ArrayBufferLike;
	byteOffset: number;
	byteLength: number;
} {
	if (ArrayBuffer.isView(data)) {
		return {
			buffer: data.buffer,
			byteOffset: data.byteOffset,
			byteLength: data.byteLength,
		};
	}
	if (
		data instanceof ArrayBuffer ||
		(typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer)
	) {
		return {
			buffer: data,
			byteOffset: 0,
			byteLength: data.byteLength,
		};
	}
	throw new TypeError("Expected an ArrayBuffer, SharedArrayBuffer, or ArrayBufferView.");
}

export interface BufferDescriptor {
	/** Byte size of the buffer (if omitted, derived from initialData.byteLength). */
	size?: number;
	/** WebGPU buffer usage bitflags. */
	usage: GPUBufferUsageFlags;
	/** Optional initial payload written during buffer creation. Trailing 1..3 alignment bytes are zero-padded. */
	initialData?: BufferSource | SharedArrayBuffer;
	/** Optional debug label. */
	label?: string;
	/** Whether to map the buffer at creation even when initialData is not provided. */
	mappedAtCreation?: boolean;
}

/**
 * Sub-allocation view of a `Buffer` representing `[offset, offset + size)`.
 * Created via `buffer.slice(offset, size)` (allocates a descriptor object).
 */
export interface BufferSlice {
	readonly buffer: Buffer;
	readonly offset: number;
	readonly size: number;
}

export function isBufferSlice(val: unknown): val is BufferSlice {
	return (
		typeof val === "object" &&
		val !== null &&
		"buffer" in val &&
		"offset" in val &&
		"size" in val &&
		(val as BufferSlice).buffer instanceof Buffer
	);
}

/**
 * WebGPU `GPUBuffer` wrapper with explicit ownership, strict range/alignment checks,
 * and safe staging readback.
 */
export class Buffer {
	readonly native: GPUBuffer;
	readonly size: number;
	readonly usage: GPUBufferUsageFlags;
	readonly label?: string;
	readonly owned: boolean;
	#destroyed = false;

	private constructor(
		native: GPUBuffer,
		size: number,
		usage: GPUBufferUsageFlags,
		owned: boolean,
		label?: string
	) {
		this.native = native;
		this.size = size;
		this.usage = usage;
		this.owned = owned;
		this.label = label;
	}

	/** True if `destroy()` has been called on this wrapper. */
	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	/**
	 * Allocates a new owned `Buffer`.
	 * Initial data whose byte length is not a multiple of 4 is zero-padded into the buffer's
	 * 4-byte aligned allocation size.
	 */
	static create(device: Device | GPUDevice, desc: BufferDescriptor): Buffer {
		const rawDevice = resolveDevice(device);
		const initialSpan = desc.initialData ? normalizeBufferSource(desc.initialData) : null;
		const rawSize = desc.size ?? (initialSpan ? initialSpan.byteLength : 0);

		if (!Number.isInteger(rawSize) || rawSize < 0) {
			throw new RangeError(`Buffer.create: size must be a non-negative integer, got ${rawSize}.`);
		}
		if (initialSpan && desc.size !== undefined && initialSpan.byteLength > desc.size) {
			throw new RangeError(
				`Buffer.create: initialData byteLength (${initialSpan.byteLength}) exceeds requested size (${desc.size}).`
			);
		}

		const alignedSize = Math.max(4, Math.ceil(rawSize / 4) * 4);
		const hasInitialData = initialSpan !== null && initialSpan.byteLength > 0;

		const gpuBuffer = rawDevice.createBuffer({
			label: desc.label,
			size: alignedSize,
			usage: desc.usage,
			mappedAtCreation: hasInitialData || !!desc.mappedAtCreation,
		});

		if (hasInitialData && initialSpan) {
			const mappedRange = gpuBuffer.getMappedRange();
			const dstBytes = new Uint8Array(mappedRange);
			const srcBytes = new Uint8Array(
				initialSpan.buffer,
				initialSpan.byteOffset,
				initialSpan.byteLength
			);
			dstBytes.set(srcBytes, 0);
			if (dstBytes.byteLength > srcBytes.byteLength) {
				dstBytes.fill(0, srcBytes.byteLength);
			}
			gpuBuffer.unmap();
		}

		return new Buffer(gpuBuffer, alignedSize, desc.usage, true, desc.label);
	}

	/**
	 * Wraps an existing native `GPUBuffer`.
	 * Defaults to `owned: false` (borrowed); `destroy()` will not destroy a borrowed `GPUBuffer`.
	 */
	static fromNative(
		native: GPUBuffer,
		usage?: GPUBufferUsageFlags,
		options: { owned?: boolean; label?: string } = {}
	): Buffer {
		return new Buffer(
			native,
			native.size,
			usage ?? native.usage,
			options.owned ?? false,
			options.label ?? native.label
		);
	}

	static uniform(
		device: Device | GPUDevice,
		sizeOrData: number | BufferSource,
		label?: string
	): Buffer {
		const isNum = typeof sizeOrData === "number";
		const rawSize = isNum ? sizeOrData : normalizeBufferSource(sizeOrData).byteLength;
		if (!Number.isInteger(rawSize) || rawSize < 0) {
			throw new RangeError(`Buffer.uniform: size must be a non-negative integer, got ${rawSize}.`);
		}
		const alignedSize = Math.max(16, Math.ceil(rawSize / 16) * 16);
		return Buffer.create(device, {
			size: alignedSize,
			usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
			initialData: isNum ? undefined : sizeOrData,
			label: label ?? "Awgpu_UniformBuffer",
		});
	}

	static storage(
		device: Device | GPUDevice,
		sizeOrData: number | BufferSource,
		readWrite = false,
		label?: string
	): Buffer {
		const isNum = typeof sizeOrData === "number";
		let usage = BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST;
		if (readWrite) {
			usage |= BUFFER_USAGE_COPY_SRC;
		}
		return Buffer.create(device, {
			size: isNum ? sizeOrData : undefined,
			usage,
			initialData: isNum ? undefined : sizeOrData,
			label: label ?? "Awgpu_StorageBuffer",
		});
	}

	static vertex(
		device: Device | GPUDevice,
		sizeOrData: number | BufferSource,
		label?: string
	): Buffer {
		const isNum = typeof sizeOrData === "number";
		return Buffer.create(device, {
			size: isNum ? sizeOrData : undefined,
			usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
			initialData: isNum ? undefined : sizeOrData,
			label: label ?? "Awgpu_VertexBuffer",
		});
	}

	static index(
		device: Device | GPUDevice,
		sizeOrData: number | BufferSource,
		label?: string
	): Buffer {
		const isNum = typeof sizeOrData === "number";
		return Buffer.create(device, {
			size: isNum ? sizeOrData : undefined,
			usage: BUFFER_USAGE_INDEX | BUFFER_USAGE_COPY_DST,
			initialData: isNum ? undefined : sizeOrData,
			label: label ?? "Awgpu_IndexBuffer",
		});
	}

	/**
	 * Strict queue upload of `[srcByteOffset, srcByteOffset + byteLength)` into this buffer at `dstByteOffset`.
	 *
	 * Contract:
	 * - `dstByteOffset`, `srcByteOffset`, and `byteLength` are always in bytes regardless of `ArrayBufferView` element type.
	 * - Both `dstByteOffset` and `byteLength` must be multiples of 4 bytes (WebGPU `queue.writeBuffer` requirement).
	 * - Does not pad odd-length writes or overwrite adjacent bytes; use `writePadded()` if 4-byte zero-padding is desired.
	 */
	write(
		device: Device | GPUDevice,
		data: BufferSource | SharedArrayBuffer,
		dstByteOffset = 0,
		srcByteOffset = 0,
		byteLength?: number
	): void {
		if (this.#destroyed) {
			throw new Error("Buffer.write: cannot write to a destroyed Buffer.");
		}
		const span = normalizeBufferSource(data);
		assertNonNegativeInteger(dstByteOffset, "Buffer.write dstByteOffset");
		assertNonNegativeInteger(srcByteOffset, "Buffer.write srcByteOffset");

		if (srcByteOffset > span.byteLength) {
			throw new RangeError(
				`Buffer.write: srcByteOffset (${srcByteOffset}) exceeds data byteLength (${span.byteLength}).`
			);
		}

		const resolvedLength = byteLength ?? (span.byteLength - srcByteOffset);
		assertNonNegativeInteger(resolvedLength, "Buffer.write byteLength");

		if (srcByteOffset + resolvedLength > span.byteLength) {
			throw new RangeError(
				`Buffer.write: source range [${srcByteOffset}, ${srcByteOffset + resolvedLength}) exceeds data byteLength (${span.byteLength}).`
			);
		}
		if (dstByteOffset % 4 !== 0) {
			throw new RangeError(
				`Buffer.write: dstByteOffset (${dstByteOffset}) must be a multiple of 4 bytes.`
			);
		}
		if (resolvedLength % 4 !== 0) {
			throw new RangeError(
				`Buffer.write: byteLength (${resolvedLength}) must be a multiple of 4 bytes. Use writePadded() for explicit zero-padded writes.`
			);
		}
		if (dstByteOffset + resolvedLength > this.size) {
			throw new RangeError(
				`Buffer.write: destination range [${dstByteOffset}, ${dstByteOffset + resolvedLength}) exceeds buffer size (${this.size}).`
			);
		}
		if (resolvedLength === 0) {
			return;
		}

		const rawDevice = resolveDevice(device);
		const byteView = new Uint8Array(span.buffer, span.byteOffset + srcByteOffset, resolvedLength);
		rawDevice.queue.writeBuffer(this.native, dstByteOffset, byteView as unknown as BufferSource, 0, resolvedLength);
	}

	/**
	 * Uploads `[srcByteOffset, srcByteOffset + byteLength)` into this buffer at `dstByteOffset`,
	 * zero-padding the trailing 1..3 bytes if `byteLength` is not a multiple of 4.
	 * Note: the full 4-byte aligned span `[dstByteOffset, dstByteOffset + ceil(byteLength / 4) * 4)`
	 * is written to the buffer and must fit within `this.size`.
	 */
	writePadded(
		device: Device | GPUDevice,
		data: BufferSource | SharedArrayBuffer,
		dstByteOffset = 0,
		srcByteOffset = 0,
		byteLength?: number
	): void {
		if (this.#destroyed) {
			throw new Error("Buffer.writePadded: cannot write to a destroyed Buffer.");
		}
		const span = normalizeBufferSource(data);
		assertNonNegativeInteger(dstByteOffset, "Buffer.writePadded dstByteOffset");
		assertNonNegativeInteger(srcByteOffset, "Buffer.writePadded srcByteOffset");

		if (srcByteOffset > span.byteLength) {
			throw new RangeError(
				`Buffer.writePadded: srcByteOffset (${srcByteOffset}) exceeds data byteLength (${span.byteLength}).`
			);
		}

		const resolvedLength = byteLength ?? (span.byteLength - srcByteOffset);
		assertNonNegativeInteger(resolvedLength, "Buffer.writePadded byteLength");

		if (srcByteOffset + resolvedLength > span.byteLength) {
			throw new RangeError(
				`Buffer.writePadded: source range [${srcByteOffset}, ${srcByteOffset + resolvedLength}) exceeds data byteLength (${span.byteLength}).`
			);
		}
		if (dstByteOffset % 4 !== 0) {
			throw new RangeError(
				`Buffer.writePadded: dstByteOffset (${dstByteOffset}) must be a multiple of 4 bytes.`
			);
		}
		if (resolvedLength === 0) {
			return;
		}

		const paddedLength = Math.ceil(resolvedLength / 4) * 4;
		if (dstByteOffset + paddedLength > this.size) {
			throw new RangeError(
				`Buffer.writePadded: padded destination range [${dstByteOffset}, ${dstByteOffset + paddedLength}) exceeds buffer size (${this.size}).`
			);
		}

		if (resolvedLength === paddedLength) {
			this.write(device, data, dstByteOffset, srcByteOffset, resolvedLength);
			return;
		}

		const rawDevice = resolveDevice(device);
		const alignedLength = resolvedLength & ~3;
		if (alignedLength > 0) {
			const headView = new Uint8Array(span.buffer, span.byteOffset + srcByteOffset, alignedLength);
			rawDevice.queue.writeBuffer(this.native, dstByteOffset, headView as unknown as BufferSource, 0, alignedLength);
		}

		const tail = new Uint8Array(4);
		const rem = resolvedLength - alignedLength;
		const srcTail = new Uint8Array(span.buffer, span.byteOffset + srcByteOffset + alignedLength, rem);
		tail.set(srcTail, 0);
		rawDevice.queue.writeBuffer(this.native, dstByteOffset + alignedLength, tail, 0, 4);
	}

	/**
	 * Creates a validated `BufferSlice` descriptor referencing `[offset, offset + size)`.
	 * Note: allocates a lightweight JS object `{ buffer, offset, size }`.
	 */
	slice(offset = 0, size?: number): BufferSlice {
		assertNonNegativeInteger(offset, "Buffer.slice offset");
		if (offset > this.size) {
			throw new RangeError(`Buffer.slice: offset (${offset}) exceeds buffer size (${this.size}).`);
		}
		const resolvedSize = size ?? (this.size - offset);
		assertNonNegativeInteger(resolvedSize, "Buffer.slice size");
		if (offset + resolvedSize > this.size) {
			throw new RangeError(
				`Buffer.slice: range [${offset}, ${offset + resolvedSize}) exceeds buffer size (${this.size}).`
			);
		}
		return {
			buffer: this,
			offset,
			size: resolvedSize,
		};
	}

	/**
	 * Reads `[srcOffset, srcOffset + byteLength)` back to a newly allocated `Uint8Array`.
	 *
	 * Ownership and lifetime contract:
	 * - `srcOffset` and `byteLength` must be multiples of 4 bytes, and this buffer must have `COPY_SRC` usage.
	 * - If `stagingBuffer` is omitted, a temporary staging buffer is allocated and guaranteed to be
	 *   unmapped and destroyed in `finally` on both success and failure.
	 * - If `stagingBuffer` is provided by the caller, it must have `MAP_READ | COPY_DST` usage,
	 *   have `size >= byteLength`, and must not be used concurrently by another readback. The caller's
	 *   staging buffer is unmapped in `finally` and is never destroyed by `readback()`.
	 */
	async readback(
		device: Device | GPUDevice,
		srcOffset = 0,
		byteLength?: number,
		stagingBuffer?: Buffer | GPUBuffer
	): Promise<Uint8Array> {
		if (this.#destroyed) {
			throw new Error("Buffer.readback: cannot read back from a destroyed Buffer.");
		}
		if ((this.usage & BUFFER_USAGE_COPY_SRC) === 0) {
			throw new Error("Buffer.readback: source buffer must be created with GPUBufferUsage.COPY_SRC.");
		}

		assertNonNegativeInteger(srcOffset, "Buffer.readback srcOffset");
		if (srcOffset > this.size) {
			throw new RangeError(`Buffer.readback: srcOffset (${srcOffset}) exceeds buffer size (${this.size}).`);
		}
		const size = byteLength ?? (this.size - srcOffset);
		assertNonNegativeInteger(size, "Buffer.readback byteLength");

		if (srcOffset % 4 !== 0 || size % 4 !== 0) {
			throw new RangeError(
				`Buffer.readback: srcOffset (${srcOffset}) and byteLength (${size}) must be multiples of 4 bytes.`
			);
		}
		if (srcOffset + size > this.size) {
			throw new RangeError(
				`Buffer.readback: range [${srcOffset}, ${srcOffset + size}) exceeds buffer size (${this.size}).`
			);
		}
		if (size === 0) {
			return new Uint8Array(0);
		}

		const rawDevice = resolveDevice(device);
		const ownsStaging = !stagingBuffer;
		let rawStaging: GPUBuffer;

		if (stagingBuffer) {
			rawStaging = stagingBuffer instanceof Buffer ? stagingBuffer.native : stagingBuffer;
			const stSize = stagingBuffer instanceof Buffer ? stagingBuffer.size : rawStaging.size;
			const stUsage = stagingBuffer instanceof Buffer ? stagingBuffer.usage : rawStaging.usage;
			if (stSize < size) {
				throw new RangeError(
					`Buffer.readback: provided stagingBuffer size (${stSize}) is smaller than readback size (${size}).`
				);
			}
			const requiredUsage = BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST;
			if (stUsage !== undefined && (stUsage & requiredUsage) !== requiredUsage) {
				throw new Error(
					"Buffer.readback: provided stagingBuffer must have GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST."
				);
			}
		} else {
			rawStaging = rawDevice.createBuffer({
				label: `${this.label ?? "Buffer"}_ReadbackStaging`,
				size,
				usage: BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST,
			});
		}

		let mapped = false;
		try {
			const encoder = rawDevice.createCommandEncoder({ label: "Awgpu_ReadbackEncoder" });
			encoder.copyBufferToBuffer(this.native, srcOffset, rawStaging, 0, size);
			rawDevice.queue.submit([encoder.finish()]);

			await rawStaging.mapAsync(MAP_MODE_READ, 0, size);
			mapped = true;

			const mappedRange = rawStaging.getMappedRange(0, size);
			const result = new Uint8Array(size);
			result.set(new Uint8Array(mappedRange));
			return result;
		} finally {
			if (mapped) {
				try {
					rawStaging.unmap();
				} catch {
					// Ignore unmap errors if device was lost.
				}
			}
			if (ownsStaging) {
				try {
					rawStaging.destroy();
				} catch {
					// Ignore destroy errors.
				}
			}
		}
	}

	/**
	 * Destroys the underlying `GPUBuffer` if `owned` is true.
	 * Idempotent; never destroys borrowed native buffers.
	 */
	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		if (this.owned) {
			this.native.destroy();
		}
	}
}

export interface TextureDescriptor {
	width: number;
	height: number;
	depthOrArrayLayers?: number;
	mipLevelCount?: number;
	sampleCount?: number;
	dimension?: GPUTextureDimension;
	format: GPUTextureFormat;
	usage?: GPUTextureUsageFlags;
	viewFormats?: GPUTextureFormat[];
	label?: string;
}

export interface DepthTextureDescriptor {
	width: number;
	height: number;
	format?: GPUTextureFormat;
	sampleCount?: number;
	usage?: GPUTextureUsageFlags;
	label?: string;
}

export interface TextureWriteOptions {
	/** Explicit bytes per texel block (optional for known uncompressed formats). */
	bytesPerPixel?: number;
	/** Row stride in bytes of the CPU source buffer. Defaults to tight packing (`width * bytesPerPixel`). */
	bytesPerRow?: number;
	/** Image height in rows within the CPU source buffer. Defaults to `height`. */
	rowsPerImage?: number;
	mipLevel?: number;
	origin?: GPUOrigin3D;
	width?: number;
	height?: number;
	depthOrArrayLayers?: number;
	/** Byte offset into `data` where texel bytes begin. */
	dataOffset?: number;
}

/**
 * WebGPU `GPUTexture` wrapper with explicit ownership, view-owner registration,
 * and validated 2D uploads.
 */
export class Texture {
	readonly native: GPUTexture;
	readonly width: number;
	readonly height: number;
	readonly depthOrArrayLayers: number;
	readonly format: GPUTextureFormat;
	readonly usage: GPUTextureUsageFlags;
	readonly mipLevelCount: number;
	readonly sampleCount: number;
	readonly label?: string;
	readonly owned: boolean;
	#defaultView: GPUTextureView | null = null;
	#destroyed = false;

	private constructor(
		native: GPUTexture,
		desc: TextureDescriptor & { usage: GPUTextureUsageFlags },
		owned: boolean
	) {
		this.native = native;
		this.width = desc.width;
		this.height = desc.height;
		this.depthOrArrayLayers = desc.depthOrArrayLayers ?? 1;
		this.format = desc.format;
		this.usage = desc.usage;
		this.mipLevelCount = desc.mipLevelCount ?? 1;
		this.sampleCount = desc.sampleCount ?? 1;
		this.label = desc.label;
		this.owned = owned;
	}

	/** True if `destroy()` has been called on this wrapper. */
	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	static create2D(device: Device | GPUDevice, desc: TextureDescriptor): Texture {
		if (!Number.isInteger(desc.width) || desc.width < 1 || !Number.isInteger(desc.height) || desc.height < 1) {
			throw new RangeError(
				`Texture.create2D: width (${desc.width}) and height (${desc.height}) must be positive integers.`
			);
		}
		const sampleCount = desc.sampleCount ?? 1;
		if (sampleCount !== 1 && sampleCount !== 4) {
			throw new RangeError(`Texture.create2D: sampleCount must be 1 or 4, got ${sampleCount}.`);
		}
		const mipLevelCount = desc.mipLevelCount ?? 1;
		if (!Number.isInteger(mipLevelCount) || mipLevelCount < 1) {
			throw new RangeError(`Texture.create2D: mipLevelCount must be a positive integer, got ${mipLevelCount}.`);
		}
		const defaultUsage = sampleCount > 1
			? TEXTURE_USAGE_RENDER_ATTACHMENT
			: (TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER_ATTACHMENT);
		const usage = desc.usage ?? defaultUsage;

		if (sampleCount > 1) {
			if (mipLevelCount > 1) {
				throw new Error("Texture.create2D: multisampled textures (sampleCount > 1) cannot have mipLevelCount > 1.");
			}
			if ((usage & TEXTURE_USAGE_STORAGE_BINDING) !== 0) {
				throw new Error("Texture.create2D: multisampled textures cannot have STORAGE_BINDING usage.");
			}
			if ((usage & (TEXTURE_USAGE_COPY_SRC | TEXTURE_USAGE_COPY_DST)) !== 0) {
				throw new Error("Texture.create2D: multisampled textures cannot have COPY_SRC or COPY_DST usage.");
			}
			if ((usage & TEXTURE_USAGE_RENDER_ATTACHMENT) === 0) {
				throw new Error("Texture.create2D: multisampled textures must include RENDER_ATTACHMENT usage.");
			}
		}

		const rawDevice = resolveDevice(device);
		const native = rawDevice.createTexture({
			label: desc.label,
			size: {
				width: desc.width,
				height: desc.height,
				depthOrArrayLayers: desc.depthOrArrayLayers ?? 1,
			},
			mipLevelCount,
			sampleCount,
			dimension: desc.dimension ?? "2d",
			format: desc.format,
			usage,
			viewFormats: desc.viewFormats,
		});
		return new Texture(native, { ...desc, usage }, true);
	}

	static createDepth(
		device: Device | GPUDevice,
		widthOrDesc: number | DepthTextureDescriptor,
		height?: number,
		format: GPUTextureFormat = "depth24plus",
		sampleCount = 1,
		label?: string
	): Texture {
		if (typeof widthOrDesc === "object" && widthOrDesc !== null) {
			const sc = widthOrDesc.sampleCount ?? 1;
			const usage = widthOrDesc.usage ?? TEXTURE_USAGE_RENDER_ATTACHMENT;
			return Texture.create2D(device, {
				width: widthOrDesc.width,
				height: widthOrDesc.height,
				format: widthOrDesc.format ?? "depth24plus",
				sampleCount: sc,
				usage,
				label: widthOrDesc.label ?? "Awgpu_DepthTexture",
			});
		}
		return Texture.create2D(device, {
			width: widthOrDesc,
			height: height!,
			format,
			sampleCount,
			usage: TEXTURE_USAGE_RENDER_ATTACHMENT,
			label: label ?? "Awgpu_DepthTexture",
		});
	}

	/**
	 * Wraps an existing native `GPUTexture`.
	 * Defaults to `owned: false` (borrowed); `destroy()` will not destroy a borrowed `GPUTexture`.
	 */
	static fromNative(
		native: GPUTexture,
		desc?: Partial<TextureDescriptor>,
		options: { owned?: boolean } = {}
	): Texture {
		return new Texture(
			native,
			{
				width: desc?.width ?? native.width,
				height: desc?.height ?? native.height,
				depthOrArrayLayers: desc?.depthOrArrayLayers ?? native.depthOrArrayLayers,
				format: desc?.format ?? native.format,
				usage: desc?.usage ?? native.usage,
				mipLevelCount: desc?.mipLevelCount ?? native.mipLevelCount,
				sampleCount: desc?.sampleCount ?? native.sampleCount,
				label: desc?.label ?? native.label,
			},
			options.owned ?? false
		);
	}

	/** Default `GPUTextureView` for this texture (registered with this texture as its backing owner). */
	get view(): GPUTextureView {
		if (!this.#defaultView) {
			this.#defaultView = getOrCreateDefaultTextureView(this.native);
		}
		return this.#defaultView;
	}

	/** Creates a custom `GPUTextureView` and registers this texture as its backing owner for `PassGraph`. */
	createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView {
		const view = this.native.createView(descriptor);
		registerTextureViewOwner(view, this.native);
		return view;
	}

	/**
	 * Writes 2D texel data into this texture via `queue.writeTexture`.
	 *
	 * Contract:
	 * - Supports uncompressed formats listed in `UNCOMPRESSED_TEXTURE_FORMAT_BPP` (or explicit `options.bytesPerPixel`).
	 * - Defaults `bytesPerRow` to tight packing (`width * bytesPerPixel`); `queue.writeTexture` does not require
	 *   256-byte row alignment.
	 * - Validates `dataOffset`, `bytesPerRow >= width * bytesPerPixel`, `rowsPerImage >= height`, and verifies that
	 *   `data` contains all required bytes for the upload region before calling WebGPU.
	 */
	write2D(
		device: Device | GPUDevice,
		data: BufferSource | SharedArrayBuffer,
		options: TextureWriteOptions = {}
	): void {
		if (this.#destroyed) {
			throw new Error("Texture.write2D: cannot write to a destroyed Texture.");
		}
		if ((this.usage & TEXTURE_USAGE_COPY_DST) === 0) {
			throw new Error("Texture.write2D: texture must be created with GPUTextureUsage.COPY_DST.");
		}

		const bpp = options.bytesPerPixel ?? UNCOMPRESSED_TEXTURE_FORMAT_BPP[this.format];
		if (bpp === undefined || !Number.isInteger(bpp) || bpp < 1) {
			throw new Error(
				`Texture.write2D: unsupported or compressed/depth texture format '${this.format}' without a valid explicit bytesPerPixel.`
			);
		}

		const w = options.width ?? this.width;
		const h = options.height ?? this.height;
		const d = options.depthOrArrayLayers ?? 1;
		const mipLevel = options.mipLevel ?? 0;
		const dataOffset = options.dataOffset ?? 0;

		assertNonNegativeInteger(w, "Texture.write2D width");
		assertNonNegativeInteger(h, "Texture.write2D height");
		assertNonNegativeInteger(d, "Texture.write2D depthOrArrayLayers");
		assertNonNegativeInteger(mipLevel, "Texture.write2D mipLevel");
		assertNonNegativeInteger(dataOffset, "Texture.write2D dataOffset");

		if (w === 0 || h === 0 || d === 0) {
			return;
		}

		const mipWidth = Math.max(1, this.width >>> mipLevel);
		const mipHeight = Math.max(1, this.height >>> mipLevel);
		if (w > mipWidth || h > mipHeight || d > this.depthOrArrayLayers) {
			throw new RangeError(
				`Texture.write2D: upload region (${w}x${h}x${d}) exceeds mip ${mipLevel} bounds (${mipWidth}x${mipHeight}x${this.depthOrArrayLayers}).`
			);
		}

		const tightBytesPerRow = w * bpp;
		const bytesPerRow = options.bytesPerRow ?? tightBytesPerRow;
		const rowsPerImage = options.rowsPerImage ?? h;

		assertNonNegativeInteger(bytesPerRow, "Texture.write2D bytesPerRow");
		assertNonNegativeInteger(rowsPerImage, "Texture.write2D rowsPerImage");

		if (bytesPerRow < tightBytesPerRow) {
			throw new RangeError(
				`Texture.write2D: bytesPerRow (${bytesPerRow}) is smaller than tight row byte length (${tightBytesPerRow}).`
			);
		}
		if (rowsPerImage < h) {
			throw new RangeError(
				`Texture.write2D: rowsPerImage (${rowsPerImage}) is smaller than upload height (${h}).`
			);
		}

		const span = normalizeBufferSource(data);
		if (dataOffset > span.byteLength) {
			throw new RangeError(
				`Texture.write2D: dataOffset (${dataOffset}) exceeds data byteLength (${span.byteLength}).`
			);
		}

		const bytesPerImage = bytesPerRow * rowsPerImage;
		const requiredBytes = (d - 1) * bytesPerImage + (h - 1) * bytesPerRow + tightBytesPerRow;
		const availableBytes = span.byteLength - dataOffset;
		if (availableBytes < requiredBytes) {
			throw new RangeError(
				`Texture.write2D: source buffer has ${availableBytes} available bytes from offset ${dataOffset}, but upload of ${w}x${h}x${d} (${this.format}, bytesPerRow=${bytesPerRow}) requires at least ${requiredBytes} bytes.`
			);
		}

		const rawDevice = resolveDevice(device);
		const byteView = new Uint8Array(span.buffer, span.byteOffset + dataOffset, availableBytes);
		rawDevice.queue.writeTexture(
			{
				texture: this.native,
				mipLevel,
				origin: options.origin ?? { x: 0, y: 0, z: 0 },
			},
			byteView as unknown as BufferSource,
			{
				offset: 0,
				bytesPerRow,
				rowsPerImage,
			},
			{
				width: w,
				height: h,
				depthOrArrayLayers: d,
			}
		);
	}

	/**
	 * Destroys the underlying `GPUTexture` if `owned` is true.
	 * Idempotent; never destroys borrowed native textures.
	 */
	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		this.#defaultView = null;
		if (this.owned) {
			_defaultTextureView.delete(this.native);
			this.native.destroy();
		}
	}
}

interface PoolBucket {
	buffers: Buffer[];
	cursor: number;
}

/**
 * Power-of-two bucketed GPU `Buffer` pool scoped to a single `GPUDevice`.
 *
 * Lifetime contract:
 * - Construct via `new BufferPool(device, usage, labelPrefix)` (or `new BufferPool(usage, labelPrefix)`
 *   which binds to the device passed on first `acquire`).
 * - `acquire(minByteSize)` (or `acquire(device, minByteSize)`) returns a `Buffer` owned by this pool.
 *   Passing a different `GPUDevice` than the pool's bound device throws an Error.
 * - `reset()` marks all pooled buffers as reusable from the start of each bucket. Callers must only
 *   call `reset()` after all command buffers referencing previously acquired buffers have been submitted
 *   to `device.queue` (relying on WebGPU same-queue ordering for subsequent `queue.writeBuffer` calls).
 * - `destroy()` destroys all buffers owned by the pool without destroying the borrowed `GPUDevice`.
 */
export class BufferPool {
	#device: GPUDevice | null = null;
	readonly usage: GPUBufferUsageFlags;
	readonly labelPrefix: string;
	readonly #buckets = new Map<number, PoolBucket>();
	#allocatedCount = 0;
	#destroyed = false;

	constructor(
		deviceOrUsage: Device | GPUDevice | GPUBufferUsageFlags = BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
		usageOrLabel?: GPUBufferUsageFlags | string,
		labelPrefix = "Awgpu_PoolBuffer"
	) {
		if (typeof deviceOrUsage === "number") {
			this.usage = deviceOrUsage;
			this.labelPrefix = typeof usageOrLabel === "string" ? usageOrLabel : labelPrefix;
		} else {
			this.#device = resolveDevice(deviceOrUsage);
			this.usage = typeof usageOrLabel === "number"
				? usageOrLabel
				: (BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST);
			this.labelPrefix = labelPrefix;
		}
	}

	/** Native `GPUDevice` bound to this pool, or null if not yet bound. */
	get device(): GPUDevice | null {
		return this.#device;
	}

	/** Total number of `Buffer` instances currently owned by this pool. */
	get allocatedCount(): number {
		return this.#allocatedCount;
	}

	/** True if `destroy()` has been called on this pool. */
	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	#resolvePoolDevice(deviceArg?: Device | GPUDevice): GPUDevice {
		if (deviceArg !== undefined) {
			const raw = resolveDevice(deviceArg);
			if (this.#device === null) {
				this.#device = raw;
			} else if (this.#device !== raw) {
				throw new Error("BufferPool.acquire: cannot acquire from a BufferPool using a different GPUDevice.");
			}
			return raw;
		}
		if (this.#device === null) {
			throw new Error("BufferPool.acquire: pool has no bound GPUDevice; pass a device to constructor or acquire().");
		}
		return this.#device;
	}

	/**
	 * Acquires a `Buffer` of at least `minByteSize` bytes (rounded up to a power of two >= 256).
	 */
	acquire(minByteSize: number): Buffer;
	acquire(device: Device | GPUDevice, minByteSize: number): Buffer;
	acquire(deviceOrSize: Device | GPUDevice | number, maybeSize?: number): Buffer {
		if (this.#destroyed) {
			throw new Error("BufferPool.acquire: cannot acquire from a destroyed BufferPool.");
		}
		let rawDevice: GPUDevice;
		let minByteSize: number;
		if (typeof deviceOrSize === "number") {
			rawDevice = this.#resolvePoolDevice();
			minByteSize = deviceOrSize;
		} else {
			rawDevice = this.#resolvePoolDevice(deviceOrSize);
			minByteSize = maybeSize!;
		}

		if (!Number.isInteger(minByteSize) || minByteSize < 0) {
			throw new RangeError(`BufferPool.acquire: minByteSize must be a non-negative integer, got ${minByteSize}.`);
		}

		let capacity = 256;
		while (capacity < minByteSize) {
			capacity *= 2;
		}

		let bucket = this.#buckets.get(capacity);
		if (!bucket) {
			bucket = { buffers: [], cursor: 0 };
			this.#buckets.set(capacity, bucket);
		}

		if (bucket.cursor < bucket.buffers.length) {
			return bucket.buffers[bucket.cursor++];
		}

		const buf = Buffer.create(rawDevice, {
			size: capacity,
			usage: this.usage,
			label: `${this.labelPrefix}_${capacity}B_${bucket.buffers.length}`,
		});
		bucket.buffers.push(buf);
		bucket.cursor++;
		this.#allocatedCount++;
		return buf;
	}

	/**
	 * Resets bucket cursors so pooled buffers can be reused.
	 * Must only be called after prior command encoders referencing pooled buffers have been submitted.
	 */
	reset(): void {
		for (const bucket of this.#buckets.values()) {
			bucket.cursor = 0;
		}
	}

	/**
	 * Destroys all `Buffer` instances owned by this pool and clears all buckets.
	 * Does not destroy the borrowed `GPUDevice`. Idempotent.
	 */
	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		for (const bucket of this.#buckets.values()) {
			for (const buf of bucket.buffers) {
				buf.destroy();
			}
		}
		this.#buckets.clear();
		this.#allocatedCount = 0;
	}
}

export type BufferSourceData = BufferSource | SharedArrayBuffer;

export interface ResolvedBuffer {
	buffer: GPUBuffer;
	offset: number;
	size: number;
}

/**
 * Wrapper around a WebGPU `GPUSampler`.
 */
export class Sampler {
	readonly native: GPUSampler;
	readonly label?: string;

	constructor(device: Device | GPUDevice, desc: GPUSamplerDescriptor = {}) {
		const rawDevice = resolveDevice(device);
		this.label = desc.label;
		this.native = rawDevice.createSampler(desc);
	}

	static create(device: Device | GPUDevice, desc: GPUSamplerDescriptor = {}): Sampler {
		return new Sampler(device, desc);
	}

	static fromNative(native: GPUSampler, label?: string): Sampler {
		const instance = Object.create(Sampler.prototype) as Sampler;
		Object.defineProperties(instance, {
			native: { value: native, enumerable: true },
			label: { value: label ?? native.label, enumerable: true },
		});
		return instance;
	}
}

/**
 * Resolves a `Buffer`, `BufferSlice`, or raw `GPUBuffer` into `(buffer, offset, size)` without allocation
 * when `out` is provided.
 */
export function resolveBuffer(
	ref: Buffer | BufferSlice | GPUBuffer,
	out?: ResolvedBuffer
): ResolvedBuffer {
	const target = out ?? { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };
	if (ref instanceof Buffer) {
		target.buffer = ref.native;
		target.offset = 0;
		target.size = ref.size;
	} else if (isBufferSlice(ref)) {
		target.buffer = ref.buffer.native;
		target.offset = ref.offset;
		target.size = ref.size;
	} else {
		target.buffer = ref;
		target.offset = 0;
		target.size = ref.size;
	}
	return target;
}

/**
 * Resolves a `Texture` wrapper or raw `GPUTexture` to its underlying `GPUTexture`.
 */
export function resolveTexture(tex: Texture | GPUTexture): GPUTexture {
	return tex instanceof Texture ? tex.native : tex;
}

/**
 * Resolves a `Texture`, `GPUTexture`, or `GPUTextureView` into a `GPUTextureView`.
 */
export function resolveTextureView(tex: Texture | GPUTexture | GPUTextureView): GPUTextureView {
	if (tex instanceof Texture) {
		return tex.view;
	}
	if ("createView" in tex && typeof tex.createView === "function") {
		return getOrCreateDefaultTextureView(tex as GPUTexture);
	}
	return tex as GPUTextureView;
}

/**
 * Resolves a `Sampler` wrapper or raw `GPUSampler` to its underlying `GPUSampler`.
 */
export function resolveSampler(sampler: Sampler | GPUSampler): GPUSampler {
	return sampler instanceof Sampler ? sampler.native : sampler;
}
