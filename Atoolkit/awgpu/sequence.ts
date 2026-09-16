// ================================================================
//  Awgpu - Level 5: Command Sequencing (RenderPassNode, ComputePassNode, PassSequence)
// ================================================================

import { type Device, resolveDevice, resolveQueue } from "./device.js";
import { resolveBuffer, type ResolvedBuffer, type Buffer } from "./memory.js";
import type { Target } from "./target.js";
import type { StreamSet } from "./stream.js";
import type { BindTable } from "./binding.js";
import type { RasterPipeline, ComputePipeline } from "./pipeline.js";

export type DynamicOffsetRecord =
    | Record<number, Iterable<number>>
    | (Iterable<number> | undefined)[];

export interface DrawBatch {
    pipeline: RasterPipeline;
    streamSet?: StreamSet;
    bindTables?: (BindTable | GPUBindGroup | null | undefined)[];
    vertexCount?: number;
    indexCount?: number;
    instanceCount?: number;
    firstVertex?: number;
    firstInstance?: number;
    firstIndex?: number;
    baseVertex?: number;
    dynamicOffsets?: DynamicOffsetRecord;
    indirect?: {
        buffer: GPUBuffer | Buffer;
        offset?: number;
    };
}

export interface ComputeBatch {
    pipeline: ComputePipeline;
    workgroups?: [number, number, number];
    bindTables?: (BindTable | GPUBindGroup | null | undefined)[];
    dynamicOffsets?: DynamicOffsetRecord;
    indirect?: {
        buffer: GPUBuffer | Buffer;
        offset?: number;
    };
}

function resolveGpuBindGroup(bg: BindTable | GPUBindGroup | null | undefined): GPUBindGroup | null {
    if (!bg) return null;
    return "native" in bg ? bg.native : bg;
}

function resolveSlotOffsets(
    offsets: DynamicOffsetRecord | undefined,
    slot: number
): number[] | undefined {
    if (!offsets) return undefined;
    const item = Array.isArray(offsets)
        ? offsets[slot]
        : (offsets as Record<number, Iterable<number>>)[slot];
    if (!item) return undefined;
    // Skip Array.from copy when item is already a number[].
    return Array.isArray(item) ? item : Array.from(item);
}

/**
 * Encapsulates a self-contained render pass with redundant driver state filtering.
 */
export class RenderPassNode {
    readonly label: string;
    target: Target;
    readonly draws: DrawBatch[] = [];

    private _customRecorder?: (pass: GPURenderPassEncoder) => void;
    private _activeBindGroups: (GPUBindGroup | null)[] = new Array(8).fill(null);
    private _activeHasDynamicOffsets: boolean[] = new Array(8).fill(false);
    private _activeVbos: (GPUBuffer | null)[] = [];
    private _activeVboOffsets: number[] = [];
    private _scratchResolved: ResolvedBuffer = { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };

    constructor(target: Target, label = "RenderPassNode") {
        this.target = target;
        this.label = label;
    }

    addDraw(batch: DrawBatch): this {
        this.draws.push(batch);
        return this;
    }

    /**
     * Registers custom imperative hardware recording callback, bypassing queued batch list.
     */
    record(recorder: (pass: GPURenderPassEncoder) => void): this {
        this._customRecorder = recorder;
        return this;
    }

    clear(): void {
        this.draws.length = 0;
        this._customRecorder = undefined;
    }

    execute(encoder: GPUCommandEncoder): void {
        const desc = this.target.getDescriptor();
        const pass = encoder.beginRenderPass(desc);

        if (this._customRecorder) {
            this._customRecorder(pass);
            pass.end();
            return;
        }

        // Redundant state filtering cache
        let activePipeline: GPURenderPipeline | null = null;
        let activeIbo: GPUBuffer | null = null;
        let activeIboFormat: GPUIndexFormat | null = null;
        let activeIboOffset = -1;

        const activeBindGroups = this._activeBindGroups;
        for (let s = 0; s < activeBindGroups.length; s++) {
            activeBindGroups[s] = null;
        }

        const activeHasDynamicOffsets = this._activeHasDynamicOffsets;
        for (let s = 0; s < activeHasDynamicOffsets.length; s++) {
            activeHasDynamicOffsets[s] = false;
        }

        const activeVbos = this._activeVbos;
        activeVbos.length = 0;
        const activeVboOffsets = this._activeVboOffsets;
        activeVboOffsets.length = 0;
        const scratch = this._scratchResolved;

        for (let i = 0; i < this.draws.length; i++) {
            const batch = this.draws[i];

            // 1. Pipeline state
            if (activePipeline !== batch.pipeline.native) {
                pass.setPipeline(batch.pipeline.native);
                activePipeline = batch.pipeline.native;
            }

            // 2. Bind Tables
            if (batch.bindTables) {
                for (let slot = 0; slot < batch.bindTables.length; slot++) {
                    const bg = resolveGpuBindGroup(batch.bindTables[slot]);
                    if (bg) {
                        while (slot >= activeBindGroups.length) {
                            activeBindGroups.push(null);
                            activeHasDynamicOffsets.push(false);
                        }
                        const offsets = resolveSlotOffsets(batch.dynamicOffsets, slot);
                        if (offsets !== undefined && offsets.length > 0) {
                            pass.setBindGroup(slot, bg, offsets);
                            activeBindGroups[slot] = bg;
                            activeHasDynamicOffsets[slot] = true;
                        } else if (activeBindGroups[slot] !== bg || activeHasDynamicOffsets[slot]) {
                            pass.setBindGroup(slot, bg);
                            activeBindGroups[slot] = bg;
                            activeHasDynamicOffsets[slot] = false;
                        }
                    }
                }
            }

            // 3. StreamSet (Vertex & Index Buffers)
            const streams = batch.streamSet;
            if (streams) {
                for (let s = 0; s < streams.streams.length; s++) {
                    const vStream = streams.streams[s];
                    resolveBuffer(vStream.source, scratch);
                    if (activeVbos[vStream.slot] !== scratch.buffer || activeVboOffsets[vStream.slot] !== scratch.offset) {
                        pass.setVertexBuffer(vStream.slot, scratch.buffer, scratch.offset);
                        activeVbos[vStream.slot] = scratch.buffer;
                        activeVboOffsets[vStream.slot] = scratch.offset;
                    }
                }

                if (streams.indexStream) {
                    const iStream = streams.indexStream;
                    resolveBuffer(iStream.source, scratch);
                    if (activeIbo !== scratch.buffer || activeIboFormat !== iStream.format || activeIboOffset !== scratch.offset) {
                        pass.setIndexBuffer(scratch.buffer, iStream.format, scratch.offset);
                        activeIbo = scratch.buffer;
                        activeIboFormat = iStream.format;
                        activeIboOffset = scratch.offset;
                    }
                }
            }

            // 4. Issue Draw (Indirect or Direct)
            if (batch.indirect) {
                resolveBuffer(batch.indirect.buffer, scratch);
                const indirectOffset = scratch.offset + (batch.indirect.offset ?? 0);
                if (streams?.indexStream) {
                    pass.drawIndexedIndirect(scratch.buffer, indirectOffset);
                } else {
                    pass.drawIndirect(scratch.buffer, indirectOffset);
                }
            } else if (streams) {
                if (streams.indexStream) {
                    const count = batch.indexCount ?? streams.indexStream.count;
                    if (count > 0) {
                        const firstIndex = batch.firstIndex ?? streams.indexStream.firstIndex ?? 0;
                        const baseVertex = batch.baseVertex ?? streams.indexStream.baseVertex ?? 0;
                        pass.drawIndexed(
                            count,
                            batch.instanceCount ?? streams.instanceCount,
                            firstIndex,
                            baseVertex,
                            batch.firstInstance ?? streams.firstInstance
                        );
                    }
                } else {
                    const count = batch.vertexCount ?? streams.vertexCount;
                    if (count && count > 0) {
                        pass.draw(
                            count,
                            batch.instanceCount ?? streams.instanceCount,
                            batch.firstVertex ?? streams.firstVertex,
                            batch.firstInstance ?? streams.firstInstance
                        );
                    }
                }
            } else if (batch.vertexCount && batch.vertexCount > 0) {
                pass.draw(
                    batch.vertexCount,
                    batch.instanceCount ?? 1,
                    batch.firstVertex ?? 0,
                    batch.firstInstance ?? 0
                );
            }
        }

        pass.end();
    }
}

/**
 * Encapsulates a compute pass dispatching compute batches.
 */
export class ComputePassNode {
    readonly label: string;
    readonly dispatches: ComputeBatch[] = [];

    private _customRecorder?: (pass: GPUComputePassEncoder) => void;
    private _activeBindGroups: (GPUBindGroup | null)[] = new Array(8).fill(null);
    private _activeHasDynamicOffsets: boolean[] = new Array(8).fill(false);
    private _scratchResolved: ResolvedBuffer = { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };

    constructor(label = "ComputePassNode") {
        this.label = label;
    }

    addDispatch(batch: ComputeBatch): this {
        this.dispatches.push(batch);
        return this;
    }

    record(recorder: (pass: GPUComputePassEncoder) => void): this {
        this._customRecorder = recorder;
        return this;
    }

    clear(): void {
        this.dispatches.length = 0;
        this._customRecorder = undefined;
    }

    execute(encoder: GPUCommandEncoder): void {
        const pass = encoder.beginComputePass({ label: `${this.label}_ComputePass` });

        if (this._customRecorder) {
            this._customRecorder(pass);
            pass.end();
            return;
        }

        let activePipeline: GPUComputePipeline | null = null;
        const activeBindGroups = this._activeBindGroups;
        for (let s = 0; s < activeBindGroups.length; s++) {
            activeBindGroups[s] = null;
        }

        const activeHasDynamicOffsets = this._activeHasDynamicOffsets;
        for (let s = 0; s < activeHasDynamicOffsets.length; s++) {
            activeHasDynamicOffsets[s] = false;
        }

        const scratch = this._scratchResolved;

        for (let i = 0; i < this.dispatches.length; i++) {
            const batch = this.dispatches[i];

            if (activePipeline !== batch.pipeline.native) {
                pass.setPipeline(batch.pipeline.native);
                activePipeline = batch.pipeline.native;
            }

            if (batch.bindTables) {
                for (let slot = 0; slot < batch.bindTables.length; slot++) {
                    const bg = resolveGpuBindGroup(batch.bindTables[slot]);
                    if (bg) {
                        while (slot >= activeBindGroups.length) {
                            activeBindGroups.push(null);
                            activeHasDynamicOffsets.push(false);
                        }
                        const offsets = resolveSlotOffsets(batch.dynamicOffsets, slot);
                        if (offsets !== undefined && offsets.length > 0) {
                            pass.setBindGroup(slot, bg, offsets);
                            activeBindGroups[slot] = bg;
                            activeHasDynamicOffsets[slot] = true;
                        } else if (activeBindGroups[slot] !== bg || activeHasDynamicOffsets[slot]) {
                            pass.setBindGroup(slot, bg);
                            activeBindGroups[slot] = bg;
                            activeHasDynamicOffsets[slot] = false;
                        }
                    }
                }
            }

            if (batch.indirect) {
                resolveBuffer(batch.indirect.buffer, scratch);
                const indirectOffset = scratch.offset + (batch.indirect.offset ?? 0);
                pass.dispatchWorkgroupsIndirect(scratch.buffer, indirectOffset);
            } else if (batch.workgroups) {
                pass.dispatchWorkgroups(
                    batch.workgroups[0],
                    batch.workgroups[1],
                    batch.workgroups[2]
                );
            }
        }

        pass.end();
    }
}

/**
 * Linear pass execution orchestrator.
 * Records passes into a single GPUCommandEncoder and submits to queue in one command buffer.
 */
export class PassSequence {
    readonly passes: (RenderPassNode | ComputePassNode)[] = [];

    add(pass: RenderPassNode | ComputePassNode): this {
        this.passes.push(pass);
        return this;
    }

    clear(): void {
        this.passes.length = 0;
    }

    execute(device: Device | GPUDevice, label = "PassSequence"): void {
        const gpu = resolveDevice(device);
        const queue = resolveQueue(device);

        const encoder = gpu.createCommandEncoder({ label: `${label}_Encoder` });
        for (let i = 0; i < this.passes.length; i++) {
            this.passes[i].execute(encoder);
        }

        const commandBuffer = encoder.finish({ label: `${label}_CommandBuffer` });
        queue.submit([commandBuffer]);
    }
}
