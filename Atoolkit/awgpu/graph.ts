// ================================================================
//  Awgpu - Level 5: Dependency Execution Graph (PassGraph)
// ================================================================

import { type Device, getResourceId } from "./device.js";
import type { Target } from "./target.js";
import type { Buffer, BufferSlice, Texture } from "./memory.js";
import { resolveLogicalResourceId } from "./stream.js";
import {
	RenderPassNode,
	ComputePassNode,
	PassSequence,
	type PassNode,
	type DrawBatch,
	type ComputeBatch,
} from "./sequence.js";

export type GraphResource =
	| Buffer
	| BufferSlice
	| Texture
	| GPUBuffer
	| GPUTexture
	| GPUTextureView;

export type GraphNode = RenderGraphNode | ComputeGraphNode;

export interface PassGraphCompileOptions {
	/** Force recompilation even if graph topology and target generations have not changed. */
	force?: boolean;
	/**
	 * When true, eliminates passes that do not transitively contribute to a side-effect or
	 * presentation root. When true and no roots exist, compiles to an empty `PassSequence`.
	 * Defaults to `false`.
	 */
	cullDeadPasses?: boolean;
}

interface InternalNodeSets {
	readonly reads: Set<GraphResource>;
	readonly writes: Set<GraphResource>;
	readonly dependencies: Set<GraphNode>;
}

const _nodeInternalSets = new WeakMap<GraphNode, InternalNodeSets>();

/**
 * Graph node wrapping a `RenderPassNode` with tracked resource reads, writes, and pass dependencies.
 */
export class RenderGraphNode {
	readonly node: RenderPassNode;
	readonly #graph: PassGraph;
	readonly #reads = new Set<GraphResource>();
	readonly #writes = new Set<GraphResource>();
	readonly #dependencies = new Set<GraphNode>();
	#hasSideEffect = false;

	constructor(graph: PassGraph, target: Target, label: string) {
		this.#graph = graph;
		this.node = new RenderPassNode(target, label);
		_nodeInternalSets.set(this, {
			reads: this.#reads,
			writes: this.#writes,
			dependencies: this.#dependencies,
		});
	}

	/** Target coordinator for this render pass. */
	get target(): Target {
		return this.node.target;
	}

	/** Defensive snapshot of explicitly declared read resources. */
	get reads(): ReadonlySet<GraphResource> {
		return new Set(this.#reads);
	}

	/**
	 * Defensive snapshot of declared write resources, including current non-null attachments
	 * on `this.node.target`.
	 */
	get writes(): ReadonlySet<GraphResource> {
		const out = new Set<GraphResource>(this.#writes);
		const target = this.node.target;
		for (let i = 0; i < target.colorTargets.length; i++) {
			const ct = target.colorTargets[i];
			if (ct.target !== null) {
				out.add(ct.target);
			}
			if (ct.resolveTarget !== undefined && ct.resolveTarget !== null) {
				out.add(ct.resolveTarget);
			}
		}
		if (target.depthTarget) {
			out.add(target.depthTarget.target);
		}
		return out;
	}

	/** Defensive snapshot of explicit predecessor pass dependencies. */
	get dependencies(): ReadonlySet<GraphNode> {
		return new Set(this.#dependencies);
	}

	/**
	 * True if this pass is explicitly marked with a side effect or renders/resolves directly
	 * to a presentation swapchain target (`target === null` or `resolveTarget === null`).
	 */
	get hasSideEffect(): boolean {
		if (this.#hasSideEffect) {
			return true;
		}
		const target = this.node.target;
		for (let i = 0; i < target.colorTargets.length; i++) {
			const ct = target.colorTargets[i];
			if (ct.target === null || ct.resolveTarget === null) {
				return true;
			}
		}
		return false;
	}

	/** Sets the explicit side-effect flag on this pass and marks the owning graph dirty. */
	sideEffect(enabled = true): this {
		if (this.#hasSideEffect !== enabled) {
			this.#hasSideEffect = enabled;
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares that this pass reads `res` and marks the owning graph dirty. */
	read(res: GraphResource): this {
		if (!this.#reads.has(res)) {
			this.#reads.add(res);
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares that this pass writes `res` and marks the owning graph dirty. */
	write(res: GraphResource): this {
		if (!this.#writes.has(res)) {
			this.#writes.add(res);
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares an explicit ordering edge `priorPass -> this` and marks the owning graph dirty. */
	dependsOn(priorPass: GraphNode): this {
		this.#graph.validateNodeMembership(priorPass);
		if (!this.#dependencies.has(priorPass)) {
			this.#dependencies.add(priorPass);
			this.#graph.invalidate();
		}
		return this;
	}

	/**
	 * Appends a draw batch to the underlying `RenderPassNode`.
	 * Does not alter graph topology or invalidate the cached pass schedule.
	 */
	addDraw(batch: DrawBatch): this {
		this.node.addDraw(batch);
		return this;
	}

	/**
	 * Registers a custom imperative recording callback on the underlying `RenderPassNode`
	 * and marks this pass as having a side effect.
	 */
	record(recorder: (pass: GPURenderPassEncoder) => void): this {
		this.node.record(recorder);
		return this.sideEffect(true);
	}
}

/**
 * Graph node wrapping a `ComputePassNode` with tracked resource reads, writes, and pass dependencies.
 */
export class ComputeGraphNode {
	readonly node: ComputePassNode;
	readonly #graph: PassGraph;
	readonly #reads = new Set<GraphResource>();
	readonly #writes = new Set<GraphResource>();
	readonly #dependencies = new Set<GraphNode>();
	#hasSideEffect = false;

	constructor(graph: PassGraph, label: string) {
		this.#graph = graph;
		this.node = new ComputePassNode(label);
		_nodeInternalSets.set(this, {
			reads: this.#reads,
			writes: this.#writes,
			dependencies: this.#dependencies,
		});
	}

	/** Defensive snapshot of declared read resources. */
	get reads(): ReadonlySet<GraphResource> {
		return new Set(this.#reads);
	}

	/** Defensive snapshot of declared write resources. */
	get writes(): ReadonlySet<GraphResource> {
		return new Set(this.#writes);
	}

	/** Defensive snapshot of explicit predecessor pass dependencies. */
	get dependencies(): ReadonlySet<GraphNode> {
		return new Set(this.#dependencies);
	}

	/** True if this compute pass is marked as having a side effect. */
	get hasSideEffect(): boolean {
		return this.#hasSideEffect;
	}

	/** Sets the explicit side-effect flag on this pass and marks the owning graph dirty. */
	sideEffect(enabled = true): this {
		if (this.#hasSideEffect !== enabled) {
			this.#hasSideEffect = enabled;
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares that this pass reads `res` and marks the owning graph dirty. */
	read(res: GraphResource): this {
		if (!this.#reads.has(res)) {
			this.#reads.add(res);
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares that this pass writes `res` and marks the owning graph dirty. */
	write(res: GraphResource): this {
		if (!this.#writes.has(res)) {
			this.#writes.add(res);
			this.#graph.invalidate();
		}
		return this;
	}

	/** Declares an explicit ordering edge `priorPass -> this` and marks the owning graph dirty. */
	dependsOn(priorPass: GraphNode): this {
		this.#graph.validateNodeMembership(priorPass);
		if (!this.#dependencies.has(priorPass)) {
			this.#dependencies.add(priorPass);
			this.#graph.invalidate();
		}
		return this;
	}

	/**
	 * Appends a compute dispatch batch to the underlying `ComputePassNode`.
	 * Does not alter graph topology or invalidate the cached pass schedule.
	 */
	addDispatch(batch: ComputeBatch): this {
		this.node.addDispatch(batch);
		return this;
	}

	/**
	 * Registers a custom imperative recording callback on the underlying `ComputePassNode`
	 * and marks this pass as having a side effect.
	 */
	record(recorder: (pass: GPUComputePassEncoder) => void): this {
		this.node.record(recorder);
		return this.sideEffect(true);
	}
}

/**
 * Directed acyclic graph (DAG) scheduler for compute and render passes.
 *
 * Scheduling contract:
 * 1. Pass declaration order defines the temporal order of resource accesses:
 *    - Read-After-Write (RAW): a read depends on the most recent preceding write to the same logical resource.
 *    - Write-After-Read (WAR): a write depends on all reads since the previous write (including reads of imported state).
 *    - Write-After-Write (WAW): a write depends on the most recent preceding write to the same logical resource.
 *    - Read-Read pairs do not induce an ordering edge.
 * 2. Explicit dependencies registered via `node.dependsOn(priorNode)` or `graph.addDependency(from, to)`
 *    are combined with inferred hazard edges. Any cycle throws an Error during `compile()`.
 * 3. Resource identity resolves wrapper handles, buffer slices, and registered texture views to their backing
 *    `GPUBuffer` or `GPUTexture` logical ID via `resolveLogicalResourceId`.
 * 4. `cullDeadPasses` defaults to `false`. When `cullDeadPasses: true` is passed, only passes that transitively
 *    feed a side-effect or presentation root are retained; if no roots exist, an empty `PassSequence` is returned.
 * 5. Complexity: hazard edge construction is O(V + A) where A is the total number of declared resource accesses
 *    and explicit dependencies across passes; reverse-reachability culling and Kahn topological sorting each run
 *    in O(V + E) time over forward and reverse adjacency lists.
 */
export class PassGraph {
	readonly #nodes: GraphNode[] = [];
	readonly #nodeIndices = new Map<GraphNode, number>();
	#revision = 1;
	#lastTargetStateKey = "";
	#cachedPlanByKey = new Map<string, readonly PassNode[]>();

	/** Structural revision counter incremented on pass/dependency/resource mutations. */
	get revision(): number {
		return this.#revision;
	}

	/** Defensive snapshot of declared graph nodes in declaration order. */
	get nodes(): ReadonlyArray<GraphNode> {
		return [...this.#nodes];
	}

	/** Validates that `node` belongs to this `PassGraph`. */
	validateNodeMembership(node: GraphNode): number {
		const idx = this.#nodeIndices.get(node);
		if (idx === undefined) {
			throw new Error("PassGraph: referenced pass node does not belong to this PassGraph.");
		}
		return idx;
	}

	addRenderPass(target: Target, label = "RenderPass"): RenderGraphNode {
		const node = new RenderGraphNode(this, target, label);
		this.#nodeIndices.set(node, this.#nodes.length);
		this.#nodes.push(node);
		this.invalidate();
		return node;
	}

	addComputePass(label = "ComputePass"): ComputeGraphNode {
		const node = new ComputeGraphNode(this, label);
		this.#nodeIndices.set(node, this.#nodes.length);
		this.#nodes.push(node);
		this.invalidate();
		return node;
	}

	/** Adds an explicit dependency edge `from -> to`. */
	addDependency(from: GraphNode, to: GraphNode): this {
		this.validateNodeMembership(from);
		this.validateNodeMembership(to);
		to.dependsOn(from);
		return this;
	}

	/** Removes all passes and clears cached schedules. */
	clear(): void {
		this.#nodes.length = 0;
		this.#nodeIndices.clear();
		this.invalidate();
	}

	/** Increments `revision` and invalidates cached compiled schedules. */
	invalidate(): void {
		this.#revision++;
		this.#lastTargetStateKey = "";
		this.#cachedPlanByKey.clear();
	}

	#computeTargetStateKey(): string {
		const parts: string[] = [];
		for (let i = 0; i < this.#nodes.length; i++) {
			const node = this.#nodes[i];
			if (node instanceof RenderGraphNode) {
				const target = node.target;
				parts.push(`${i}:${getResourceId(target)}:${target.generation}`);
			}
		}
		return parts.join("|");
	}

	/**
	 * Compiles the pass dependency graph into a linear `PassSequence`.
	 * Throws an Error if a dependency cycle exists.
	 */
	compile(
		optionsOrForce: boolean | PassGraphCompileOptions = false,
		cullDeadPassesArg?: boolean
	): PassSequence {
		let force = false;
		let cull = false;

		if (typeof optionsOrForce === "boolean") {
			force = optionsOrForce;
			cull = cullDeadPassesArg ?? false;
		} else if (typeof optionsOrForce === "object" && optionsOrForce !== null) {
			force = optionsOrForce.force ?? false;
			cull = optionsOrForce.cullDeadPasses ?? cullDeadPassesArg ?? false;
		}

		const targetStateKey = this.#computeTargetStateKey();
		if (targetStateKey !== this.#lastTargetStateKey) {
			this.#cachedPlanByKey.clear();
			this.#lastTargetStateKey = targetStateKey;
		}
		const cacheKey = `rev:${this.#revision}|cull:${cull ? 1 : 0}`;

		if (!force) {
			const cachedNodes = this.#cachedPlanByKey.get(cacheKey);
			if (cachedNodes !== undefined) {
				return new PassSequence(cachedNodes);
			}
		}

		const n = this.#nodes.length;
		if (n === 0) {
			const emptyPlan: readonly PassNode[] = Object.freeze([]);
			this.#cachedPlanByKey.set(cacheKey, emptyPlan);
			return new PassSequence(emptyPlan);
		}

		const forwardSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
		const reverseSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

		const addEdge = (u: number, v: number): void => {
			if (u === v) {
				throw new Error(
					`PassGraph.compile: self-dependency cycle detected on pass '${this.#nodes[u].node.label}'.`
				);
			}
			forwardSets[u].add(v);
			reverseSets[v].add(u);
		};

		const lastWriter = new Map<number, number>();
		const readersSinceLastWrite = new Map<number, number[]>();

		for (let i = 0; i < n; i++) {
			const gNode = this.#nodes[i];
			const internalSets = _nodeInternalSets.get(gNode)!;
			const readIds = new Set<number>();
			const writeIds = new Set<number>();

			for (const res of internalSets.reads) {
				readIds.add(resolveLogicalResourceId(res as object));
			}
			for (const res of internalSets.writes) {
				writeIds.add(resolveLogicalResourceId(res as object));
			}

			if (gNode instanceof RenderGraphNode) {
				const target = gNode.target;
				for (let c = 0; c < target.colorTargets.length; c++) {
					const ct = target.colorTargets[c];
					if (ct.target !== null) {
						const id = resolveLogicalResourceId(ct.target as object);
						writeIds.add(id);
						if (ct.loadOp === "load") {
							readIds.add(id);
						}
					}
					if (ct.resolveTarget !== undefined && ct.resolveTarget !== null) {
						writeIds.add(resolveLogicalResourceId(ct.resolveTarget as object));
					}
				}
				if (target.depthTarget) {
					const depthId = resolveLogicalResourceId(target.depthTarget.target as object);
					writeIds.add(depthId);
					if (
						target.depthTarget.depthLoadOp === "load" ||
						target.depthTarget.stencilLoadOp === "load"
					) {
						readIds.add(depthId);
					}
				}
			}

			// Explicit dependencies: dep -> i
			for (const dep of internalSets.dependencies) {
				const depIdx = this.validateNodeMembership(dep);
				addEdge(depIdx, i);
			}

			// RAW hazards: lastWriter(r) -> i
			for (const r of readIds) {
				const w = lastWriter.get(r);
				if (w !== undefined && w !== i) {
					addEdge(w, i);
				}
			}

			// WAR and WAW hazards for writes in pass i
			for (const r of writeIds) {
				const readers = readersSinceLastWrite.get(r);
				if (readers !== undefined) {
					for (let k = 0; k < readers.length; k++) {
						const rd = readers[k];
						if (rd !== i) {
							addEdge(rd, i);
						}
					}
				}
				const prevWriter = lastWriter.get(r);
				if (prevWriter !== undefined && prevWriter !== i) {
					addEdge(prevWriter, i);
				}
			}

			// Update resource tracking state after pass i
			for (const r of readIds) {
				if (!writeIds.has(r)) {
					let list = readersSinceLastWrite.get(r);
					if (!list) {
						list = [];
						readersSinceLastWrite.set(r, list);
					}
					list.push(i);
				}
			}
			for (const r of writeIds) {
				lastWriter.set(r, i);
				readersSinceLastWrite.set(r, []);
			}
		}

		// Convert edge sets to adjacency arrays for O(V + E) traversal
		const forwardAdj: number[][] = new Array(n);
		const reverseAdj: number[][] = new Array(n);
		const inDegree = new Int32Array(n);

		for (let i = 0; i < n; i++) {
			forwardAdj[i] = Array.from(forwardSets[i]);
			reverseAdj[i] = Array.from(reverseSets[i]);
			inDegree[i] = reverseAdj[i].length;
		}

		// Kahn topological sort over all nodes to validate acyclicity and establish canonical order
		const queue: number[] = [];
		for (let i = 0; i < n; i++) {
			if (inDegree[i] === 0) {
				queue.push(i);
			}
		}

		const fullOrder: number[] = [];
		let head = 0;
		while (head < queue.length) {
			const u = queue[head++];
			fullOrder.push(u);

			const neighbors = forwardAdj[u];
			for (let k = 0; k < neighbors.length; k++) {
				const v = neighbors[k];
				const nextDeg = --inDegree[v];
				if (nextDeg === 0) {
					queue.push(v);
				}
			}
		}

		if (fullOrder.length !== n) {
			throw new Error(
				`PassGraph.compile: dependency cycle detected involving ${n - fullOrder.length} pass(es).`
			);
		}

		let finalOrder: number[];
		if (!cull) {
			finalOrder = fullOrder;
		} else {
			const alive = new Uint8Array(n);
			const rQueue: number[] = [];
			for (let i = 0; i < n; i++) {
				if (this.#nodes[i].hasSideEffect) {
					alive[i] = 1;
					rQueue.push(i);
				}
			}

			if (rQueue.length === 0) {
				finalOrder = [];
			} else {
				let rHead = 0;
				while (rHead < rQueue.length) {
					const v = rQueue[rHead++];
					const preds = reverseAdj[v];
					for (let k = 0; k < preds.length; k++) {
						const u = preds[k];
						if (alive[u] === 0) {
							alive[u] = 1;
							rQueue.push(u);
						}
					}
				}
				finalOrder = [];
				for (let i = 0; i < fullOrder.length; i++) {
					const idx = fullOrder[i];
					if (alive[idx] === 1) {
						finalOrder.push(idx);
					}
				}
			}
		}

		const planNodes: PassNode[] = new Array(finalOrder.length);
		for (let i = 0; i < finalOrder.length; i++) {
			planNodes[i] = this.#nodes[finalOrder[i]].node;
		}
		const frozenPlan = Object.freeze(planNodes);
		this.#cachedPlanByKey.set(cacheKey, frozenPlan);

		return new PassSequence(frozenPlan);
	}

	/**
	 * Compiles and executes the graph in a single call.
	 */
	execute(
		device: Device | GPUDevice,
		label = "PassGraph",
		options?: PassGraphCompileOptions
	): void {
		const sequence = this.compile(options);
		sequence.execute(device, label);
	}
}
