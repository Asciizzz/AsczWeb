/**
 * Communication endpoint direction.
 */
export type SocketDirection = "input" | "output";

export class Socket {
    readonly name: string;
    readonly direction: SocketDirection;
    readonly dataType?: string;
    readonly required: boolean;

    constructor(
        name: string,
        direction: SocketDirection = "input",
        dataType?: string,
        required = true
    ) {
        this.name = name;
        this.direction = direction;
        this.dataType = dataType;
        this.required = required;
    }
}
