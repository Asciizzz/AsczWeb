import { Chip, ChipProxy } from "./chip.js";
import {
    type Wire,
    inSocketKey,
    outSocketKey,
    wireEquals,
} from "./wire.js";
import type {
    ProcessCtx,
    RunOptions,
    RunResult,
    CircuitValidationResult,
    CircuitIssue,
    SerializedCircuit,
    ChipFactory,
} from "./types.js";
import type { InputSocketMapping, OutputSocketMapping } from "./composite.js";

export interface CircuitOptions {
    label?: string;
}

/**
 * Directed graph with 1-to-1 input wires and 1-to-N output fan-out.
 * Chip values exist only in the scope of a run.
 */
export class Circuit {
    readonly label: string;
    readonly chips = new Map<string, Chip>();

    /** Inward wires:  "inChipId:inSocket"   -> Wire (1-to-1). */
    private readonly _inWires  = new Map<string, Wire>();
    /** Outward wires: "outChipId:outSocket" -> Wire[] (1-to-N). */
    private readonly _outWires = new Map<string, Wire[]>();
    /** Inward wires grouped by destination chip ID. */
    private readonly _chipInWires = new Map<string, Wire[]>();
    /** Outward wires grouped by source chip ID. */
    private readonly _chipOutWires = new Map<string, Wire[]>();

    private _dirtyTopo = true;
    private _cachedOrder: Chip[] = [];
    private _cachedPlan: Array<{
        chip: Chip;
        inputSockets: string[];
        wires: Array<Wire | undefined>;
    }> = [];

    constructor(options: CircuitOptions = {}) {
        this.label = options.label ?? "Circuit";
    }

    private _addChipWire(map: Map<string, Wire[]>, chipId: string, wire: Wire): void {
        const list = map.get(chipId);
        if (list) list.push(wire);
        else map.set(chipId, [wire]);
    }

    private _removeChipWire(map: Map<string, Wire[]>, chipId: string, wire: Wire): void {
        const list = map.get(chipId);
        if (list) {
            const idx = list.findIndex(candidate => wireEquals(candidate, wire));
            if (idx >= 0) list.splice(idx, 1);
            if (list.length === 0) map.delete(chipId);
        }
    }

    addChip(chip: Chip): this {
        if (!this.chips.has(chip.id)) {
            this.chips.set(chip.id, chip);
            this._dirtyTopo = true;
        }
        return this;
    }

    hasChip(id: string): boolean {
        return this.chips.has(id);
    }

    getChip<T extends Chip = Chip>(id: string): T | undefined {
        return this.chips.get(id) as T | undefined;
    }

    removeChip(chipOrId: Chip | string): this {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        this.disconnectAll(id);
        if (this.chips.delete(id)) {
            this._dirtyTopo = true;
        }
        return this;
    }

    /**
     * Connects an output socket to an input socket, replacing any existing
     * connection on the destination input.
     */
    connect(
        outChipOrId: Chip | string,
        outSocketName: string,
        inChipOrId: Chip | string,
        inSocketName: string
    ): Wire {
        const outChip = typeof outChipOrId === "string" ? this.getChip(outChipOrId) : outChipOrId;
        const inChip = typeof inChipOrId === "string" ? this.getChip(inChipOrId) : inChipOrId;

        if (!outChip) throw new Error(`[Circuit] Output chip "${String(outChipOrId)}" not found in graph.`);
        if (!inChip) throw new Error(`[Circuit] Input chip "${String(inChipOrId)}" not found in graph.`);

        const registeredOut = this.chips.get(outChip.id);
        const registeredIn = this.chips.get(inChip.id);
        if (registeredOut && registeredOut !== outChip) {
            throw new Error(`[Circuit] Chip id "${outChip.id}" is already registered with a different output chip.`);
        }
        if (registeredIn && registeredIn !== inChip) {
            throw new Error(`[Circuit] Chip id "${inChip.id}" is already registered with a different input chip.`);
        }

        this.addChip(outChip);
        this.addChip(inChip);

        if (!outChip.getOutput(outSocketName)) {
            throw new Error(`[Circuit] Chip "${outChip.id}" has no output socket named "${outSocketName}".`);
        }
        if (!inChip.getInput(inSocketName)) {
            throw new Error(`[Circuit] Chip "${inChip.id}" has no input socket named "${inSocketName}".`);
        }
        if (!inChip.canConnectInput(inSocketName, outChip, outSocketName)) {
            throw new Error(`[Circuit] Connection rejected by chip "${inChip.id}" on input socket "${inSocketName}".`);
        }

        this.disconnect(inChip.id, inSocketName);

        const wire: Wire = {
            outChipId: outChip.id,
            outSocket: outSocketName,
            inChipId: inChip.id,
            inSocket: inSocketName,
        };

        this._inWires.set(inSocketKey(inChip.id, inSocketName), wire);
        this._addChipWire(this._chipInWires, inChip.id, wire);

        const outKey = outSocketKey(outChip.id, outSocketName);
        const outWires = this._outWires.get(outKey);
        if (outWires) outWires.push(wire);
        else this._outWires.set(outKey, [wire]);
        this._addChipWire(this._chipOutWires, outChip.id, wire);

        this._dirtyTopo = true;
        return wire;
    }

    disconnect(wireOrChipId: Wire | Chip | string, inSocketName?: string): boolean {
        let wire: Wire | undefined;
        if (typeof wireOrChipId === "object" && "outChipId" in wireOrChipId) {
            wire = wireOrChipId;
        } else if (inSocketName !== undefined) {
            const chipId = typeof wireOrChipId === "string" ? wireOrChipId : wireOrChipId.id;
            wire = this._inWires.get(inSocketKey(chipId, inSocketName));
        }
        if (!wire) return false;

        const inKey = inSocketKey(wire.inChipId, wire.inSocket);
        const existing = this._inWires.get(inKey);
        if (!existing || !wireEquals(existing, wire)) return false;

        this._inWires.delete(inKey);
        this._removeChipWire(this._chipInWires, wire.inChipId, wire);

        const outKey = outSocketKey(wire.outChipId, wire.outSocket);
        const outWires = this._outWires.get(outKey);
        if (outWires) {
            const index = outWires.findIndex(candidate => wireEquals(candidate, wire!));
            if (index >= 0) outWires.splice(index, 1);
            if (outWires.length === 0) this._outWires.delete(outKey);
        }
        this._removeChipWire(this._chipOutWires, wire.outChipId, wire);

        this._dirtyTopo = true;
        return true;
    }

    disconnectAll(chipOrId: Chip | string): this {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        for (const wire of this.getIncomingWires(id)) this.disconnect(wire);
        for (const wire of this.getOutgoingWires(id)) this.disconnect(wire);
        this._dirtyTopo = true;
        return this;
    }

    getIncomingWire(chipOrId: Chip | string, socketName: string): Wire | undefined {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        return this._inWires.get(inSocketKey(id, socketName));
    }

    getIncomingWires(chipOrId: Chip | string): Wire[] {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        return [...(this._chipInWires.get(id) ?? [])];
    }

    getOutgoingWires(chipOrId: Chip | string, socketName?: string): Wire[] {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        if (socketName) return [...(this._outWires.get(outSocketKey(id, socketName)) ?? [])];
        return [...(this._chipOutWires.get(id) ?? [])];
    }

    getWires(): Wire[] {
        return Array.from(this._inWires.values());
    }

    /** Returns all chips in dependency order and rejects cycles. */
    topoSort<T extends Chip = Chip>(force = false): T[] {
        if (!this._dirtyTopo && !force) {
            return this._cachedOrder as T[];
        }

        const inDeps = new Map<string, Set<string>>();
        const outDeps = new Map<string, Set<string>>();

        for (const chipId of this.chips.keys()) {
            inDeps.set(chipId, new Set());
            outDeps.set(chipId, new Set());
        }
        for (const wire of this._inWires.values()) {
            if (!this.chips.has(wire.outChipId) || !this.chips.has(wire.inChipId)) continue;
            inDeps.get(wire.inChipId)!.add(wire.outChipId);
            outDeps.get(wire.outChipId)!.add(wire.inChipId);
        }

        const ready: string[] = [];
        for (const [chipId, dependencies] of inDeps) {
            if (dependencies.size === 0) ready.push(chipId);
        }

        const sorted: Chip[] = [];
        let head = 0;
        while (head < ready.length) {
            const chipId = ready[head++];
            const chip = this.chips.get(chipId);
            if (chip) sorted.push(chip);

            for (const dependentId of outDeps.get(chipId)!) {
                const dependencies = inDeps.get(dependentId)!;
                dependencies.delete(chipId);
                if (dependencies.size === 0) ready.push(dependentId);
            }
        }

        if (sorted.length !== this.chips.size) {
            throw new Error(`[Circuit] Cyclic dependency detected in graph "${this.label}".`);
        }
        this._cachedOrder = sorted;
        this._cachedPlan = sorted.map(chip => {
            const inputSockets = Array.from(chip.inputs.keys());
            const wires = inputSockets.map(s => this.getIncomingWire(chip, s));
            return { chip, inputSockets, wires };
        });
        this._dirtyTopo = false;
        return sorted as T[];
    }

    /** Executes chips in topological order with run-local input and output values. */
    run<TCtx = unknown>(options: RunOptions<TCtx, Chip> = {}): RunResult<Chip> {
        this.topoSort();
        const plan = this._cachedPlan;
        const outputs = new Map<string, Record<string, any>>();
        const executedChips: Chip[] = [];
        const errors: Array<{ chipId: string; error: unknown }> = [];

        const ctx: ProcessCtx<TCtx> = { ctx: options.ctx };
        const overrides = options.overrides;
        const onWireTransmit = options.onWireTransmit;
        const onChipEnter = options.onChipEnter;
        const onChipLeave = options.onChipLeave;

        for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            const chip = step.chip;
            const sockets = step.inputSockets;
            const wires = step.wires;
            const socketCount = sockets.length;
            const inputs: Record<string, any> = {};

            for (let s = 0; s < socketCount; s++) {
                const socketName = sockets[s];
                const wire = wires[s];
                if (!wire) {
                    inputs[socketName] = overrides?.[chip.id]?.[socketName];
                    continue;
                }

                const value = outputs.get(wire.outChipId)?.[wire.outSocket];
                inputs[socketName] = value;
                if (value !== undefined) onWireTransmit?.(wire, value);
            }

            onChipEnter?.(chip, inputs);

            let chipOutputs: Record<string, any> = {};
            try {
                chipOutputs = chip.process(inputs, ctx);
            } catch (error) {
                errors.push({ chipId: chip.id, error });
            }

            outputs.set(chip.id, chipOutputs);
            executedChips.push(chip);
            onChipLeave?.(chip, chipOutputs);
        }

        return { outputs, executedChips, errors };
    }

    /**
     * Statically analyzes graph topology without throwing errors.
     * Identifies cycles, missing required inputs, type mismatches, and isolated chips.
     */
    validate(): CircuitValidationResult {
        const issues: CircuitIssue[] = [];

        // 1. Cycle detection pass
        const inDeps = new Map<string, Set<string>>();
        const outDeps = new Map<string, Set<string>>();

        for (const chipId of this.chips.keys()) {
            inDeps.set(chipId, new Set());
            outDeps.set(chipId, new Set());
        }
        for (const wire of this._inWires.values()) {
            if (!this.chips.has(wire.outChipId) || !this.chips.has(wire.inChipId)) continue;
            inDeps.get(wire.inChipId)!.add(wire.outChipId);
            outDeps.get(wire.outChipId)!.add(wire.inChipId);
        }

        const ready: string[] = [];
        for (const [chipId, dependencies] of inDeps) {
            if (dependencies.size === 0) ready.push(chipId);
        }

        let processed = 0;
        let head = 0;
        while (head < ready.length) {
            const chipId = ready[head++];
            processed++;
            for (const dependentId of outDeps.get(chipId)!) {
                const dependencies = inDeps.get(dependentId)!;
                dependencies.delete(chipId);
                if (dependencies.size === 0) ready.push(dependentId);
            }
        }

        if (processed !== this.chips.size) {
            issues.push({
                type: "cycle",
                message: `Cyclic dependency detected in graph "${this.label}".`,
            });
        }

        // 2. Missing required inputs pass
        for (const chip of this.chips.values()) {
            for (const socket of chip.inputs.values()) {
                if (socket.required && !this.getIncomingWire(chip.id, socket.name)) {
                    issues.push({
                        type: "missing_input",
                        message: `Required input "${socket.name}" on chip "${chip.id}" has no incoming wire.`,
                        chipId: chip.id,
                        socketName: socket.name,
                    });
                }
            }
        }

        // 3. Socket type mismatch pass
        for (const wire of this._inWires.values()) {
            const outChip = this.chips.get(wire.outChipId);
            const inChip = this.chips.get(wire.inChipId);
            if (!outChip || !inChip) continue;

            const outSocket = outChip.getOutput(wire.outSocket);
            const inSocket = inChip.getInput(wire.inSocket);
            if (!outSocket || !inSocket) continue;

            if (outSocket.dataType !== undefined && inSocket.dataType !== undefined) {
                if (outSocket.dataType !== "any" && inSocket.dataType !== "any" && outSocket.dataType !== inSocket.dataType) {
                    issues.push({
                        type: "type_mismatch",
                        message: `Type mismatch on wire (${wire.outChipId}:${wire.outSocket} [${outSocket.dataType}] -> ${wire.inChipId}:${wire.inSocket} [${inSocket.dataType}]).`,
                        chipId: wire.inChipId,
                        socketName: wire.inSocket,
                        wire,
                    });
                }
            }
        }

        // 4. Isolated chips pass
        for (const chip of this.chips.values()) {
            const inWires = this.getIncomingWires(chip.id);
            const outWires = this.getOutgoingWires(chip.id);
            if (inWires.length === 0 && outWires.length === 0) {
                issues.push({
                    type: "isolated_chip",
                    message: `Chip "${chip.id}" has zero connections.`,
                    chipId: chip.id,
                });
            }
        }

        return {
            valid: issues.length === 0,
            issues,
        };
    }

    /** Returns chips with indegree 0 (zero incoming connections). */
    getSources(): Chip[] {
        const sources: Chip[] = [];
        for (const chip of this.chips.values()) {
            if (this.getIncomingWires(chip.id).length === 0) {
                sources.push(chip);
            }
        }
        return sources;
    }

    /** Returns chips with outdegree 0 (zero outgoing connections). */
    getSinks(): Chip[] {
        const sinks: Chip[] = [];
        for (const chip of this.chips.values()) {
            if (this.getOutgoingWires(chip.id).length === 0) {
                sinks.push(chip);
            }
        }
        return sinks;
    }

    /** Returns all transitive upstream ancestor chips feeding into the target chip. */
    getUpstreamChips(chipOrId: Chip | string): Set<Chip> {
        const targetId = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        const result = new Set<Chip>();
        const queue: string[] = [targetId];
        const visited = new Set<string>([targetId]);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const inWires = this.getIncomingWires(currentId);
            for (let i = 0; i < inWires.length; i++) {
                const upId = inWires[i].outChipId;
                if (!visited.has(upId)) {
                    visited.add(upId);
                    const upChip = this.chips.get(upId);
                    if (upChip) {
                        result.add(upChip);
                        queue.push(upId);
                    }
                }
            }
        }
        return result;
    }

    /** Returns all transitive downstream descendant chips fed by the target chip. */
    getDownstreamChips(chipOrId: Chip | string): Set<Chip> {
        const targetId = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        const result = new Set<Chip>();
        const queue: string[] = [targetId];
        const visited = new Set<string>([targetId]);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const outWires = this.getOutgoingWires(currentId);
            for (let i = 0; i < outWires.length; i++) {
                const downId = outWires[i].inChipId;
                if (!visited.has(downId)) {
                    visited.add(downId);
                    const downChip = this.chips.get(downId);
                    if (downChip) {
                        result.add(downChip);
                        queue.push(downId);
                    }
                }
            }
        }
        return result;
    }

    /** Returns whether a directed path exists from source chip to target chip. */
    isReachable(fromChipOrId: Chip | string, toChipOrId: Chip | string): boolean {
        const targetId = typeof toChipOrId === "string" ? toChipOrId : toChipOrId.id;
        const downstream = this.getDownstreamChips(fromChipOrId);
        for (const chip of downstream) {
            if (chip.id === targetId) return true;
        }
        return false;
    }

    /**
     * Dead code elimination: prunes chips that do not reach target chips.
     * When targetChipIds is omitted, preserves all chips reaching circuit sinks.
     */
    pruneUnreachable(targetChipIds?: string[]): this {
        const retainIds = new Set<string>();

        const seeds = targetChipIds !== undefined
            ? targetChipIds
            : this.getSinks().map(c => c.id);

        for (let i = 0; i < seeds.length; i++) {
            const seedId = seeds[i];
            if (this.chips.has(seedId)) {
                retainIds.add(seedId);
                const upstream = this.getUpstreamChips(seedId);
                for (const up of upstream) {
                    retainIds.add(up.id);
                }
            }
        }

        for (const chipId of Array.from(this.chips.keys())) {
            if (!retainIds.has(chipId)) {
                this.removeChip(chipId);
            }
        }

        return this;
    }

    /**
     * Extracts an isolated subcircuit containing only the specified target chips,
     * their transitive upstream dependencies, and internal interconnecting wires.
     */
    extractSubgraph(targetChipIds: string[], options: CircuitOptions = {}): Circuit {
        const sub = new Circuit({ label: options.label ?? `${this.label}_subgraph` });
        const retainIds = new Set<string>();

        for (let i = 0; i < targetChipIds.length; i++) {
            const seedId = targetChipIds[i];
            if (this.chips.has(seedId)) {
                retainIds.add(seedId);
                const upstream = this.getUpstreamChips(seedId);
                for (const up of upstream) {
                    retainIds.add(up.id);
                }
            }
        }

        for (const id of retainIds) {
            const chip = this.chips.get(id);
            if (chip) {
                const chipCopy = (typeof (chip as any).clone === "function")
                    ? (chip as any).clone(chip.id)
                    : new ChipProxy(chip.id, chip);
                sub.addChip(chipCopy);
            }
        }

        for (const wire of this._inWires.values()) {
            if (retainIds.has(wire.outChipId) && retainIds.has(wire.inChipId)) {
                sub.connect(wire.outChipId, wire.outSocket, wire.inChipId, wire.inSocket);
            }
        }

        return sub;
    }

    /**
     * Inlines a composite subcircuit chip directly into this graph,
     * expanding its inner chips and rerouting external wires.
     */
    flatten(chipOrId: Chip | string, prefix?: string): this {
        const id = typeof chipOrId === "string" ? chipOrId : chipOrId.id;
        const chip = this.getChip(id);
        if (!chip) {
            throw new Error(`[Circuit] Chip "${id}" not found in circuit.`);
        }

        const composite = chip as any;
        if (!composite.innerCircuit || !composite.inputMappings || !composite.outputMappings) {
            throw new Error(`[Circuit] Chip "${id}" is not a composite subcircuit chip.`);
        }

        const innerCircuit = composite.innerCircuit as Circuit;
        const p = prefix ?? `${id}_`;

        // 1. Inline internal chips
        for (const innerChip of innerCircuit.chips.values()) {
            const inlinedId = `${p}${innerChip.id}`;
            const cloned = (typeof (innerChip as any).clone === "function")
                ? (innerChip as any).clone(inlinedId)
                : new ChipProxy(inlinedId, innerChip);
            this.addChip(cloned);
        }

        // 2. Inline internal wires
        for (const wire of innerCircuit.getWires()) {
            this.connect(
                `${p}${wire.outChipId}`,
                wire.outSocket,
                `${p}${wire.inChipId}`,
                wire.inSocket
            );
        }

        // 3. Reroute incoming external wires to inner targets
        const inWires = this.getIncomingWires(id);
        for (let i = 0; i < inWires.length; i++) {
            const inWire = inWires[i];
            const mapping = composite.inputMappings.get(inWire.inSocket) as InputSocketMapping | undefined;
            if (mapping) {
                this.connect(
                    inWire.outChipId,
                    inWire.outSocket,
                    `${p}${mapping.innerChipId}`,
                    mapping.innerSocket
                );
            }
        }

        // 4. Reroute outgoing external wires from inner sources
        const outWires = this.getOutgoingWires(id);
        for (let i = 0; i < outWires.length; i++) {
            const outWire = outWires[i];
            const mapping = composite.outputMappings.get(outWire.outSocket) as OutputSocketMapping | undefined;
            if (mapping) {
                this.connect(
                    `${p}${mapping.innerChipId}`,
                    mapping.innerSocket,
                    outWire.inChipId,
                    outWire.inSocket
                );
            }
        }

        // 5. Remove original composite wrapper
        this.removeChip(id);
        return this;
    }

    /** Clones this circuit graph with optional custom chip factory. */
    clone(chipCloner?: (chip: Chip) => Chip): Circuit {
        const cloner = chipCloner ?? ((c: Chip) => (
            typeof (c as any).clone === "function"
                ? (c as any).clone(c.id)
                : new ChipProxy(c.id, c)
        ));

        const copy = new Circuit({ label: this.label });
        for (const chip of this.chips.values()) {
            copy.addChip(cloner(chip));
        }
        for (const wire of this.getWires()) {
            copy.connect(wire.outChipId, wire.outSocket, wire.inChipId, wire.inSocket);
        }
        return copy;
    }

    /** Merges another circuit graph into this one, optionally applying a prefix to chip IDs. */
    merge(other: Circuit, prefix = ""): this {
        for (const chip of other.chips.values()) {
            const newId = prefix ? `${prefix}${chip.id}` : chip.id;
            const chipCopy = (typeof (chip as any).clone === "function")
                ? (chip as any).clone(newId)
                : new ChipProxy(newId, chip);
            this.addChip(chipCopy);
        }
        for (const wire of other.getWires()) {
            const outId = prefix ? `${prefix}${wire.outChipId}` : wire.outChipId;
            const inId = prefix ? `${prefix}${wire.inChipId}` : wire.inChipId;
            this.connect(outId, wire.outSocket, inId, wire.inSocket);
        }
        return this;
    }

    /** Serializes circuit topology into a portable JSON structure. */
    toJSON(): SerializedCircuit {
        return {
            label: this.label,
            chips: Array.from(this.chips.values()).map(chip => ({
                id: chip.id,
                name: chip.name,
                inputs: Array.from(chip.inputs.values()).map(s => ({
                    name: s.name,
                    direction: s.direction,
                    dataType: s.dataType,
                    required: s.required,
                })),
                outputs: Array.from(chip.outputs.values()).map(s => ({
                    name: s.name,
                    direction: s.direction,
                    dataType: s.dataType,
                })),
                metadata: Object.keys(chip.metadata).length > 0 ? { ...chip.metadata } : undefined,
            })),
            wires: this.getWires(),
        };
    }

    /** Reconstructs a Circuit graph from serialized JSON using a chip factory. */
    static fromJSON(json: SerializedCircuit, chipFactory: ChipFactory): Circuit {
        const circuit = new Circuit({ label: json.label });
        for (let i = 0; i < json.chips.length; i++) {
            const chip = chipFactory(json.chips[i]);
            circuit.addChip(chip);
        }
        for (let i = 0; i < json.wires.length; i++) {
            const w = json.wires[i];
            circuit.connect(w.outChipId, w.outSocket, w.inChipId, w.inSocket);
        }
        return circuit;
    }
}
