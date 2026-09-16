import type { Wire } from "./wire.js";
import type { SocketDirection } from "./socket.js";
import type { Chip } from "./chip.js";

export type { Wire };

/**
 * Execution context passed to chip.process(inputs, ctx).
 */
export interface ProcessCtx<TCtx = unknown> {
    /** User context forwarded through execution */
    ctx?: TCtx;
}

/**
 * Configuration for topological runs.
 */
export interface RunOptions<TCtx = unknown, TChip = unknown> {
    /** User context forwarded to chip.process(inputs, ctx) */
    ctx?: TCtx;
    /** Initial input socket values: { [chipId]: { [socketName]: value } } */
    overrides?: Record<string, Record<string, any>>;
    /** Callback invoked before chip execution */
    onChipEnter?: (chip: TChip, inputs: Record<string, any>) => void;
    /** Callback invoked after chip execution */
    onChipLeave?: (chip: TChip, outputs: Record<string, any>) => void;
    /** Callback invoked on wire value resolution */
    onWireTransmit?: (wire: Wire, value: any) => void;
}

/**
 * Result of a circuit execution run.
 */
export interface RunResult<TChip = unknown> {
    /** Mapping of chip ID to computed output socket records */
    outputs: Map<string, Record<string, any>>;
    /** Chips executed in topological order */
    executedChips: TChip[];
    /** Caught execution errors */
    errors: Array<{ chipId: string; error: unknown }>;
}

/**
 * Classification of structural graph validation issue.
 */
export type CircuitIssueType = "cycle" | "missing_input" | "type_mismatch" | "isolated_chip";

/**
 * Diagnostic descriptor representing a validation defect.
 */
export interface CircuitIssue {
    type: CircuitIssueType;
    message: string;
    chipId?: string;
    socketName?: string;
    wire?: Wire;
}

/**
 * Result of static circuit validation pass.
 */
export interface CircuitValidationResult {
    valid: boolean;
    issues: CircuitIssue[];
}

/**
 * Serialized representation of a socket endpoint.
 */
export interface SerializedSocket {
    name: string;
    direction: SocketDirection;
    dataType?: string;
    required?: boolean;
}

/**
 * Serialized representation of a circuit chip.
 */
export interface SerializedChip {
    id: string;
    name: string;
    type?: string;
    inputs: SerializedSocket[];
    outputs: SerializedSocket[];
    metadata?: Record<string, any>;
}

/**
 * Serialized representation of an entire circuit topology.
 */
export interface SerializedCircuit {
    label: string;
    chips: SerializedChip[];
    wires: Wire[];
}

/**
 * Factory callback instantiating a Chip from serialized data.
 */
export type ChipFactory = (serialized: SerializedChip) => Chip;
