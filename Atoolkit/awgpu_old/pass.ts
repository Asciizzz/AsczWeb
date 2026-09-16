import type { RenderTarget } from "./target.js";
import type { RenderPipeline, ComputePipeline } from "./pipeline.js";
import type { BindGroup } from "./layout.js";
import type { Buffer } from "./buffer.js";

export type DynamicOffsets =
    | Iterable<number>
    | (Iterable<number> | undefined)[]
    | Record<number, Iterable<number>>;

export interface DrawCommand {
    pipeline: RenderPipeline;
    vertexBuffer?: GPUBuffer | Buffer | (GPUBuffer | Buffer)[];
    indexBuffer?: GPUBuffer | Buffer;
    indexFormat?: GPUIndexFormat;
    indexCount?: number;
    vertexCount?: number;
    indexStart?: number;
    vertexStart?: number;
    instanceCount?: number;
    firstInstance?: number;
    bindGroups?: (GPUBindGroup | BindGroup | null | undefined)[];
    dynamicOffsets?: DynamicOffsets;
}

export interface ComputeCommand {
    pipeline: ComputePipeline;
    workgroupsX: number;
    workgroupsY?: number;
    workgroupsZ?: number;
    bindGroups?: (GPUBindGroup | BindGroup | null | undefined)[];
    dynamicOffsets?: DynamicOffsets;
}

function resolveGpuBuffer(buf: GPUBuffer | Buffer): GPUBuffer {
    return "gpuBuffer" in buf ? buf.gpuBuffer : buf;
}

function resolveGpuBindGroup(bg: GPUBindGroup | BindGroup | null | undefined): GPUBindGroup | null {
    if (!bg) return null;
    return "gpuBindGroup" in bg ? bg.gpuBindGroup : bg;
}

function resolveDynamicOffsets(
    offsets: DynamicOffsets | undefined,
    slot: number
): Iterable<number> | undefined {
    if (!offsets) return undefined;

    if (Array.isArray(offsets)) {
        if (offsets.length > 0 && (Array.isArray(offsets[0]) || ArrayBuffer.isView(offsets[0]))) {
            return (offsets as (Iterable<number> | undefined)[])[slot];
        }
        return offsets as unknown as Iterable<number>;
    }

    if (typeof offsets === "object" && !(Symbol.iterator in offsets)) {
        return (offsets as Record<number, Iterable<number>>)[slot];
    }

    return offsets as Iterable<number>;
}

/**
 * Encapsulates self-contained WebGPU render pass recording draw commands into target.
 */
export class Pass {
    readonly name: string;
    target: RenderTarget;
    viewport?: { x: number; y: number; width: number; height: number; minDepth?: number; maxDepth?: number };
    scissor?: { x: number; y: number; width: number; height: number };
    drawCommands: DrawCommand[] = [];

    private _drawPool: DrawCommand[] = [];
    private _poolIndex = 0;
    private _customRecorder?: (pass: GPURenderPassEncoder) => void;

    constructor(name: string, target: RenderTarget) {
        this.name = name;
        this.target = target;
    }

    addDraw(cmd: DrawCommand): this {
        this.drawCommands.push(cmd);
        return this;
    }

    /**
     * Acquires a pooled, reusable draw command to avoid per-frame heap allocations.
     * Mutate returned command directly. Reused commands automatically append to drawCommands.
     */
    acquireDraw(): DrawCommand {
        let cmd: DrawCommand;
        if (this._poolIndex < this._drawPool.length) {
            cmd = this._drawPool[this._poolIndex++];
            cmd.vertexBuffer = undefined;
            cmd.indexBuffer = undefined;
            cmd.indexFormat = undefined;
            cmd.indexCount = undefined;
            cmd.vertexCount = undefined;
            cmd.indexStart = undefined;
            cmd.vertexStart = undefined;
            cmd.instanceCount = undefined;
            cmd.firstInstance = undefined;
            cmd.bindGroups = undefined;
            cmd.dynamicOffsets = undefined;
        } else {
            cmd = { pipeline: null as any };
            this._drawPool.push(cmd);
            this._poolIndex++;
        }
        this.drawCommands.push(cmd);
        return cmd;
    }

    /**
     * Sets custom recording callback for direct hardware pass execution, bypassing drawCommands list.
     */
    record(recorder: (pass: GPURenderPassEncoder) => void): this {
        this._customRecorder = recorder;
        return this;
    }

    clearDraws(): void {
        this.drawCommands.length = 0;
        this._poolIndex = 0;
        this._customRecorder = undefined;
    }

    /**
     * Records render pass into active command encoder with redundant state filtering.
     * Accepts optional custom recording callback overriding queued draw commands.
     */
    execute(encoder: GPUCommandEncoder, customRecorder?: (pass: GPURenderPassEncoder) => void): void {
        const passDesc = this.target.buildPassDescriptor();
        passDesc.label = `${this.name}_Encoder`;
        const pass = encoder.beginRenderPass(passDesc);

        if (this.viewport) {
            pass.setViewport(
                this.viewport.x,
                this.viewport.y,
                this.viewport.width,
                this.viewport.height,
                this.viewport.minDepth ?? 0.0,
                this.viewport.maxDepth ?? 1.0
            );
        }

        if (this.scissor) {
            pass.setScissorRect(
                this.scissor.x,
                this.scissor.y,
                this.scissor.width,
                this.scissor.height
            );
        }

        const recorder = customRecorder ?? this._customRecorder;
        if (recorder) {
            recorder(pass);
            pass.end();
            return;
        }

        // Redundant state filtering cache
        let activePipeline: GPURenderPipeline | null = null;
        let activeIbo: GPUBuffer | null = null;
        const activeVbos: (GPUBuffer | null)[] = [];
        const activeBindGroups: (GPUBindGroup | null)[] = [null, null, null, null];
        const activeOffsets: (number[] | null)[] = [null, null, null, null];

        for (let i = 0; i < this.drawCommands.length; i++) {
            const cmd = this.drawCommands[i];

            // 1. Pipeline State
            if (activePipeline !== cmd.pipeline.gpuPipeline) {
                pass.setPipeline(cmd.pipeline.gpuPipeline);
                activePipeline = cmd.pipeline.gpuPipeline;
            }

            // 2. Bind Groups (Slots 0 to 3)
            if (cmd.bindGroups) {
                for (let slot = 0; slot < cmd.bindGroups.length; slot++) {
                    const bg = resolveGpuBindGroup(cmd.bindGroups[slot]);
                    if (bg) {
                        const offsets = resolveDynamicOffsets(cmd.dynamicOffsets, slot);
                        if (offsets !== undefined) {
                            const offsetArray = Array.isArray(offsets) ? (offsets as number[]) : Array.from(offsets);
                            const prevOffsets = activeOffsets[slot];
                            let offsetsChanged = prevOffsets === null || prevOffsets.length !== offsetArray.length;
                            if (!offsetsChanged && prevOffsets !== null) {
                                for (let o = 0; o < offsetArray.length; o++) {
                                    if (prevOffsets[o] !== offsetArray[o]) {
                                        offsetsChanged = true;
                                        break;
                                    }
                                }
                            }

                            if (activeBindGroups[slot] !== bg || offsetsChanged) {
                                pass.setBindGroup(slot, bg, offsetArray);
                                activeBindGroups[slot] = bg;
                                activeOffsets[slot] = offsetArray;
                            }
                        } else if (activeBindGroups[slot] !== bg || activeOffsets[slot] !== null) {
                            pass.setBindGroup(slot, bg);
                            activeBindGroups[slot] = bg;
                            activeOffsets[slot] = null;
                        }
                    }
                }
            }

            // 3. Vertex Buffers
            if (cmd.vertexBuffer) {
                if (Array.isArray(cmd.vertexBuffer)) {
                    for (let vSlot = 0; vSlot < cmd.vertexBuffer.length; vSlot++) {
                        const vbo = resolveGpuBuffer(cmd.vertexBuffer[vSlot]);
                        if (activeVbos[vSlot] !== vbo) {
                            pass.setVertexBuffer(vSlot, vbo);
                            activeVbos[vSlot] = vbo;
                        }
                    }
                } else {
                    const vbo = resolveGpuBuffer(cmd.vertexBuffer);
                    if (activeVbos[0] !== vbo) {
                        pass.setVertexBuffer(0, vbo);
                        activeVbos[0] = vbo;
                    }
                }
            }

            // 4. Index Buffer & Draw Execution
            const instanceCount = cmd.instanceCount ?? 1;
            const firstInstance = cmd.firstInstance ?? 0;

            if (cmd.indexBuffer) {
                const ibo = resolveGpuBuffer(cmd.indexBuffer);
                const format = cmd.indexFormat ?? "uint16";
                if (activeIbo !== ibo) {
                    pass.setIndexBuffer(ibo, format);
                    activeIbo = ibo;
                }
                const count = cmd.indexCount ?? 0;
                const start = cmd.indexStart ?? 0;
                if (count > 0) {
                    pass.drawIndexed(count, instanceCount, start, 0, firstInstance);
                }
            } else if (cmd.vertexCount !== undefined && cmd.vertexCount > 0) {
                pass.draw(cmd.vertexCount, instanceCount, cmd.vertexStart ?? 0, firstInstance);
            }
        }

        pass.end();
    }
}

/**
 * Encapsulates WebGPU compute pass executing compute dispatch commands.
 */
export class ComputePass {
    readonly name: string;
    commands: ComputeCommand[] = [];

    private _computePool: ComputeCommand[] = [];
    private _poolIndex = 0;
    private _customRecorder?: (pass: GPUComputePassEncoder) => void;

    constructor(name: string) {
        this.name = name;
    }

    addCompute(cmd: ComputeCommand): this {
        this.commands.push(cmd);
        return this;
    }

    /**
     * Acquires a pooled, reusable compute command to avoid per-frame heap allocations.
     * Mutate returned command directly. Reused commands automatically append to commands list.
     */
    acquireCompute(): ComputeCommand {
        let cmd: ComputeCommand;
        if (this._poolIndex < this._computePool.length) {
            cmd = this._computePool[this._poolIndex++];
            cmd.workgroupsX = 1;
            cmd.workgroupsY = undefined;
            cmd.workgroupsZ = undefined;
            cmd.bindGroups = undefined;
            cmd.dynamicOffsets = undefined;
        } else {
            cmd = {
                pipeline: null as any,
                workgroupsX: 1,
            };
            this._computePool.push(cmd);
            this._poolIndex++;
        }
        this.commands.push(cmd);
        return cmd;
    }

    /**
     * Sets custom recording callback for direct hardware compute pass execution, bypassing commands list.
     */
    record(recorder: (pass: GPUComputePassEncoder) => void): this {
        this._customRecorder = recorder;
        return this;
    }

    clear(): void {
        this.commands.length = 0;
        this._poolIndex = 0;
        this._customRecorder = undefined;
    }

    /**
     * Records compute pass into active command encoder with redundant state filtering.
     * Accepts optional custom recording callback overriding queued compute commands.
     */
    execute(encoder: GPUCommandEncoder, customRecorder?: (pass: GPUComputePassEncoder) => void): void {
        const pass = encoder.beginComputePass({
            label: `${this.name}_ComputePass`,
        });

        const activeBindGroups: (GPUBindGroup | null)[] = [null, null, null, null];
        const activeOffsets: (number[] | null)[] = [null, null, null, null];

        const recorder = customRecorder ?? this._customRecorder;
        if (recorder) {
            recorder(pass);
            pass.end();
            return;
        }

        let activePipeline: GPUComputePipeline | null = null;

        for (let i = 0; i < this.commands.length; i++) {
            const cmd = this.commands[i];

            if (activePipeline !== cmd.pipeline.gpuPipeline) {
                pass.setPipeline(cmd.pipeline.gpuPipeline);
                activePipeline = cmd.pipeline.gpuPipeline;
            }

            if (cmd.bindGroups) {
                for (let slot = 0; slot < cmd.bindGroups.length; slot++) {
                    const bg = resolveGpuBindGroup(cmd.bindGroups[slot]);
                    if (bg) {
                        const offsets = resolveDynamicOffsets(cmd.dynamicOffsets, slot);
                        if (offsets) {
                            const offsetArray = Array.isArray(offsets) ? offsets : Array.from(offsets);
                            const prevOffsets = activeOffsets[slot];
                            let offsetsChanged = !prevOffsets || prevOffsets.length !== offsetArray.length;
                            if (!offsetsChanged && prevOffsets) {
                                for (let k = 0; k < offsetArray.length; k++) {
                                    if (prevOffsets[k] !== offsetArray[k]) {
                                        offsetsChanged = true;
                                        break;
                                    }
                                }
                            }

                            if (activeBindGroups[slot] !== bg || offsetsChanged) {
                                pass.setBindGroup(slot, bg, offsetArray);
                                activeBindGroups[slot] = bg;
                                activeOffsets[slot] = offsetArray;
                            }
                        } else if (activeBindGroups[slot] !== bg || activeOffsets[slot] !== null) {
                            pass.setBindGroup(slot, bg);
                            activeBindGroups[slot] = bg;
                            activeOffsets[slot] = null;
                        }
                    }
                }
            }

            pass.dispatchWorkgroups(
                cmd.workgroupsX,
                cmd.workgroupsY ?? 1,
                cmd.workgroupsZ ?? 1
            );
        }

        pass.end();
    }
}
