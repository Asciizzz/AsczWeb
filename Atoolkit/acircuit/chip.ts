import { Socket, type SocketOptions } from "./socket.js";
import type { ProcessCtx } from "./types.js";

/**
 * Stateless computational unit with 1-to-1 input sockets and 1-to-N output sockets.
 */
export abstract class Chip {
    readonly id: string;
    readonly name: string;
    readonly inputs = new Map<string, Socket>();
    readonly outputs = new Map<string, Socket>();
    readonly metadata: Record<string, any> = {};

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
    }

    /**
     * Registers an input socket.
     */
    addInput(socketOrName: Socket | string, options?: string | SocketOptions): this {
        let socket: Socket;
        if (typeof socketOrName === "string") {
            socket = new Socket(socketOrName, "input", options);
        } else {
            socket = socketOrName;
        }
        if (socket.direction !== "input") {
            throw new Error(`[Chip] Input socket "${socket.name}" must have input direction.`);
        }
        this.inputs.set(socket.name, socket);
        return this;
    }

    /**
     * Registers an output socket.
     */
    addOutput(socketOrName: Socket | string, dataType?: string): this {
        let socket: Socket;
        if (typeof socketOrName === "string") {
            socket = new Socket(socketOrName, "output", dataType ? { dataType } : {});
        } else {
            socket = socketOrName;
        }
        if (socket.direction !== "output") {
            throw new Error(`[Chip] Output socket "${socket.name}" must have output direction.`);
        }
        this.outputs.set(socket.name, socket);
        return this;
    }

    hasInput(name: string): boolean { return this.inputs.has(name); }
    hasOutput(name: string): boolean { return this.outputs.has(name); }

    getInput<T extends Socket = Socket>(name: string): T | undefined {
        return this.inputs.get(name) as T | undefined;
    }

    getOutput<T extends Socket = Socket>(name: string): T | undefined {
        return this.outputs.get(name) as T | undefined;
    }

    /**
     * Connection validation gate invoked prior to establishing a wire.
     * Enforces socket existence and dataType compatibility when types are declared.
     */
    canConnectInput(
        inSocketName: string,
        outChip: Chip,
        outSocketName: string
    ): boolean {
        const inSocket = this.getInput(inSocketName);
        const outSocket = outChip.getOutput(outSocketName);
        if (!inSocket || !outSocket) return true;

        if (inSocket.dataType !== undefined && outSocket.dataType !== undefined) {
            if (inSocket.dataType === "any" || outSocket.dataType === "any") return true;
            if (inSocket.dataType !== outSocket.dataType) return false;
        }
        return true;
    }

    /**
     * Evaluates the chip from one execution's resolved input values.
     * Input and output values belong to the circuit run, not to the chip.
     */
    abstract process(
        inputs: Record<string, any>,
        ctx?: ProcessCtx<any>
    ): Record<string, any>;
}

/**
 * Transparent proxy chip delegating execution and configuration to a source chip.
 */
export class ChipProxy extends Chip {
    readonly sourceChip: Chip;

    constructor(id: string, sourceChip: Chip) {
        super(id, sourceChip.name);
        this.sourceChip = sourceChip;
        for (const socket of sourceChip.inputs.values()) {
            this.addInput(socket.name, {
                dataType: socket.dataType,
                required: socket.required,
            });
        }
        for (const socket of sourceChip.outputs.values()) {
            this.addOutput(socket.name, socket.dataType);
        }
        Object.assign(this.metadata, sourceChip.metadata);
    }

    override canConnectInput(
        inSocketName: string,
        outChip: Chip,
        outSocketName: string
    ): boolean {
        return this.sourceChip.canConnectInput(inSocketName, outChip, outSocketName);
    }

    override process(
        inputs: Record<string, any>,
        ctx?: ProcessCtx<any>
    ): Record<string, any> {
        return this.sourceChip.process(inputs, ctx);
    }

    clone(newId: string): ChipProxy {
        return new ChipProxy(newId, this.sourceChip);
    }
}
