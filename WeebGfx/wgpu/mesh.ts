import { Buffer } from "@asciiz/atoolkit/awgpu";
import { MeshGPU, type MeshCPU } from "../mesh.js";

/**
 * WebGPU implementation of MeshGPU utilizing modern Buffer from @asciiz/atoolkit/awgpu.
 */
export class MeshWGPU extends MeshGPU {
    vertexBuffer: Buffer;
    indexBuffer?: Buffer;

    constructor(cpu: MeshCPU, vertexBuffer: Buffer, indexBuffer?: Buffer) {
        super(cpu, cpu.submeshes);
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;
    }

    /**
     * Compatibility alias returning the native GPUBuffer of the vertex buffer.
     */
    get gpuBuffer(): GPUBuffer {
        return this.vertexBuffer.native;
    }

    /**
     * Returns the underlying native GPUBuffer for the vertex buffer.
     */
    get nativeVertexBuffer(): GPUBuffer {
        return this.vertexBuffer.native;
    }

    /**
     * Returns the underlying native GPUBuffer for the index buffer if present.
     */
    get nativeIndexBuffer(): GPUBuffer | undefined {
        return this.indexBuffer?.native;
    }

    /**
     * Promotes a MeshCPU into a MeshWGPU on the provided GPUDevice.
     */
    static create(device: GPUDevice, cpu: MeshCPU): MeshWGPU {
        const vertexBuffer = Buffer.createVertex(device, cpu.vertexBytes, "MeshWGPU_VertexBuffer");
        const indexBuffer = cpu.indexBytes
            ? Buffer.createIndex(device, cpu.indexBytes, "MeshWGPU_IndexBuffer")
            : undefined;

        return new MeshWGPU(cpu, vertexBuffer, indexBuffer);
    }

    override destroy(): void {
        this.vertexBuffer.destroy();
        this.indexBuffer?.destroy();
    }
}
