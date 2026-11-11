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
	/** Vertex and index stream set (accepts either `streamSet` or `streams`). */
	streamSet?: StreamSet;
	streams?: StreamSet;
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
	workgroups?: [number, number, number?];
	bindTables?: (BindTable | GPUBindGroup | null | undefined)[];
	dynamicOffsets?: DynamicOffsetRecord;
	indirect?: {
		buffer: GPUBuffer | Buffer;
		offset?: number;
	};
}

export type PassNode = RenderPassNode | ComputePassNode;

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
	return Array.isArray(item) ? item : Array.from(item);
}

/**
 * Encapsulates a render pass with state deduplication across draw batches.
 *
 * Binding range contract:
 * - Vertex streams bind `[slice.offset + (stream.bufferOffset ?? 0), slice.size - (stream.bufferOffset ?? 0))`.
 *   `stream.offset` is the attribute offset within a vertex stride and is not added to the buffer binding offset.
 * - Index streams bind `[slice.offset + (indexStream.offset ?? 0), slice.size - (indexStream.offset ?? 0))`.
 * - State deduplication tracks `(slot, buffer, finalOffset, finalSize)` for vertex buffers and
 *   `(buffer, format, finalOffset, finalSize)` for index buffers.
 */
export class RenderPassNode {
	readonly label: string;
	target: Target;
	readonly draws: DrawBatch[] = [];

	#customRecorder?: (pass: GPURenderPassEncoder) => void;
	#activeBindGroups: (GPUBindGroup | null)[] = new Array(8).fill(null);
	#activeHasDynamicOffsets: boolean[] = new Array(8).fill(false);
	#activeVbos: (GPUBuffer | null)[] = [];
	#activeVboOffsets: number[] = [];
	#activeVboSizes: number[] = [];
	#scratchResolved: ResolvedBuffer = { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };

	constructor(target: Target, label = "RenderPassNode") {
		this.target = target;
		this.label = label;
	}

	addDraw(batch: DrawBatch): this {
		this.draws.push(batch);
		return this;
	}

	/**
	 * Registers a custom imperative recording callback, bypassing queued `draws`.
	 */
	record(recorder: (pass: GPURenderPassEncoder) => void): this {
		this.#customRecorder = recorder;
		return this;
	}

	clear(): void {
		this.draws.length = 0;
		this.#customRecorder = undefined;
	}

	execute(encoder: GPUCommandEncoder): void {
		const desc = this.target.getDescriptor();
		const pass = encoder.beginRenderPass(desc);

		if (this.#customRecorder) {
			this.#customRecorder(pass);
			pass.end();
			return;
		}

		let activePipeline: GPURenderPipeline | null = null;
		let activeIbo: GPUBuffer | null = null;
		let activeIboFormat: GPUIndexFormat | null = null;
		let activeIboOffset = -1;
		let activeIboSize = -1;

		const activeBindGroups = this.#activeBindGroups;
		for (let s = 0; s < activeBindGroups.length; s++) {
			activeBindGroups[s] = null;
		}

		const activeHasDynamicOffsets = this.#activeHasDynamicOffsets;
		for (let s = 0; s < activeHasDynamicOffsets.length; s++) {
			activeHasDynamicOffsets[s] = false;
		}

		const activeVbos = this.#activeVbos;
		activeVbos.length = 0;
		const activeVboOffsets = this.#activeVboOffsets;
		activeVboOffsets.length = 0;
		const activeVboSizes = this.#activeVboSizes;
		activeVboSizes.length = 0;
		const scratch = this.#scratchResolved;

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
			const streams = batch.streamSet ?? batch.streams;
			if (streams) {
				const vertexStreams = streams.vertexStreams;
				for (let s = 0; s < vertexStreams.length; s++) {
					const vStream = vertexStreams[s];
					resolveBuffer(vStream.source, scratch);
					const extraOffset = vStream.bufferOffset ?? 0;
					if (!Number.isInteger(extraOffset) || extraOffset < 0 || extraOffset > scratch.size) {
						throw new RangeError(
							`RenderPassNode.execute: vertex stream bufferOffset (${extraOffset}) exceeds resolved slice size (${scratch.size}).`
						);
					}
					const finalOffset = scratch.offset + extraOffset;
					const finalSize = scratch.size - extraOffset;

					if (
						activeVbos[vStream.slot] !== scratch.buffer ||
						activeVboOffsets[vStream.slot] !== finalOffset ||
						activeVboSizes[vStream.slot] !== finalSize
					) {
						pass.setVertexBuffer(vStream.slot, scratch.buffer, finalOffset, finalSize);
						activeVbos[vStream.slot] = scratch.buffer;
						activeVboOffsets[vStream.slot] = finalOffset;
						activeVboSizes[vStream.slot] = finalSize;
					}
				}

				if (streams.indexStream) {
					const iStream = streams.indexStream;
					resolveBuffer(iStream.source, scratch);
					const extraOffset = iStream.offset ?? 0;
					if (!Number.isInteger(extraOffset) || extraOffset < 0 || extraOffset > scratch.size) {
						throw new RangeError(
							`RenderPassNode.execute: index stream offset (${extraOffset}) exceeds resolved slice size (${scratch.size}).`
						);
					}
					const finalOffset = scratch.offset + extraOffset;
					const finalSize = scratch.size - extraOffset;
					const align = iStream.format === "uint32" ? 4 : 2;
					if (finalOffset % align !== 0) {
						throw new RangeError(
							`RenderPassNode.execute: resolved index buffer offset (${finalOffset}) is not aligned to ${align} bytes for format '${iStream.format}'.`
						);
					}

					if (
						activeIbo !== scratch.buffer ||
						activeIboFormat !== iStream.format ||
						activeIboOffset !== finalOffset ||
						activeIboSize !== finalSize
					) {
						pass.setIndexBuffer(scratch.buffer, iStream.format, finalOffset, finalSize);
						activeIbo = scratch.buffer;
						activeIboFormat = iStream.format;
						activeIboOffset = finalOffset;
						activeIboSize = finalSize;
					}
				}
			}

			// 4. Issue Draw (Indirect or Direct)
			if (batch.indirect) {
				resolveBuffer(batch.indirect.buffer, scratch);
				const extraOffset = batch.indirect.offset ?? 0;
				if (!Number.isInteger(extraOffset) || extraOffset < 0 || extraOffset > scratch.size) {
					throw new RangeError(
						`RenderPassNode.execute: indirect offset (${extraOffset}) exceeds resolved buffer size (${scratch.size}).`
					);
				}
				const indirectOffset = scratch.offset + extraOffset;
				if (streams?.indexStream) {
					pass.drawIndexedIndirect(scratch.buffer, indirectOffset);
				} else {
					pass.drawIndirect(scratch.buffer, indirectOffset);
				}
			} else if (streams) {
				if (streams.indexStream) {
					const count = batch.indexCount ?? streams.indexStream.count ?? 0;
					if (count > 0) {
						const firstIndex = batch.firstIndex ?? streams.indexStream.firstIndex ?? 0;
						const baseVertex = batch.baseVertex ?? streams.indexStream.baseVertex ?? 0;
						pass.drawIndexed(
							count,
							batch.instanceCount ?? streams.instanceCount ?? 1,
							firstIndex,
							baseVertex,
							batch.firstInstance ?? streams.firstInstance ?? 0
						);
					}
				} else {
					const count = batch.vertexCount ?? streams.vertexCount ?? 0;
					if (count > 0) {
						pass.draw(
							count,
							batch.instanceCount ?? streams.instanceCount ?? 1,
							batch.firstVertex ?? streams.firstVertex ?? 0,
							batch.firstInstance ?? streams.firstInstance ?? 0
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

	#customRecorder?: (pass: GPUComputePassEncoder) => void;
	#activeBindGroups: (GPUBindGroup | null)[] = new Array(8).fill(null);
	#activeHasDynamicOffsets: boolean[] = new Array(8).fill(false);
	#scratchResolved: ResolvedBuffer = { buffer: null as unknown as GPUBuffer, offset: 0, size: 0 };

	constructor(label = "ComputePassNode") {
		this.label = label;
	}

	addDispatch(batch: ComputeBatch): this {
		this.dispatches.push(batch);
		return this;
	}

	record(recorder: (pass: GPUComputePassEncoder) => void): this {
		this.#customRecorder = recorder;
		return this;
	}

	clear(): void {
		this.dispatches.length = 0;
		this.#customRecorder = undefined;
	}

	execute(encoder: GPUCommandEncoder): void {
		const pass = encoder.beginComputePass({ label: `${this.label}_ComputePass` });

		if (this.#customRecorder) {
			this.#customRecorder(pass);
			pass.end();
			return;
		}

		let activePipeline: GPUComputePipeline | null = null;
		const activeBindGroups = this.#activeBindGroups;
		for (let s = 0; s < activeBindGroups.length; s++) {
			activeBindGroups[s] = null;
		}

		const activeHasDynamicOffsets = this.#activeHasDynamicOffsets;
		for (let s = 0; s < activeHasDynamicOffsets.length; s++) {
			activeHasDynamicOffsets[s] = false;
		}

		const scratch = this.#scratchResolved;

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
				const extraOffset = batch.indirect.offset ?? 0;
				if (!Number.isInteger(extraOffset) || extraOffset < 0 || extraOffset > scratch.size) {
					throw new RangeError(
						`ComputePassNode.execute: indirect offset (${extraOffset}) exceeds resolved buffer size (${scratch.size}).`
					);
				}
				const indirectOffset = scratch.offset + extraOffset;
				pass.dispatchWorkgroupsIndirect(scratch.buffer, indirectOffset);
			} else if (batch.workgroups) {
				pass.dispatchWorkgroups(
					batch.workgroups[0],
					batch.workgroups[1] ?? 1,
					batch.workgroups[2] ?? 1
				);
			}
		}

		pass.end();
	}
}

/**
 * Linear pass execution orchestrator.
 *
 * Execution contract:
 * - Holds an ordered list of `PassNode` instances (`RenderPassNode | ComputePassNode`).
 * - `passes` returns a defensive shallow copy of the pass node array so external callers cannot
 *   mutate the ordering of a compiled sequence.
 * - `execute()` records each pass node's live draw/dispatch commands into a single `GPUCommandEncoder`
 *   and submits the resulting command buffer to the device queue.
 */
export class PassSequence {
	readonly #passes: PassNode[] = [];

	constructor(passes?: Iterable<PassNode>) {
		if (passes) {
			for (const p of passes) {
				this.#passes.push(p);
			}
		}
	}

	/** Defensive snapshot of the ordered passes in this sequence. */
	get passes(): ReadonlyArray<PassNode> {
		return [...this.#passes];
	}

	/** Number of passes in this sequence. */
	get length(): number {
		return this.#passes.length;
	}

	add(pass: PassNode): this {
		this.#passes.push(pass);
		return this;
	}

	clear(): void {
		this.#passes.length = 0;
	}

	/**
	 * Records all passes into `encoder` without finishing or submitting it.
	 */
	record(encoder: GPUCommandEncoder): void {
		for (let i = 0; i < this.#passes.length; i++) {
			this.#passes[i].execute(encoder);
		}
	}

	/**
	 * Creates a `GPUCommandEncoder`, records all passes in order, finishes the command buffer,
	 * and submits it to `device.queue`.
	 */
	execute(device: Device | GPUDevice, label = "PassSequence"): void {
		const gpu = resolveDevice(device);
		const queue = resolveQueue(device);

		const encoder = gpu.createCommandEncoder({ label: `${label}_Encoder` });
		this.record(encoder);

		const commandBuffer = encoder.finish({ label: `${label}_CommandBuffer` });
		queue.submit([commandBuffer]);
	}
}
