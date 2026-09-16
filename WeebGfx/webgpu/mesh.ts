import { Buffer } from "../../Atoolkit/awgpu_old/buffer.js";
import { MeshGPU, type MeshCPU } from "../mesh.js";

/**
 * WebGPU implementation of MeshGPU utilizing Buffer.
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
     * Promotes a MeshCPU into a MeshWGPU on the provided GPUDevice.
     */
    static create(device: GPUDevice, cpu: MeshCPU): MeshWGPU {
        const vertexBuffer = Buffer.createVertex(device, cpu.vertexBytes);
        const indexBuffer = cpu.indexBytes
            ? Buffer.createIndex(device, cpu.indexBytes)
            : undefined;

        return new MeshWGPU(cpu, vertexBuffer, indexBuffer);
    }

    override destroy(): void {
        this.vertexBuffer.destroy();
        this.indexBuffer?.destroy();
    }
}
