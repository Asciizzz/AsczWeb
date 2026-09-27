import type { VertexLayout, Submesh } from "./types.js";

/**
 * CPU geometry resource holding binary vertex data, index arrays, and vertex layouts.
 */
export class MeshCPU {
    layout: VertexLayout;
    submeshes: Submesh[];
    vertexBytes: ArrayBuffer;
    indexBytes?: Uint16Array | Uint32Array;

    constructor(
        layout: VertexLayout,
        submeshes: Submesh[],
        vertexBytes: ArrayBuffer,
        indexBytes?: Uint16Array | Uint32Array
    ) {
        if (!submeshes || submeshes.length === 0) {
            throw new Error("[MeshCPU] Mesh must contain at least 1 submesh.");
        }
        this.layout = layout;
        this.submeshes = submeshes;
        this.vertexBytes = vertexBytes;
        this.indexBytes = indexBytes;
    }
}

/**
 * Hardware-agnostic GPU geometry base class holding CPU mesh references and submesh descriptors.
 */
export class MeshGPU {
    cpu: MeshCPU;
    submeshes: Submesh[];

    constructor(cpu: MeshCPU, submeshes?: Submesh[]) {
        this.cpu = cpu;
        this.submeshes = submeshes ?? cpu.submeshes;
    }

    destroy(): void {
        // Base hook for hardware buffer disposal
    }
}
