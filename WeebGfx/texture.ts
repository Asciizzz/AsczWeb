/**
 * CPU texture resource holding pixel data and dimensions.
 */
export class TextureCPU {
    width: number;
    height: number;
    format: string;
    pixels: ArrayBufferView;
    sampler?: GPUSamplerDescriptor;

    constructor(
        width: number,
        height: number,
        format: string,
        pixels: ArrayBufferView,
        sampler?: GPUSamplerDescriptor
    ) {
        this.width = width;
        this.height = height;
        this.format = format;
        this.pixels = pixels;
        this.sampler = sampler;
    }
}

/**
 * Hardware-agnostic base texture resource defining dimensions and format.
 */
export class TextureGPU {
    width: number;
    height: number;
    format: string;
    cpu?: TextureCPU;

    constructor(
        width: number,
        height: number,
        format: string,
        cpu?: TextureCPU
    ) {
        this.width = width;
        this.height = height;
        this.format = format;
        this.cpu = cpu;
    }

    destroy(): void {
        // Base hook for hardware resource release
    }
}
