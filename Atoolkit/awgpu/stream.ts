// ================================================================
//  Awgpu - Level 2: Composable Data Streams (StreamSet)
// ================================================================

import type { Buffer, BufferSlice } from "./memory.js";

export const VERTEX_FORMAT_SIZES: Record<string, number> = {
    float32: 4,
    float32x2: 8,
    float32x3: 12,
    float32x4: 16,
    uint32: 4,
    uint32x2: 8,
    uint32x4: 16,
    sint32: 4,
    sint32x2: 8,
    sint32x4: 16,
    unorm8x4: 4,
    snorm8x4: 4,
    uint8x4: 4,
    sint8x4: 4,
    unorm16x2: 4,
    snorm16x2: 4,
    uint16x2: 4,
    sint16x2: 4,
    unorm16x4: 8,
    snorm16x4: 8,
    uint16x4: 8,
    sint16x4: 8,
    float16x2: 4,
    float16x4: 8,
};

export interface VertexStream {
    slot: number;
    shaderLocation?: number;
    source: GPUBuffer | Buffer | BufferSlice;
    format: GPUVertexFormat;
    offset?: number;
    stepMode?: GPUVertexStepMode;
}

export interface IndexStream {
    source: GPUBuffer | Buffer | BufferSlice;
    format: GPUIndexFormat;
    count: number;
    offset?: number;
    firstIndex?: number;
    baseVertex?: number;
}

/**
 * Domain-agnostic compound data stream descriptor.
 * Groups 1-N VertexStream definitions (slot, shaderLocation, buffer source, format) and an
 * optional IndexStream. Call deriveVertexLayouts() to produce (GPUVertexBufferLayout | null)[] for
 * pipeline compilation.
 */
export class StreamSet {
    readonly streams: VertexStream[] = [];
    readonly slotStrides = new Map<number, number>();
    indexStream?: IndexStream;
    vertexCount?: number;
    instanceCount = 1;
    firstVertex = 0;
    firstInstance = 0;

    /**
     * Appends vertex buffer stream to the set.
     * - slot: GPU buffer binding slot (setVertexBuffer index).
     * - shaderLocation: WGSL @location attribute index. Defaults to slot for planar layouts.
     *   Must be set explicitly for interleaved streams sharing the same slot.
     */
    addStream(
        slot: number,
        source: GPUBuffer | Buffer | BufferSlice,
        format: GPUVertexFormat,
        offset = 0,
        stepMode: GPUVertexStepMode = "vertex",
        shaderLocation?: number
    ): this {
        this.streams.push({
            slot,
            shaderLocation,
            source,
            format,
            offset,
            stepMode,
        });
        return this;
    }

    /**
     * Configures explicit byte stride for a specific buffer slot.
     * Overrides automatic stride calculation from attribute offsets.
     */
    setSlotStride(slot: number, stride: number): this {
        this.slotStrides.set(slot, stride);
        return this;
    }

    /**
     * Configures the index buffer stream.
     */
    setIndices(
        source: GPUBuffer | Buffer | BufferSlice,
        format: GPUIndexFormat,
        count: number,
        offset = 0,
        firstIndex = 0,
        baseVertex = 0
    ): this {
        this.indexStream = {
            source,
            format,
            count,
            offset,
            firstIndex,
            baseVertex,
        };
        return this;
    }

    /**
     * Produces (GPUVertexBufferLayout | null)[] for pipeline compilation.
     * Groups streams by slot, maps them to exact slot indices, computes cumulative byte
     * offsets per attribute, and aligns arrayStride to a 4-byte boundary. Unused intermediate
     * slots are populated with null to preserve slot-to-index alignment required by WebGPU.
     */
    deriveVertexLayouts(): (GPUVertexBufferLayout | null)[] {
        if (this.streams.length === 0) return [];

        // Group streams by buffer binding slot
        const slotMap = new Map<number, VertexStream[]>();
        let maxSlot = 0;
        for (const s of this.streams) {
            let list = slotMap.get(s.slot);
            if (!list) {
                list = [];
                slotMap.set(s.slot, list);
            }
            list.push(s);
            if (s.slot > maxSlot) maxSlot = s.slot;
        }

        const layouts: (GPUVertexBufferLayout | null)[] = new Array(maxSlot + 1).fill(null);
        for (const [slot, streamList] of slotMap.entries()) {
            let currentOffset = 0;
            const attributes: GPUVertexAttribute[] = [];
            let stepMode: GPUVertexStepMode = "vertex";

            for (let i = 0; i < streamList.length; i++) {
                const stream = streamList[i];
                stepMode = stream.stepMode ?? "vertex";
                const offset = stream.offset ?? currentOffset;
                // shaderLocation is the WGSL @location index and is independent of slot.
                // For planar layouts (one attribute per slot), slot == shaderLocation by convention.
                // For interleaved layouts, each attribute inside the slot gets a unique location.
                const shaderLocation = stream.shaderLocation ?? (slot + i);
                attributes.push({
                    shaderLocation,
                    format: stream.format,
                    offset,
                });
                const size = VERTEX_FORMAT_SIZES[stream.format] ?? 4;
                currentOffset = offset + size;
            }

            const explicitStride = this.slotStrides.get(slot);
            const arrayStride = explicitStride !== undefined
                ? Math.max(4, Math.ceil(explicitStride / 4) * 4)
                : Math.max(4, Math.ceil(currentOffset / 4) * 4);

            layouts[slot] = {
                arrayStride,
                stepMode,
                attributes,
            };
        }

        return layouts;
    }
}
