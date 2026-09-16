import type { Pass, ComputePass } from "./pass.js";
import type { Device } from "./device.js";

/**
 * Top-level multi-pass frame orchestrator.
 * Sequences render and compute passes and submits recorded GPU commands to hardware queue.
 */
export class Frame {
    readonly passes: (Pass | ComputePass)[] = [];

    addPass(pass: Pass | ComputePass): this {
        this.passes.push(pass);
        return this;
    }

    clear(): void {
        this.passes.length = 0;
    }

    /**
     * Executes recorded passes in order and submits command buffer to device queue.
     * Accepts either raw GPUDevice or Device instance.
     */
    execute(deviceOrGfx: GPUDevice | Device, label = "Frame"): void {
        const device = "device" in deviceOrGfx ? deviceOrGfx.device : deviceOrGfx;
        const queue = "queue" in deviceOrGfx ? deviceOrGfx.queue : device.queue;

        const encoder = device.createCommandEncoder({ label: `${label}_CommandEncoder` });

        for (let i = 0; i < this.passes.length; i++) {
            this.passes[i].execute(encoder);
        }

        const commandBuffer = encoder.finish({ label: `${label}_CommandBuffer` });
        queue.submit([commandBuffer]);
    }
}
