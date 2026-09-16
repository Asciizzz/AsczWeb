import type { ShaderParams } from "./types.js";

/**
 * Base inheritable GPU shader pipeline resource.
 * Decoupled from any specific graphics API.
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
