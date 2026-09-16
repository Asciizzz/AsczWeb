import { Chip } from "./chip.js";
import type { Circuit } from "./circuit.js";
import type { ProcessCtx } from "./types.js";

export interface InputSocketMapping {
    outerSocket: string;
    innerChipId: string;
    innerSocket: string;
}

export interface OutputSocketMapping {
    outerSocket: string;
    innerChipId: string;
    innerSocket: string;
}

/**
 * Composite chip encapsulating an inner Circuit graph.
 */
export class Subcircuit extends Chip {
    readonly innerCircuit: Circuit;
    readonly inputMappings = new Map<string, InputSocketMapping>();
    readonly outputMappings = new Map<string, OutputSocketMapping>();

    constructor(id: string, name: string, innerCircuit: Circuit) {
        super(id, name);
        this.innerCircuit = innerCircuit;
    }

    /**
     * Maps an external input socket to an internal chip's input socket.
     */
    mapInput(
        outerSocketName: string,
        innerChipId: string,
        innerSocketName: string,
        dataType?: string
    ): this {
        const innerChip = this.innerCircuit.getChip(innerChipId);
        if (!innerChip) {
            throw new Error(`[Subcircuit] Inner chip "${innerChipId}" not found in subcircuit.`);
        }
        const innerSocket = innerChip.getInput(innerSocketName);
        if (!innerSocket) {
            throw new Error(`[Subcircuit] Inner input socket "${innerChipId}:${innerSocketName}" not found.`);
        }
        const effectiveType = dataType ?? innerSocket.dataType;
        this.addInput(outerSocketName, effectiveType);
        this.inputMappings.set(outerSocketName, {
            outerSocket: outerSocketName,
            innerChipId,
            innerSocket: innerSocketName,
        });
        return this;
    }

    /**
     * Maps an internal chip's output socket to an external output socket.
     */
    mapOutput(
        outerSocketName: string,
        innerChipId: string,
        innerSocketName: string,
        dataType?: string
    ): this {
        const innerChip = this.innerCircuit.getChip(innerChipId);
        if (!innerChip) {
            throw new Error(`[Subcircuit] Inner chip "${innerChipId}" not found in subcircuit.`);
        }
        const innerSocket = innerChip.getOutput(innerSocketName);
        if (!innerSocket) {
            throw new Error(`[Subcircuit] Inner output socket "${innerChipId}:${innerSocketName}" not found.`);
        }
        const effectiveType = dataType ?? innerSocket.dataType;
        this.addOutput(outerSocketName, effectiveType);
        this.outputMappings.set(outerSocketName, {
            outerSocket: outerSocketName,
            innerChipId,
            innerSocket: innerSocketName,
        });
        return this;
    }

    override process(
        inputs: Record<string, any>,
        ctx?: ProcessCtx<any>
    ): Record<string, any> {
        const overrides: Record<string, Record<string, any>> = {};

        for (const [outerName, mapping] of this.inputMappings) {
            const val = inputs[outerName];
            if (val !== undefined) {
                let chipOverrides = overrides[mapping.innerChipId];
                if (!chipOverrides) {
                    chipOverrides = {};
                    overrides[mapping.innerChipId] = chipOverrides;
                }
                chipOverrides[mapping.innerSocket] = val;
            }
        }

        const runResult = this.innerCircuit.run({
            overrides,
            ctx: ctx?.ctx,
        });

        if (runResult.errors.length > 0) {
            const first = runResult.errors[0];
            throw first.error instanceof Error
                ? first.error
                : new Error(`[Subcircuit] Inner execution failed on chip "${first.chipId}": ${String(first.error)}`);
        }

        const outputs: Record<string, any> = {};
        for (const [outerName, mapping] of this.outputMappings) {
            const chipOuts = runResult.outputs.get(mapping.innerChipId);
            if (chipOuts && chipOuts[mapping.innerSocket] !== undefined) {
                outputs[outerName] = chipOuts[mapping.innerSocket];
            }
        }

        return outputs;
    }
}
