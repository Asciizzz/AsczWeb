import {
	SocketDirection,
	type SocketType,
	WILDCARD_TYPE,
	type Metadata,
	type SerializedSocket,
} from "./types.js";

/**
 * Typed input or output port definition on a Chip.
 */
export class Socket<T = unknown> {
	readonly name: string;
	readonly type: SocketType;
	readonly direction: SocketDirection;
	defaultValue?: T;
	readonly metadata: Metadata;

	constructor(
		name: string,
		type: SocketType,
		direction: SocketDirection,
		defaultValue?: T,
		metadata: Metadata = {}
	) {
		if (!name || typeof name !== "string") {
			throw new Error("Socket name must be a non-empty string.");
		}
		if (!type || typeof type !== "string") {
			throw new Error("Socket type must be a non-empty string.");
		}
		this.name = name;
		this.type = type;
		this.direction = direction;
		this.defaultValue = defaultValue;
		this.metadata = { ...metadata };
	}

	/**
	 * Returns true if this socket is type-compatible with otherType.
	 * Wildcard ("*") matches any socket type.
	 */
	acceptsType(otherType: SocketType): boolean {
		if (this.type === WILDCARD_TYPE || otherType === WILDCARD_TYPE) {
			return true;
		}
		return this.type === otherType;
	}

	toJSON(): SerializedSocket {
		return {
			name: this.name,
			type: this.type,
			direction: this.direction,
			defaultValue: this.defaultValue,
			metadata: { ...this.metadata },
		};
	}

	static fromJSON(data: SerializedSocket): Socket {
		return new Socket(
			data.name,
			data.type,
			data.direction,
			data.defaultValue,
			{ ...data.metadata }
		);
	}
}
