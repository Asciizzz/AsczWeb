import {
	type Metadata,
	type CircuitRunOptions,
	type CircuitRunResult,
	type CircuitProcessorError,
	type SerializedCircuit,
	type ChipProcessor,
} from "./types.js";
import { Chip } from "./chip.js";
import { Wire, encodeEndpointKey, canConnectInput } from "./wire.js";

interface CompiledCircuitPlan {
	readonly revision: number;
	readonly order: readonly Chip<any, any>[];
	readonly incomingByChip: ReadonlyMap<string, readonly Wire[]>;
	readonly outgoingByChip: ReadonlyMap<string, readonly Wire[]>;
}

/**
 * Directed Acyclic Graph (DAG) of Chips and Wires with transactional topology mutations
 * and revision-keyed execution plans.
 */
export class Circuit {
	readonly #chips = new Map<string, Chip<any, any>>();
	readonly #wires: Wire[] = [];
	readonly #wireByInEndpoint = new Map<string, Wire>();
	readonly metadata: Metadata;

	#revision = 0;
	#compiledPlan: CompiledCircuitPlan | null = null;

	constructor(metadata: Metadata = {}) {
		this.metadata = { ...metadata };
	}

	/** Monotonically increasing structural revision counter incremented on successful topology mutations. */
	get revision(): number {
		return this.#revision;
	}

	/** Snapshot of registered chips keyed by chip ID. Mutating the returned Map does not affect the Circuit. */
	get chips(): ReadonlyMap<string, Chip<any, any>> {
		return new Map(this.#chips);
	}

	/** Snapshot of active wires. Mutating the returned array does not affect the Circuit. */
	get wires(): ReadonlyArray<Wire> {
		return this.#wires.slice();
	}

	/** Number of registered chips in this circuit. */
	get chipCount(): number {
		return this.#chips.size;
	}

	/** Number of active wires in this circuit. */
	get wireCount(): number {
		return this.#wires.length;
	}

	/** Retrieves a registered chip by ID, or undefined if absent. */
	getChip(chipId: string): Chip<any, any> | undefined {
		return this.#chips.get(chipId);
	}

	/** Returns true if a chip with chipId is registered in this circuit. */
	hasChip(chipId: string): boolean {
		return this.#chips.has(chipId);
	}

	#bumpRevision(): void {
		this.#revision++;
		this.#compiledPlan = null;
	}

	/**
	 * Registers a chip in this circuit and locks its port schema.
	 * Passing the exact same Chip instance already registered is a no-op.
	 * Passing a different Chip instance with a colliding ID throws an Error and leaves the circuit unchanged.
	 */
	addChip(chip: Chip<any, any>): this {
		const existing = this.#chips.get(chip.id);
		if (existing !== undefined) {
			if (existing === chip) {
				return this;
			}
			throw new Error(
				`Circuit.addChip: chip ID '${chip.id}' is already registered to a different Chip instance.`
			);
		}
		chip._lockSchema();
		this.#chips.set(chip.id, chip);
		this.#bumpRevision();
		return this;
	}

	/**
	 * Replaces an existing chip of the same ID after validating that all incident wires remain valid
	 * against the replacement chip's socket schema.
	 */
	replaceChip(newChip: Chip<any, any>): this {
		const existing = this.#chips.get(newChip.id);
		if (!existing) {
			throw new Error(`Circuit.replaceChip: chip '${newChip.id}' is not registered in this circuit.`);
		}
		if (existing === newChip) {
			return this;
		}

		for (let i = 0; i < this.#wires.length; i++) {
			const w = this.#wires[i];
			if (w.fromChipId === newChip.id) {
				const outSocket = newChip.getOutput(w.fromSocketName);
				const inChip = this.#chips.get(w.toChipId)!;
				const inSocket = inChip.getInput(w.toSocketName)!;
				if (!outSocket || !canConnectInput(inSocket, outSocket)) {
					throw new Error(
						`Circuit.replaceChip: replacement chip '${newChip.id}' invalidates outgoing wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName}.`
					);
				}
			}
			if (w.toChipId === newChip.id) {
				const inSocket = newChip.getInput(w.toSocketName);
				const outChip = this.#chips.get(w.fromChipId)!;
				const outSocket = outChip.getOutput(w.fromSocketName)!;
				if (!inSocket || !canConnectInput(inSocket, outSocket)) {
					throw new Error(
						`Circuit.replaceChip: replacement chip '${newChip.id}' invalidates incoming wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName}.`
					);
				}
			}
		}

		existing._unlockSchema();
		newChip._lockSchema();
		this.#chips.set(newChip.id, newChip);
		this.#bumpRevision();
		return this;
	}

	/**
	 * Removes a chip and all of its incident wires from this circuit, unlocking its port schema.
	 * Returns true if the chip was present and removed.
	 */
	removeChip(chipId: string): boolean {
		const chip = this.#chips.get(chipId);
		if (!chip) {
			return false;
		}

		this.#chips.delete(chipId);
		chip._unlockSchema();

		for (let i = this.#wires.length - 1; i >= 0; i--) {
			const w = this.#wires[i];
			if (w.fromChipId === chipId || w.toChipId === chipId) {
				this.#wires.splice(i, 1);
				this.#wireByInEndpoint.delete(encodeEndpointKey(w.toChipId, w.toSocketName));
			}
		}

		this.#bumpRevision();
		return true;
	}

	/**
	 * Transactionally connects outChip.outSocketName to inChip.inSocketName.
	 * Validates endpoint existence, socket directions, type compatibility, self-loops,
	 * and chip ID collisions before modifying chip membership or replacing an existing wire.
	 */
	connect(
		outChip: Chip<any, any>,
		outSocketName: string,
		inChip: Chip<any, any>,
		inSocketName: string,
		metadata: Metadata = {}
	): Wire {
		if (outChip.id === inChip.id) {
			throw new Error(`Circuit.connect: self-loop on chip '${outChip.id}' is not allowed.`);
		}

		const existingOut = this.#chips.get(outChip.id);
		if (existingOut !== undefined && existingOut !== outChip) {
			throw new Error(
				`Circuit.connect: producer chip ID '${outChip.id}' collides with a different registered Chip instance.`
			);
		}
		const existingIn = this.#chips.get(inChip.id);
		if (existingIn !== undefined && existingIn !== inChip) {
			throw new Error(
				`Circuit.connect: consumer chip ID '${inChip.id}' collides with a different registered Chip instance.`
			);
		}

		const outSocket = outChip.getOutput(outSocketName);
		if (!outSocket) {
			throw new Error(`Output socket '${outSocketName}' not found on chip '${outChip.id}'.`);
		}

		const inSocket = inChip.getInput(inSocketName);
		if (!inSocket) {
			throw new Error(`Input socket '${inSocketName}' not found on chip '${inChip.id}'.`);
		}

		if (!canConnectInput(inSocket, outSocket)) {
			throw new Error(
				`Type mismatch connecting '${outChip.id}.${outSocketName}' (${outSocket.type}) to '${inChip.id}.${inSocketName}' (${inSocket.type}).`
			);
		}

		if (existingOut === undefined) {
			outChip._lockSchema();
			this.#chips.set(outChip.id, outChip);
		}
		if (existingIn === undefined) {
			inChip._lockSchema();
			this.#chips.set(inChip.id, inChip);
		}

		const targetKey = encodeEndpointKey(inChip.id, inSocketName);
		const prevWire = this.#wireByInEndpoint.get(targetKey);
		if (prevWire) {
			const idx = this.#wires.indexOf(prevWire);
			if (idx !== -1) {
				this.#wires.splice(idx, 1);
			}
			this.#wireByInEndpoint.delete(targetKey);
		}

		const wire = new Wire(outChip.id, outSocketName, inChip.id, inSocketName, metadata);
		this.#wires.push(wire);
		this.#wireByInEndpoint.set(targetKey, wire);
		this.#bumpRevision();
		return wire;
	}

	/** Disconnects whatever wire is currently attached to (inChipId, inSocketName). */
	disconnectInput(inChipId: string, inSocketName: string): boolean {
		const key = encodeEndpointKey(inChipId, inSocketName);
		const wire = this.#wireByInEndpoint.get(key);
		if (!wire) {
			return false;
		}
		const idx = this.#wires.indexOf(wire);
		if (idx !== -1) {
			this.#wires.splice(idx, 1);
		}
		this.#wireByInEndpoint.delete(key);
		this.#bumpRevision();
		return true;
	}

	/** Disconnects a specific directed wire between (fromChipId, fromSocketName) and (toChipId, toSocketName). */
	disconnect(
		fromChipId: string,
		fromSocketName: string,
		toChipId: string,
		toSocketName: string
	): boolean {
		const key = encodeEndpointKey(toChipId, toSocketName);
		const wire = this.#wireByInEndpoint.get(key);
		if (
			!wire ||
			wire.fromChipId !== fromChipId ||
			wire.fromSocketName !== fromSocketName
		) {
			return false;
		}
		return this.disconnectInput(toChipId, toSocketName);
	}

	/** Removes all chips and wires from this circuit, unlocking all chip schemas. */
	clear(): void {
		if (this.#chips.size === 0 && this.#wires.length === 0) {
			return;
		}
		for (const chip of this.#chips.values()) {
			chip._unlockSchema();
		}
		this.#chips.clear();
		this.#wires.length = 0;
		this.#wireByInEndpoint.clear();
		this.#bumpRevision();
	}

	/**
	 * Compiles and caches the structural execution plan for the current circuit revision.
	 * Throws an Error if the circuit contains a cycle.
	 */
	#compilePlan(): CompiledCircuitPlan {
		if (this.#compiledPlan !== null && this.#compiledPlan.revision === this.#revision) {
			return this.#compiledPlan;
		}

		const inDegree = new Map<string, number>();
		const adj = new Map<string, string[]>();
		const incomingByChip = new Map<string, Wire[]>();
		const outgoingByChip = new Map<string, Wire[]>();

		for (const id of this.#chips.keys()) {
			inDegree.set(id, 0);
			adj.set(id, []);
			incomingByChip.set(id, []);
			outgoingByChip.set(id, []);
		}

		for (let i = 0; i < this.#wires.length; i++) {
			const w = this.#wires[i];
			if (this.#chips.has(w.fromChipId) && this.#chips.has(w.toChipId)) {
				adj.get(w.fromChipId)!.push(w.toChipId);
				inDegree.set(w.toChipId, (inDegree.get(w.toChipId) ?? 0) + 1);
				incomingByChip.get(w.toChipId)!.push(w);
				outgoingByChip.get(w.fromChipId)!.push(w);
			}
		}

		const queue: string[] = [];
		let head = 0;
		for (const [id, deg] of inDegree.entries()) {
			if (deg === 0) {
				queue.push(id);
			}
		}

		const sorted: Chip<any, any>[] = [];
		while (head < queue.length) {
			const currId = queue[head++];
			const chip = this.#chips.get(currId)!;
			sorted.push(chip);

			const neighbors = adj.get(currId)!;
			for (let i = 0; i < neighbors.length; i++) {
				const neighbor = neighbors[i];
				const newDeg = inDegree.get(neighbor)! - 1;
				inDegree.set(neighbor, newDeg);
				if (newDeg === 0) {
					queue.push(neighbor);
				}
			}
		}

		if (sorted.length < this.#chips.size) {
			throw new Error(
				`Cycle detected in Circuit! Could only resolve ${sorted.length} of ${this.#chips.size} chips.`
			);
		}

		const plan: CompiledCircuitPlan = {
			revision: this.#revision,
			order: Object.freeze(sorted),
			incomingByChip,
			outgoingByChip,
		};
		this.#compiledPlan = plan;
		return plan;
	}

	/**
	 * Validates acyclicity and compiles the structural execution plan for the current revision.
	 * Returns the revision and a copy of the topological execution order.
	 */
	compile(): { revision: number; order: Chip<any, any>[] } {
		const plan = this.#compilePlan();
		return {
			revision: plan.revision,
			order: [...plan.order],
		};
	}

	/**
	 * Returns a fresh array containing the topological execution order of chips.
	 * Mutating the returned array does not affect the cached execution plan.
	 * Throws an Error if the circuit contains a cycle.
	 */
	topoSort(): Chip<any, any>[] {
		const plan = this.#compilePlan();
		return [...plan.order];
	}

	/**
	 * Executes the circuit in topological order.
	 * - Validates and compiles the graph before running any chip processor.
	 * - Keeps all runtime socket values local to this invocation.
	 * - Under "skip-dependents" (default), if a chip processor throws, its error is recorded
	 *   and all downstream chips that depend on it are skipped while independent branches continue.
	 * - Under "fail-fast", a processor exception is rethrown immediately.
	 * - Exceptions thrown by instrumentation callbacks (onChipEnter, onChipLeave, onWireTransmit)
	 *   propagate directly to the caller.
	 */
	run(options?: CircuitRunOptions): CircuitRunResult {
		const plan = this.#compilePlan();
		const order = plan.order;
		const errorPolicy = options?.errorPolicy ?? "skip-dependents";

		const socketValues = new Map<string, unknown>();
		const failedOrSkippedChips = new Set<string>();
		const executedChipIds: string[] = [];
		const skippedChipIds: string[] = [];
		const errors: CircuitProcessorError[] = [];

		for (let i = 0; i < order.length; i++) {
			const chip = order[i];
			const incoming = plan.incomingByChip.get(chip.id)!;

			let blockedByUpstream = false;
			for (let wIdx = 0; wIdx < incoming.length; wIdx++) {
				if (failedOrSkippedChips.has(incoming[wIdx].fromChipId)) {
					blockedByUpstream = true;
					break;
				}
			}

			if (blockedByUpstream) {
				failedOrSkippedChips.add(chip.id);
				skippedChipIds.push(chip.id);
				continue;
			}

			const inputs: Record<string, unknown> = {};
			for (const inSocket of chip._inputSockets()) {
				const key = encodeEndpointKey(chip.id, inSocket.name);
				inputs[inSocket.name] = socketValues.has(key)
					? socketValues.get(key)
					: inSocket.defaultValue;
			}

			const outputs: Record<string, unknown> = {};
			for (const outSocket of chip._outputSockets()) {
				outputs[outSocket.name] = outSocket.defaultValue;
			}

			options?.onChipEnter?.(chip, inputs);

			let processorSucceeded = false;
			try {
				chip.process(inputs, outputs);
				processorSucceeded = true;
			} catch (err) {
				errors.push({ chipId: chip.id, error: err });
				failedOrSkippedChips.add(chip.id);
				options?.onError?.(chip, err);
				if (errorPolicy === "fail-fast") {
					throw err;
				}
			}

			if (!processorSucceeded) {
				continue;
			}

			executedChipIds.push(chip.id);
			options?.onChipLeave?.(chip, outputs);

			const outgoing = plan.outgoingByChip.get(chip.id)!;
			for (let wIdx = 0; wIdx < outgoing.length; wIdx++) {
				const w = outgoing[wIdx];
				const val = outputs[w.fromSocketName];
				const targetKey = encodeEndpointKey(w.toChipId, w.toSocketName);
				socketValues.set(targetKey, val);
				options?.onWireTransmit?.(w, val);
			}
		}

		return {
			completed: errors.length === 0,
			executedChipIds,
			skippedChipIds,
			errors,
		};
	}

	/**
	 * Transactionally merges all chips and wires from otherCircuit into this circuit.
	 * Preflights all chip IDs and wire connections before mutating this circuit.
	 */
	merge(otherCircuit: Circuit): this {
		if (otherCircuit === this) {
			return this;
		}

		for (const [id, otherChip] of otherCircuit.#chips.entries()) {
			const existing = this.#chips.get(id);
			if (existing !== undefined && existing !== otherChip) {
				throw new Error(
					`Circuit.merge: chip ID '${id}' collides with an existing Chip instance in destination circuit.`
				);
			}
		}

		for (let i = 0; i < otherCircuit.#wires.length; i++) {
			const w = otherCircuit.#wires[i];
			const outChip = otherCircuit.#chips.get(w.fromChipId) ?? this.#chips.get(w.fromChipId);
			const inChip = otherCircuit.#chips.get(w.toChipId) ?? this.#chips.get(w.toChipId);
			if (!outChip || !inChip) {
				throw new Error(
					`Circuit.merge: wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName} references a missing chip.`
				);
			}
			const outSocket = outChip.getOutput(w.fromSocketName);
			const inSocket = inChip.getInput(w.toSocketName);
			if (!outSocket || !inSocket || !canConnectInput(inSocket, outSocket)) {
				throw new Error(
					`Circuit.merge: wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName} is invalid.`
				);
			}
		}

		for (const chip of otherCircuit.#chips.values()) {
			this.addChip(chip);
		}
		for (let i = 0; i < otherCircuit.#wires.length; i++) {
			const w = otherCircuit.#wires[i];
			const outChip = this.#chips.get(w.fromChipId)!;
			const inChip = this.#chips.get(w.toChipId)!;
			this.connect(outChip, w.fromSocketName, inChip, w.toSocketName, w.metadata);
		}

		return this;
	}

	/**
	 * Serializes this circuit's topology (chips, sockets, wires, and metadata).
	 * Note: chip processor functions are not serialized.
	 */
	toJSON(): SerializedCircuit {
		return {
			chips: Array.from(this.#chips.values()).map((c) => c.toJSON()),
			wires: this.#wires.map((w) => w.toJSON()),
			metadata: { ...this.metadata },
		};
	}

	/**
	 * Reconstructs a Circuit topology from serialized JSON, binding processor functions
	 * by chip ID from processorRegistry when provided.
	 */
	static fromJSON(
		data: SerializedCircuit,
		processorRegistry: Record<string, ChipProcessor> = {}
	): Circuit {
		const circuit = new Circuit({ ...data.metadata });
		for (const cData of data.chips) {
			const proc = processorRegistry[cData.id];
			const chip = Chip.fromJSON(cData, proc);
			circuit.addChip(chip);
		}
		for (const wData of data.wires) {
			const outChip = circuit.getChip(wData.fromChipId);
			const inChip = circuit.getChip(wData.toChipId);
			if (!outChip || !inChip) {
				throw new Error(
					`Circuit.fromJSON: wire ${wData.fromChipId}.${wData.fromSocketName} -> ${wData.toChipId}.${wData.toSocketName} references an unknown chip.`
				);
			}
			circuit.connect(
				outChip,
				wData.fromSocketName,
				inChip,
				wData.toSocketName,
				{ ...wData.metadata }
			);
		}
		return circuit;
	}
}
