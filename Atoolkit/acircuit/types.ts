export enum SocketDirection {
	Input = "input",
	Output = "output",
}

export type SocketType = string;

export const WILDCARD_TYPE: SocketType = "*";

export type Metadata = Record<string, unknown>;

export type ChipProcessor<
	TIn extends Record<string, unknown> = Record<string, unknown>,
	TOut extends Record<string, unknown> = Record<string, unknown>
> = (inputs: Readonly<TIn>, outputs: TOut) => void;

export type CircuitErrorPolicy = "skip-dependents" | "fail-fast";

export interface CircuitProcessorError {
	readonly chipId: string;
	readonly error: unknown;
}

export interface CircuitRunResult {
	readonly completed: boolean;
	readonly executedChipIds: readonly string[];
	readonly skippedChipIds: readonly string[];
	readonly errors: readonly CircuitProcessorError[];
}

export interface CircuitRunOptions {
	/**
	 * Policy when a chip's processor throws an exception:
	 * - "skip-dependents" (default): records the error, skips downstream dependent chips,
	 *   and continues executing independent branches.
	 * - "fail-fast": rethrows the processor exception immediately.
	 */
	errorPolicy?: CircuitErrorPolicy;
	/**
	 * Optional hook invoked before a chip's processor executes.
	 * Exceptions thrown by instrumentation hooks propagate directly to the caller of run().
	 */
	onChipEnter?: (chip: any, inputs: Record<string, unknown>) => void;
	/**
	 * Optional hook invoked after a chip's processor succeeds.
	 * Exceptions thrown by instrumentation hooks propagate directly to the caller of run().
	 */
	onChipLeave?: (chip: any, outputs: Record<string, unknown>) => void;
	/**
	 * Optional hook invoked when a wire transmits a value from producer to consumer.
	 * Exceptions thrown by instrumentation hooks propagate directly to the caller of run().
	 */
	onWireTransmit?: (wire: any, value: unknown) => void;
	/**
	 * Optional callback invoked when a processor throws under the "skip-dependents" policy.
	 */
	onError?: (chip: any, error: unknown) => void;
}

export interface SerializedSocket {
	name: string;
	type: SocketType;
	direction: SocketDirection;
	defaultValue?: unknown;
	metadata: Metadata;
}

export interface SerializedChip {
	id: string;
	label: string;
	inputs: SerializedSocket[];
	outputs: SerializedSocket[];
	metadata: Metadata;
}

export interface SerializedWire {
	fromChipId: string;
	fromSocketName: string;
	toChipId: string;
	toSocketName: string;
	metadata: Metadata;
}

/**
 * Topology-only serialization format for a Circuit.
 * Note: processor functions and closures are runtime code and are not included in topology JSON.
 */
export interface SerializedCircuit {
	chips: SerializedChip[];
	wires: SerializedWire[];
	metadata: Metadata;
}
