import type { ShaderParams } from "./types.js";

/**
 * Hardware-agnostic base shader pipeline holding default material parameters and optional source code.
 */
export class ShaderGPU {
    defaultParams: ShaderParams;
    code?: string;
    order: number;

    constructor(defaultParams: ShaderParams = {}, code?: string, order: number = 0) {
        this.defaultParams = defaultParams;
        this.code = code;
        this.order = order;
    }

    destroy(): void {
        // Base hook for hardware pipeline disposal
    }
}
