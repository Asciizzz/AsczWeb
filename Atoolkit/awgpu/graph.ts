// ================================================================
//  Awgpu - Level 5: Dependency Execution Graph (PassGraph)
// ================================================================

import type { Device } from "./device.js";
import type { Target } from "./target.js";
import type { Buffer, Texture } from "./memory.js";
import { RenderPassNode, ComputePassNode, PassSequence, type DrawBatch, type ComputeBatch } from "./sequence.js";

export type GraphResource = Buffer | Texture | GPUBuffer | GPUTexture | GPUTextureView;

function getResourceHandle(res: GraphResource): object {
    if ("native" in res) return res.native;
    return res;
}

export class RenderGraphNode {
    readonly node: RenderPassNode;
    readonly reads = new Set<object>();
    readonly writes = new Set<object>();
    private _hasSideEffect = false;

    constructor(target: Target, label: string) {
        this.node = new RenderPassNode(target, label);

        // Automatically register target output attachments into write dependency set
        for (let i = 0; i < target.colorTargets.length; i++) {
            const t = target.colorTargets[i].target;
            if (t !== null) {
                this.writes.add(getResourceHandle(t));
            } else {
                // Null target writes directly to screen swapchain
                this._hasSideEffect = true;
            }
        }
        for (let i = 0; i < target.colorTextures.length; i++) {
            this.writes.add(getResourceHandle(target.colorTextures[i]));
        }
        if (target.depthTarget) {
            this.writes.add(getResourceHandle(target.depthTarget.target));
        }
    }

    get hasSideEffect(): boolean {
        return this._hasSideEffect;
    }

    sideEffect(enabled = true): this {
        this._hasSideEffect = enabled;
        return this;
    }

    read(res: GraphResource): this {
        this.reads.add(getResourceHandle(res));
        return this;
    }

    write(res: GraphResource): this {
        this.writes.add(getResourceHandle(res));
        return this;
    }

    /**
     * Proxy: adds draw batch to the inner RenderPassNode.
     */
    addDraw(batch: DrawBatch): this {
        this.node.addDraw(batch);
        return this;
    }

    /**
     * Proxy: registers custom imperative recording callback on the inner RenderPassNode.
     */
    record(recorder: (pass: GPURenderPassEncoder) => void): this {
        this.node.record(recorder);
        this._hasSideEffect = true;
        return this;
    }
}

export class ComputeGraphNode {
    readonly node: ComputePassNode;
    readonly reads = new Set<object>();
    readonly writes = new Set<object>();
    private _hasSideEffect = false;

    constructor(label: string) {
        this.node = new ComputePassNode(label);
    }

    get hasSideEffect(): boolean {
        return this._hasSideEffect;
    }

    sideEffect(enabled = true): this {
        this._hasSideEffect = enabled;
        return this;
    }

    read(res: GraphResource): this {
        this.reads.add(getResourceHandle(res));
        return this;
    }

    write(res: GraphResource): this {
        this.writes.add(getResourceHandle(res));
        return this;
    }

    /**
     * Proxy: adds compute dispatch to the inner ComputePassNode.
     */
    addDispatch(batch: ComputeBatch): this {
        this.node.addDispatch(batch);
        return this;
    }

    /**
     * Proxy: registers custom imperative recording callback on the inner ComputePassNode.
     */
    record(recorder: (pass: GPUComputePassEncoder) => void): this {
        this.node.record(recorder);
        this._hasSideEffect = true;
        return this;
    }
}

/**
 * Directed acyclic graph (DAG) scheduler for compute and render passes.
 * Automatically sorts pass execution order based on read/write resource dependencies.
 * compile() uses Kahn's algorithm in O(V+E) time via an index pointer instead of shift().
 * Automatically eliminates dead passes not contributing to side effects or screen targets.
 */
export class PassGraph {
    private _nodes: (RenderGraphNode | ComputeGraphNode)[] = [];
    private _cachedSequence?: PassSequence;
    private _dirty = true;

    addRenderPass(target: Target, label = "RenderPass"): RenderGraphNode {
        const node = new RenderGraphNode(target, label);
        this._nodes.push(node);
        this._dirty = true;
        return node;
    }

    addComputePass(label = "ComputePass"): ComputeGraphNode {
        const node = new ComputeGraphNode(label);
        this._nodes.push(node);
        this._dirty = true;
        return node;
    }

    clear(): void {
        this._nodes.length = 0;
        this._cachedSequence = undefined;
        this._dirty = true;
    }

    invalidate(): void {
        this._dirty = true;
        this._cachedSequence = undefined;
    }

    /**
     * Compiles dependency graph into linear PassSequence using Kahn topological sort.
     * Evaluates read/write hazards bidirectionally across pass pairs.
     * Performs reverse reachability analysis from side-effect roots to eliminate dead passes.
     * When cycle is detected, logs warning and falls back to declaration order.
     * Caches compiled sequence when topology is unchanged.
     */
    compile(
        optionsOrForce: boolean | { force?: boolean; cullDeadPasses?: boolean } = false,
        cullDeadPasses = true
    ): PassSequence {
        let force = false;
        let cull = cullDeadPasses;

        if (typeof optionsOrForce === "boolean") {
            force = optionsOrForce;
        } else if (typeof optionsOrForce === "object") {
            force = optionsOrForce.force ?? false;
            cull = optionsOrForce.cullDeadPasses ?? true;
        }

        if (!force && !this._dirty && this._cachedSequence) {
            return this._cachedSequence;
        }

        const n = this._nodes.length;
        const adj: number[][] = Array.from({ length: n }, () => []);

        // Build dependency edges between all pass pairs
        for (let i = 0; i < n; i++) {
            const nodeA = this._nodes[i];
            for (let j = i + 1; j < n; j++) {
                const nodeB = this._nodes[j];

                let hasAProducesB = false;
                for (const written of nodeA.writes) {
                    if (nodeB.reads.has(written) || nodeB.writes.has(written)) {
                        hasAProducesB = true;
                        break;
                    }
                }

                let hasBProducesA = false;
                for (const written of nodeB.writes) {
                    if (nodeA.reads.has(written) || nodeA.writes.has(written)) {
                        hasBProducesA = true;
                        break;
                    }
                }

                if (hasAProducesB && !hasBProducesA) {
                    // Node A produces for Node B (declaration order preserved)
                    if (!adj[i].includes(j)) {
                        adj[i].push(j);
                    }
                } else if (!hasAProducesB && hasBProducesA) {
                    // Node B produces for Node A (out-of-order declaration: B must precede A)
                    if (!adj[j].includes(i)) {
                        adj[j].push(i);
                    }
                } else if (hasAProducesB && hasBProducesA) {
                    // Mutual read/write dependency: preserve declaration order
                    if (!adj[i].includes(j)) {
                        adj[i].push(j);
                    }
                }
            }
        }

        // Dead Pass Elimination via reverse reachability from side-effect roots
        const alive = new Set<number>();
        if (cull) {
            const queue: number[] = [];
            for (let i = 0; i < n; i++) {
                if (this._nodes[i].hasSideEffect) {
                    alive.add(i);
                    queue.push(i);
                }
            }

            // If side-effect roots exist, traverse reverse dependencies
            if (alive.size > 0) {
                while (queue.length > 0) {
                    const v = queue.pop()!;
                    for (let u = 0; u < n; u++) {
                        if (adj[u].includes(v) && !alive.has(u)) {
                            alive.add(u);
                            queue.push(u);
                        }
                    }
                }
            } else {
                // When no pass declares side effects, preserve all passes
                for (let i = 0; i < n; i++) {
                    alive.add(i);
                }
            }
        } else {
            for (let i = 0; i < n; i++) {
                alive.add(i);
            }
        }

        // Compute in-degrees within the active sub-graph
        const inDegree = new Map<number, number>();
        for (const u of alive) {
            inDegree.set(u, 0);
        }
        for (const u of alive) {
            for (const v of adj[u]) {
                if (alive.has(v)) {
                    inDegree.set(v, (inDegree.get(v) ?? 0) + 1);
                }
            }
        }

        // Kahn topological sort on active nodes
        const queue: number[] = [];
        for (const u of alive) {
            if (inDegree.get(u) === 0) {
                queue.push(u);
            }
        }

        const sortedOrder: number[] = [];
        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            sortedOrder.push(u);

            for (const v of adj[u]) {
                if (alive.has(v)) {
                    const nextDeg = (inDegree.get(v) ?? 0) - 1;
                    inDegree.set(v, nextDeg);
                    if (nextDeg === 0) {
                        queue.push(v);
                    }
                }
            }
        }

        if (sortedOrder.length !== alive.size) {
            console.warn(
                `[Awgpu] PassGraph cycle detected: ${alive.size - sortedOrder.length} pass(es) ` +
                "involved in circular dependency. Falling back to declaration order."
            );
        }

        const finalIndices = sortedOrder.length === alive.size
            ? sortedOrder
            : Array.from(alive).sort((a, b) => a - b);

        const sequence = new PassSequence();
        for (const idx of finalIndices) {
            sequence.add(this._nodes[idx].node);
        }

        this._cachedSequence = sequence;
        this._dirty = false;

        return sequence;
    }

    /**
     * Compiles and executes the graph in a single call.
     */
    execute(
        device: Device | GPUDevice,
        label = "PassGraph",
        options?: { force?: boolean; cullDeadPasses?: boolean }
    ): void {
        const sequence = this.compile(options);
        sequence.execute(device, label);
    }
}
