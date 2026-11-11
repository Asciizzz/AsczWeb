import {
	Buffer,
	type BufferSlice,
	isBufferSlice,
	Texture,
	getRegisteredTextureViewOwner,
	resolveTextureView as resolveMemoryTextureView,
} from "./memory.js";
import { getResourceId } from "./device.js";

export type BufferSourceRef = Buffer | BufferSlice | GPUBuffer;
export type TextureSourceRef = Texture | GPUTexture | GPUTextureView;

/**
 * Valid WebGPU vertex attribute formats mapped to their byte sizes.
 */
export const VERTEX_FORMAT_BYTE_SIZES: Readonly<Record<string, number>> = Object.freeze({
	"uint8x2": 2,
	"uint8x4": 4,
	"sint8x2": 2,
	"sint8x4": 4,
	"unorm8x2": 2,
	"unorm8x4": 4,
	"snorm8x2": 2,
	"snorm8x4": 4,
	"uint16x2": 4,
	"uint16x4": 8,
	"sint16x2": 4,
	"sint16x4": 8,
	"unorm16x2": 4,
	"unorm16x4": 8,
	"snorm16x2": 4,
	"snorm16x4": 8,
	"float16x2": 4,
	"float16x4": 8,
	"float32": 4,
	"float32x2": 8,
	"float32x3": 12,
	"float32x4": 16,
	"uint32": 4,
	"uint32x2": 8,
	"uint32x3": 12,
	"uint32x4": 16,
	"sint32": 4,
	"sint32x2": 8,
	"sint32x3": 12,
	"sint32x4": 16,
	"unorm10-10-10-2": 4,
});

export const VERTEX_FORMAT_SIZES = VERTEX_FORMAT_BYTE_SIZES;

/**
 * Returns the byte size of a valid `GPUVertexFormat`, or throws an Error if the format is unrecognized.
 */
export function getVertexFormatByteSize(format: GPUVertexFormat): number {
	const size = VERTEX_FORMAT_BYTE_SIZES[format as string];
	if (size === undefined) {
		throw new Error(`Unsupported or malformed GPUVertexFormat: '${String(format)}'.`);
	}
	return size;
}

/**
 * Resolves a `Buffer`, `BufferSlice`, or raw `GPUBuffer` into `(buffer, offset, size)` without allocation
 * when `out` is provided.
 */
export function resolveBuffer(
	ref: BufferSourceRef,
	out?: { buffer: GPUBuffer; offset: number; size: number }
): { buffer: GPUBuffer; offset: number; size: number } {
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
 * Resolves a `Texture`, `GPUTexture`, or `GPUTextureView` into a `GPUTextureView`.
 * For raw `GPUTexture` inputs, reuses a cached default view per `GPUTexture`.
 */
export function resolveTextureView(ref: TextureSourceRef): GPUTextureView {
	return resolveMemoryTextureView(ref);
}

/**
 * Resolves any buffer, slice, texture, or texture view into the logical backing resource ID
 * of its underlying `GPUBuffer` or `GPUTexture` (when registered).
 */
export function resolveLogicalResourceId(res: object): number {
	if (res instanceof Buffer) {
		return getResourceId(res.native);
	}
	if (isBufferSlice(res)) {
		return getResourceId(res.buffer.native);
	}
	if (res instanceof Texture) {
		return getResourceId(res.native);
	}
	const ownerTex = getRegisteredTextureViewOwner(res as GPUTextureView);
	if (ownerTex) {
		return getResourceId(ownerTex);
	}
	return getResourceId(res);
}

/**
 * Vertex attribute and buffer-slot stream descriptor.
 *
 * Offset separation contract:
 * - `offset` is the attribute byte offset within a single vertex stride (`GPUVertexAttribute.offset`).
 * - `bufferOffset` (defaults to 0) is an optional byte offset added to the source buffer/slice base offset
 *   when binding the vertex buffer via `pass.setVertexBuffer`.
 */
export interface VertexStream {
	/** Vertex buffer slot index (0..maxVertexBuffers-1). */
	slot: number;
	/** Shader attribute location (`@location(location)`). */
	location: number;
	/** Vertex attribute format (for example `"float32x3"`). */
	format: GPUVertexFormat;
	/** Backing buffer or buffer slice. */
	source: BufferSourceRef;
	/** Attribute byte offset within the vertex stride (`GPUVertexAttribute.offset`). Defaults to 0. */
	offset?: number;
	/** Optional additional byte offset applied when binding `source` in `setVertexBuffer`. Defaults to 0. */
	bufferOffset?: number;
	/** Explicit byte stride per vertex or instance. If omitted, derived from maximum attribute end in the slot. */
	stride?: number;
	/** Step mode (`"vertex"` or `"instance"`). Defaults to `"vertex"`. */
	stepMode?: GPUVertexStepMode;
}

/**
 * Index buffer stream descriptor.
 */
export interface IndexStream {
	source: BufferSourceRef;
	format: GPUIndexFormat;
	/** Additional byte offset into `source` applied when binding the index buffer. Defaults to 0. */
	offset?: number;
	/** Optional default index count when not overridden on DrawBatch. */
	count?: number;
	/** Optional default firstIndex when not overridden on DrawBatch. */
	firstIndex?: number;
	/** Optional default baseVertex when not overridden on DrawBatch. */
	baseVertex?: number;
}

/**
 * Collection of vertex attribute streams and an optional index stream.
 */
export class StreamSet {
	readonly vertexStreams: VertexStream[] = [];
	indexStream: IndexStream | null = null;
	vertexCount?: number;
	instanceCount = 1;
	firstVertex = 0;
	firstInstance = 0;

	/** Alias for `vertexStreams`. */
	get streams(): ReadonlyArray<VertexStream> {
		return this.vertexStreams;
	}

	/**
	 * Appends a validated `VertexStream` descriptor directly.
	 */
	add(stream: VertexStream): this {
		if (!Number.isInteger(stream.slot) || stream.slot < 0) {
			throw new RangeError(`StreamSet.add: slot must be a non-negative integer, got ${stream.slot}.`);
		}
		if (!Number.isInteger(stream.location) || stream.location < 0) {
			throw new RangeError(`StreamSet.add: location must be a non-negative integer, got ${stream.location}.`);
		}
		const attrSize = getVertexFormatByteSize(stream.format);
		const attrOffset = stream.offset ?? 0;
		if (!Number.isInteger(attrOffset) || attrOffset < 0) {
			throw new RangeError(`StreamSet.add: offset must be a non-negative integer, got ${attrOffset}.`);
		}
		const bufferOffset = stream.bufferOffset ?? 0;
		if (!Number.isInteger(bufferOffset) || bufferOffset < 0) {
			throw new RangeError(`StreamSet.add: bufferOffset must be a non-negative integer, got ${bufferOffset}.`);
		}
		if (stream.stride !== undefined) {
			if (!Number.isInteger(stream.stride) || stream.stride < attrOffset + attrSize) {
				throw new RangeError(
					`StreamSet.add: stride (${stream.stride}) must be an integer >= offset + formatSize (${attrOffset + attrSize}).`
				);
			}
		}
		this.vertexStreams.push({
			...stream,
			offset: attrOffset,
			bufferOffset,
			stepMode: stream.stepMode ?? "vertex",
		});
		return this;
	}

	/**
	 * Adds a tightly packed vertex buffer stream at `slot` and `location` where stride equals format size
	 * and attribute offset is 0.
	 */
	addVertex(
		slot: number,
		location: number,
		format: GPUVertexFormat,
		source: BufferSourceRef,
		stepMode: GPUVertexStepMode = "vertex"
	): this {
		if (!Number.isInteger(slot) || slot < 0) {
			throw new RangeError(`StreamSet.addVertex: slot must be a non-negative integer, got ${slot}.`);
		}
		if (!Number.isInteger(location) || location < 0) {
			throw new RangeError(`StreamSet.addVertex: location must be a non-negative integer, got ${location}.`);
		}
		const stride = getVertexFormatByteSize(format);
		this.vertexStreams.push({
			slot,
			location,
			format,
			source,
			offset: 0,
			bufferOffset: 0,
			stride,
			stepMode,
		});
		return this;
	}

	/**
	 * Adds an interleaved vertex attribute stream with explicit `byteOffset` (attribute offset within stride)
	 * and `byteStride`.
	 */
	addInterleavedVertex(
		slot: number,
		location: number,
		format: GPUVertexFormat,
		source: BufferSourceRef,
		byteOffset: number,
		byteStride: number,
		stepMode: GPUVertexStepMode = "vertex",
		bufferOffset = 0
	): this {
		if (!Number.isInteger(slot) || slot < 0) {
			throw new RangeError(`StreamSet.addInterleavedVertex: slot must be a non-negative integer, got ${slot}.`);
		}
		if (!Number.isInteger(location) || location < 0) {
			throw new RangeError(`StreamSet.addInterleavedVertex: location must be a non-negative integer, got ${location}.`);
		}
		if (!Number.isInteger(byteOffset) || byteOffset < 0) {
			throw new RangeError(`StreamSet.addInterleavedVertex: byteOffset must be a non-negative integer, got ${byteOffset}.`);
		}
		if (!Number.isInteger(byteStride) || byteStride < 0) {
			throw new RangeError(`StreamSet.addInterleavedVertex: byteStride must be a non-negative integer, got ${byteStride}.`);
		}
		if (!Number.isInteger(bufferOffset) || bufferOffset < 0) {
			throw new RangeError(`StreamSet.addInterleavedVertex: bufferOffset must be a non-negative integer, got ${bufferOffset}.`);
		}
		const attrSize = getVertexFormatByteSize(format);
		if (byteOffset + attrSize > byteStride) {
			throw new RangeError(
				`StreamSet.addInterleavedVertex: attribute end (${byteOffset + attrSize}) exceeds byteStride (${byteStride}).`
			);
		}
		this.vertexStreams.push({
			slot,
			location,
			format,
			source,
			offset: byteOffset,
			bufferOffset,
			stride: byteStride,
			stepMode,
		});
		return this;
	}

	/** Sets the index buffer stream. */
	setIndex(
		source: BufferSourceRef,
		format: GPUIndexFormat = "uint32",
		offset = 0,
		count?: number,
		firstIndex = 0,
		baseVertex = 0
	): this {
		if (format !== "uint16" && format !== "uint32") {
			throw new Error(`StreamSet.setIndex: invalid GPUIndexFormat '${String(format)}'.`);
		}
		if (!Number.isInteger(offset) || offset < 0) {
			throw new RangeError(`StreamSet.setIndex: offset must be a non-negative integer, got ${offset}.`);
		}
		const align = format === "uint32" ? 4 : 2;
		if (offset % align !== 0) {
			throw new RangeError(
				`StreamSet.setIndex: offset (${offset}) must be aligned to ${align} bytes for format '${format}'.`
			);
		}
		this.indexStream = { source, format, offset, count, firstIndex, baseVertex };
		return this;
	}

	/** Alias for `deriveVertexLayouts()`. */
	toBufferLayouts(): GPUVertexBufferLayout[] {
		return this.deriveVertexLayouts();
	}

	/**
	 * Derives `GPUVertexBufferLayout[]` sorted by slot index.
	 * Validates all attribute formats, offsets, and strides; derives stride from the maximum
	 * attribute end (`offset + formatByteSize`) when explicit `stride` is omitted.
	 */
	deriveVertexLayouts(): GPUVertexBufferLayout[] {
		const slotMap = new Map<number, VertexStream[]>();
		for (let i = 0; i < this.vertexStreams.length; i++) {
			const stream = this.vertexStreams[i];
			if (!Number.isInteger(stream.slot) || stream.slot < 0) {
				throw new RangeError(`Invalid vertex stream slot: ${stream.slot}.`);
			}
			let group = slotMap.get(stream.slot);
			if (!group) {
				group = [];
				slotMap.set(stream.slot, group);
			}
			group.push(stream);
		}

		const sortedSlots = Array.from(slotMap.keys()).sort((a, b) => a - b);
		const layouts: GPUVertexBufferLayout[] = [];

		for (const slot of sortedSlots) {
			const group = slotMap.get(slot)!;
			const attributes: GPUVertexAttribute[] = [];
			let maxAttrEnd = 0;
			let explicitStride: number | undefined;
			let stepMode: GPUVertexStepMode = group[0].stepMode ?? "vertex";

			for (const stream of group) {
				const attrSize = getVertexFormatByteSize(stream.format);
				const attrOffset = stream.offset ?? 0;
				if (!Number.isInteger(attrOffset) || attrOffset < 0) {
					throw new RangeError(`Invalid vertex attribute offset: ${attrOffset}.`);
				}
				const attrEnd = attrOffset + attrSize;
				if (attrEnd > maxAttrEnd) {
					maxAttrEnd = attrEnd;
				}
				if (stream.stride !== undefined) {
					if (!Number.isInteger(stream.stride) || stream.stride < 0) {
						throw new RangeError(`Invalid vertex stream stride: ${stream.stride}.`);
					}
					if (explicitStride !== undefined && explicitStride !== stream.stride) {
						throw new Error(
							`Conflicting explicit strides (${explicitStride} vs ${stream.stride}) in vertex buffer slot ${slot}.`
						);
					}
					explicitStride = stream.stride;
				}
				attributes.push({
					shaderLocation: stream.location,
					offset: attrOffset,
					format: stream.format,
				});
			}

			const finalStride = explicitStride ?? maxAttrEnd;
			if (finalStride < maxAttrEnd) {
				throw new RangeError(
					`Explicit vertex stride (${finalStride}) in slot ${slot} is smaller than maximum attribute end (${maxAttrEnd}).`
				);
			}

			layouts.push({
				arrayStride: finalStride,
				stepMode,
				attributes,
			});
		}

		return layouts;
	}
}
