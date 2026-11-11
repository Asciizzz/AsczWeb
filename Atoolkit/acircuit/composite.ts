import type { Metadata } from "./types.js";
import { Chip } from "./chip.js";
import type { Circuit } from "./circuit.js";

/**
 * Proxy Chip wrapping an inner Chip under a prefixed ID (`${prefix}/${original.id}`).
 *
 * Note: ChipProxy copies socket definitions so it can be independently wired into a flattened
 * destination Circuit, while delegating its `process` execution to `original.process` (and
 * therefore sharing any closure state captured by `original.process`).
 */
export class ChipProxy extends Chip {
	readonly original: Chip;

	constructor(prefix: string, original: Chip) {
		super(
			`${prefix}/${original.id}`,
			`${prefix}/${original.label}`,
			(inputs, outputs) => original.process(inputs, outputs),
			{ ...original.metadata }
		);
		this.original = original;

		for (const s of original._inputSockets()) {
			this.addInput(s.name, s.type, s.defaultValue, s.metadata);
		}
		for (const s of original._outputSockets()) {
			this.addOutput(s.name, s.type, s.defaultValue, s.metadata);
		}
	}
}

export interface ExposedPortMap {
	readonly innerChipId: string;
	readonly innerSocketName: string;
}

/**
 * Subgraph container that exposes selected inner sockets as external ports and can flatten
 * its internal topology into a parent Circuit using prefixed ChipProxy instances.
 */
export class CompositeChip extends Chip {
	readonly subcircuit: Circuit;
	readonly exposedInputs = new Map<string, ExposedPortMap>();
	readonly exposedOutputs = new Map<string, ExposedPortMap>();

	constructor(id: string, subcircuit: Circuit, label = id, metadata: Metadata = {}) {
		super(id, label, undefined, metadata);
		this.subcircuit = subcircuit;
	}

	/** Exposes an input socket of an inner chip in subcircuit as an input socket on this CompositeChip. */
	exposeInput(
		externalName: string,
		innerChipId: string,
		innerSocketName: string
	): this {
		const innerChip = this.subcircuit.getChip(innerChipId);
		if (!innerChip) {
			throw new Error(`Inner chip '${innerChipId}' not found in subcircuit.`);
		}
		const socket = innerChip.getInput(innerSocketName);
		if (!socket) {
			throw new Error(`Input socket '${innerSocketName}' not found on inner chip '${innerChipId}'.`);
		}

		this.addInput(externalName, socket.type, socket.defaultValue, socket.metadata);
		this.exposedInputs.set(externalName, { innerChipId, innerSocketName });
		return this;
	}

	/** Exposes an output socket of an inner chip in subcircuit as an output socket on this CompositeChip. */
	exposeOutput(
		externalName: string,
		innerChipId: string,
		innerSocketName: string
	): this {
		const innerChip = this.subcircuit.getChip(innerChipId);
		if (!innerChip) {
			throw new Error(`Inner chip '${innerChipId}' not found in subcircuit.`);
		}
		const socket = innerChip.getOutput(innerSocketName);
		if (!socket) {
			throw new Error(`Output socket '${innerSocketName}' not found on inner chip '${innerChipId}'.`);
		}

		this.addOutput(externalName, socket.type, socket.defaultValue, socket.metadata);
		this.exposedOutputs.set(externalName, { innerChipId, innerSocketName });
		return this;
	}

	/**
	 * Transactionally flattens this composite chip's subcircuit into targetCircuit using
	 * prefixed ChipProxy instances (`${this.id}/${innerChip.id}`).
	 * Preflights all proxy IDs and internal wires before modifying targetCircuit.
	 */
	flattenInto(targetCircuit: Circuit): Map<string, ChipProxy> {
		const innerChips = this.subcircuit.chips;
		const innerWires = this.subcircuit.wires;

		for (const innerChip of innerChips.values()) {
			const proxyId = `${this.id}/${innerChip.id}`;
			if (targetCircuit.hasChip(proxyId)) {
				throw new Error(
					`CompositeChip.flattenInto: proxy chip ID '${proxyId}' already exists in targetCircuit.`
				);
			}
		}

		for (let i = 0; i < innerWires.length; i++) {
			const w = innerWires[i];
			const fromInner = innerChips.get(w.fromChipId);
			const toInner = innerChips.get(w.toChipId);
			if (!fromInner || !toInner) {
				throw new Error(
					`CompositeChip.flattenInto: internal wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName} references a missing inner chip.`
				);
			}
			if (!fromInner.hasOutput(w.fromSocketName) || !toInner.hasInput(w.toSocketName)) {
				throw new Error(
					`CompositeChip.flattenInto: internal wire ${w.fromChipId}.${w.fromSocketName} -> ${w.toChipId}.${w.toSocketName} references a missing socket.`
				);
			}
		}

		const proxyMap = new Map<string, ChipProxy>();
		for (const innerChip of innerChips.values()) {
			const proxy = new ChipProxy(this.id, innerChip);
			proxyMap.set(innerChip.id, proxy);
			targetCircuit.addChip(proxy);
		}

		for (let i = 0; i < innerWires.length; i++) {
			const w = innerWires[i];
			const outProxy = proxyMap.get(w.fromChipId)!;
			const inProxy = proxyMap.get(w.toChipId)!;
			targetCircuit.connect(outProxy, w.fromSocketName, inProxy, w.toSocketName, w.metadata);
		}

		return proxyMap;
	}
}
