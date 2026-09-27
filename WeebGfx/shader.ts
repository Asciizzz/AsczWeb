import type { ShaderParams } from "./types.js";

/**
 * Hardware-agnostic base shader pipeline holding default material parameters and optional source code.
 */
export class ShaderGPU {
    defaultParams: ShaderParams;
    code?: string;

    constructor(defaultParams: ShaderParams = {}, code?: string) {
        this.defaultParams = defaultParams;
        this.code = code;
    }

    destroy(): void {
        // Base hook for hardware pipeline disposal
    }
}
