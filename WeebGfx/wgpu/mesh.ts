import { Buffer } from "@asciiz/atoolkit/awgpu";
import { MeshGPU, type MeshCPU } from "../mesh.js";

/**
 * WebGPU implementation of MeshGPU storing GPU vertex and index buffers.
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
     * Returns underlying native GPUBuffer for vertex buffer.
     */
    get nativeVertexBuffer(): GPUBuffer {
        return this.vertexBuffer.native;
    }

    /**
     * Returns underlying native GPUBuffer for index buffer if present.
     */
    get nativeIndexBuffer(): GPUBuffer | undefined {
        return this.indexBuffer?.native;
    }

    /**
     * Allocates GPU vertex and index buffers from MeshCPU on GPUDevice.
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
