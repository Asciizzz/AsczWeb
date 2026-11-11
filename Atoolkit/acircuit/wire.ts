import { SocketDirection, type Metadata, type SerializedWire } from "./types.js";
import type { Socket } from "./socket.js";

/**
 * Encodes a (chipId, socketName) pair into an unambiguous length-prefixed key.
 * Distinct pairs never collide even when chipId or socketName contains colons.
 */
export function encodeEndpointKey(chipId: string, socketName: string): string {
	return `${chipId.length}:${chipId}:${socketName}`;
}

/**
 * Returns the unambiguous length-prefixed key for a wire's destination input endpoint.
 */
export function inSocketKey(wire: Wire): string {
	return encodeEndpointKey(wire.toChipId, wire.toSocketName);
}

/**
 * Returns the unambiguous length-prefixed key for a wire's source output endpoint.
 */
export function outSocketKey(wire: Wire): string {
	return encodeEndpointKey(wire.fromChipId, wire.fromSocketName);
}

/**
 * Validates whether an output socket can connect to an input socket.
 */
export function canConnectInput(inSocket: Socket, outSocket: Socket): boolean {
	if (inSocket.direction !== SocketDirection.Input) return false;
	if (outSocket.direction !== SocketDirection.Output) return false;
	return inSocket.acceptsType(outSocket.type);
}

/**
 * Directed connection from an output socket on one Chip to an input socket on another Chip.
 */
export class Wire {
	readonly fromChipId: string;
	readonly fromSocketName: string;
	readonly toChipId: string;
	readonly toSocketName: string;
	readonly metadata: Metadata;

	constructor(
		fromChipId: string,
		fromSocketName: string,
		toChipId: string,
		toSocketName: string,
		metadata: Metadata = {}
	) {
		this.fromChipId = fromChipId;
		this.fromSocketName = fromSocketName;
		this.toChipId = toChipId;
		this.toSocketName = toSocketName;
		this.metadata = { ...metadata };
	}

	toJSON(): SerializedWire {
		return {
			fromChipId: this.fromChipId,
			fromSocketName: this.fromSocketName,
			toChipId: this.toChipId,
			toSocketName: this.toSocketName,
			metadata: { ...this.metadata },
		};
	}

	static fromJSON(data: SerializedWire): Wire {
		return new Wire(
			data.fromChipId,
			data.fromSocketName,
			data.toChipId,
			data.toSocketName,
			{ ...data.metadata }
		);
	}
}
