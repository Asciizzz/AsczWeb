/**
 * Directed connection between output socket and input socket in Circuit graph.
 *
 * - Output sockets support 1-to-N fan-out.
 * - Input sockets enforce 1-to-1 connection.
 */
export interface Wire {
    readonly outChipId: string;
    readonly outSocket: string;
    readonly inChipId: string;
    readonly inSocket: string;
}

/**
 * Returns the lookup key for a socket endpoint.
 */
export function inSocketKey(chipId: string, socketName: string): string {
    return `${chipId}:${socketName}`;
}

export const outSocketKey = inSocketKey;

/**
 * Compares two Wire instances for matching endpoints.
 */
export function wireEquals(a: Wire, b: Wire): boolean {
    return (
        a.outChipId === b.outChipId &&
        a.outSocket === b.outSocket &&
        a.inChipId === b.inChipId &&
        a.inSocket === b.inSocket
    );
}

/**
 * Formats a Wire as (outChip:outSocket -> inChip:inSocket).
 */
export function formatWire(wire: Wire): string {
    return `(${wire.outChipId}:${wire.outSocket} -> ${wire.inChipId}:${wire.inSocket})`;
}
