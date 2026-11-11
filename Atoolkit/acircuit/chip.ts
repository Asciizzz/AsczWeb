import {
	SocketDirection,
	type SocketType,
	type Metadata,
	type ChipProcessor,
	type SerializedChip,
} from "./types.js";
import { Socket } from "./socket.js";

/**
 * Processing node in a Circuit with typed input and output sockets.
 *
 * Structural ownership contract:
 * - While a Chip is registered in one or more Circuits, its input/output port schema
 *   is locked (`isSchemaLocked === true`). Attempting to add or remove sockets on a
 *   locked Chip throws an Error. To modify a chip's schema, remove it from the circuit
 *   or replace it via `circuit.replaceChip(...)`.
 */
export class Chip<
	TIn extends Record<string, unknown> = Record<string, unknown>,
	TOut extends Record<string, unknown> = Record<string, unknown>
> {
	readonly id: string;
	label: string;
	readonly #inputs = new Map<string, Socket>();
	readonly #outputs = new Map<string, Socket>();
	readonly metadata: Metadata;
	process: ChipProcessor<TIn, TOut>;
	#lockedCount = 0;

	constructor(
		id: string,
		label = id,
		process: ChipProcessor<TIn, TOut> = () => {},
		metadata: Metadata = {}
	) {
		if (!id || typeof id !== "string") {
			throw new Error("Chip id must be a non-empty string.");
		}
		this.id = id;
		this.label = label;
		this.process = process;
		this.metadata = { ...metadata };
	}

	/** True when this chip is currently attached to at least one Circuit. */
	get isSchemaLocked(): boolean {
		return this.#lockedCount > 0;
	}

	/** Internal circuit attachment hook locking the chip's port schema. */
	_lockSchema(): void {
		this.#lockedCount++;
	}

	/** Internal circuit detachment hook unlocking the chip's port schema. */
	_unlockSchema(): void {
		if (this.#lockedCount > 0) {
			this.#lockedCount--;
		}
	}

	#assertUnlocked(op: string): void {
		if (this.#lockedCount > 0) {
			throw new Error(
				`Chip.${op}: cannot modify socket schema of chip '${this.id}' while it is attached to a Circuit.`
			);
		}
	}

	/** Snapshot of input sockets keyed by socket name. Mutating the returned Map does not affect the Chip. */
	get inputs(): ReadonlyMap<string, Socket> {
		return new Map(this.#inputs);
	}

	/** Snapshot of output sockets keyed by socket name. Mutating the returned Map does not affect the Chip. */
	get outputs(): ReadonlyMap<string, Socket> {
		return new Map(this.#outputs);
	}

	/** Returns the input socket with the given name, or undefined if absent. */
	getInput(name: string): Socket | undefined {
		return this.#inputs.get(name);
	}

	/** Returns the output socket with the given name, or undefined if absent. */
	getOutput(name: string): Socket | undefined {
		return this.#outputs.get(name);
	}

	/** Returns true if an input socket with the given name exists. */
	hasInput(name: string): boolean {
		return this.#inputs.has(name);
	}

	/** Returns true if an output socket with the given name exists. */
	hasOutput(name: string): boolean {
		return this.#outputs.has(name);
	}

	/** Internal iterator over input sockets without Map snapshot allocation. */
	_inputSockets(): IterableIterator<Socket> {
		return this.#inputs.values();
	}

	/** Internal iterator over output sockets without Map snapshot allocation. */
	_outputSockets(): IterableIterator<Socket> {
		return this.#outputs.values();
	}

	/** Declares an input socket on this chip. Throws if the chip is currently attached to a Circuit. */
	addInput<T = unknown>(
		name: string,
		type: SocketType,
		defaultValue?: T,
		metadata: Metadata = {}
	): this {
		this.#assertUnlocked("addInput");
		if (this.#inputs.has(name)) {
			throw new Error(`Input socket '${name}' already exists on chip '${this.id}'.`);
		}
		this.#inputs.set(
			name,
			new Socket(name, type, SocketDirection.Input, defaultValue, metadata)
		);
		return this;
	}

	/** Declares an output socket on this chip. Throws if the chip is currently attached to a Circuit. */
	addOutput<T = unknown>(
		name: string,
		type: SocketType,
		defaultValue?: T,
		metadata: Metadata = {}
	): this {
		this.#assertUnlocked("addOutput");
		if (this.#outputs.has(name)) {
			throw new Error(`Output socket '${name}' already exists on chip '${this.id}'.`);
		}
		this.#outputs.set(
			name,
			new Socket(name, type, SocketDirection.Output, defaultValue, metadata)
		);
		return this;
	}

	/** Removes an input socket by name. Throws if the chip is currently attached to a Circuit. */
	removeInput(name: string): boolean {
		this.#assertUnlocked("removeInput");
		return this.#inputs.delete(name);
	}

	/** Removes an output socket by name. Throws if the chip is currently attached to a Circuit. */
	removeOutput(name: string): boolean {
		this.#assertUnlocked("removeOutput");
		return this.#outputs.delete(name);
	}

	/** Serializes this chip's topology metadata and socket definitions (excluding its processor function). */
	toJSON(): SerializedChip {
		return {
			id: this.id,
			label: this.label,
			inputs: Array.from(this.#inputs.values()).map((s) => s.toJSON()),
			outputs: Array.from(this.#outputs.values()).map((s) => s.toJSON()),
			metadata: { ...this.metadata },
		};
	}

	/** Reconstructs a Chip's socket topology from serialized data using the optional processor function. */
	static fromJSON(data: SerializedChip, process?: ChipProcessor): Chip {
		const chip = new Chip(data.id, data.label, process, { ...data.metadata });
		for (const sData of data.inputs) {
			chip.#inputs.set(sData.name, Socket.fromJSON(sData));
		}
		for (const sData of data.outputs) {
			chip.#outputs.set(sData.name, Socket.fromJSON(sData));
		}
		return chip;
	}
}
