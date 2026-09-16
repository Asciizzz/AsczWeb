/**
 * Communication endpoint direction.
 */
export type SocketDirection = "input" | "output";

export interface SocketOptions {
    dataType?: string;
    required?: boolean;
}

/**
 * Communication endpoint on a Chip.
 * Identifies an input or output endpoint on a chip with optional type and requirement tags.
 */
export class Socket {
    readonly name: string;
    readonly direction: SocketDirection;
    readonly dataType?: string;
    readonly required: boolean;

    constructor(
        name: string,
        direction: SocketDirection = "input",
        options: SocketOptions | string = {}
    ) {
        this.name = name;
        this.direction = direction;
        if (typeof options === "string") {
            this.dataType = options;
            this.required = true;
        } else {
            this.dataType = options.dataType;
            this.required = options.required ?? true;
        }
    }
}
