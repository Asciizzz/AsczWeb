import { Texture, Sampler } from "@asciiz/atoolkit/awgpu";
import { TextureGPU, type TextureCPU } from "../texture.js";

/**
 * WebGPU implementation of TextureGPU holding GPUTexture, GPUTextureView, and GPUSampler handles.
 */
export class TextureWGPU extends TextureGPU {
    texture: GPUTexture;
    view: GPUTextureView;
    sampler: GPUSampler;

    // Awgpu handles for binding table cache
    awgpuTexture: Texture;
    awgpuSampler: Sampler;

    constructor(
        width: number,
        height: number,
        format: string,
        texture: GPUTexture,
        view: GPUTextureView,
        sampler: GPUSampler,
        cpu?: TextureCPU
    ) {
        super(width, height, format, cpu);
        this.texture = texture;
        this.view = view;
        this.sampler = sampler;
        this.awgpuTexture = Texture.fromNative(texture, view, "TextureWGPU_Texture");
        this.awgpuSampler = new Sampler(sampler, "TextureWGPU_Sampler");
    }

    /**
     * Uploads a TextureCPU to WebGPU hardware.
     */
    static create(
        device: GPUDevice,
        cpu: TextureCPU,
        samplerDescriptor?: GPUSamplerDescriptor
    ): TextureWGPU {
        const texture = device.createTexture({
            size: [cpu.width, cpu.height, 1],
            format: (cpu.format as GPUTextureFormat) || "rgba8unorm",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        const bytesPerPixel = cpu.format.includes("32") ? 16 : 4;
        const bytesPerRow = Math.ceil((cpu.width * bytesPerPixel) / 256) * 256;
        device.queue.writeTexture(
            { texture },
            cpu.pixels.buffer,
            {
                offset: cpu.pixels.byteOffset,
                bytesPerRow,
                rowsPerImage: cpu.height,
            },
            [cpu.width, cpu.height, 1]
        );

        const view = texture.createView();
        const sampler = device.createSampler(
            samplerDescriptor ?? {
                magFilter: "linear",
                minFilter: "linear",
            }
        );

        return new TextureWGPU(cpu.width, cpu.height, cpu.format, texture, view, sampler, cpu);
    }

    /**
     * Wraps an externally created GPUTexture.
     */
    static fromGPU(
        device: GPUDevice,
        texture: GPUTexture,
        samplerDescriptor?: GPUSamplerDescriptor
    ): TextureWGPU {
        const view = texture.createView();
        const sampler = device.createSampler(samplerDescriptor ?? {
            magFilter: "linear",
            minFilter: "linear",
        });

        return new TextureWGPU(
            texture.width,
            texture.height,
            texture.format,
            texture,
            view,
            sampler
        );
    }

    /**
     * Creates an offscreen render target texture.
     */
    static createRenderTarget(
        device: GPUDevice,
        width: number,
        height: number,
        format: GPUTextureFormat = "rgba8unorm",
        samplerDescriptor?: GPUSamplerDescriptor
    ): TextureWGPU {
        const texture = device.createTexture({
            size: [width, height, 1],
            format,
            usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_SRC,
        });
        return TextureWGPU.fromGPU(device, texture, samplerDescriptor);
    }

    /**
     * Creates a solid 1x1 RGBA8 texture for fallbacks and default shader parameters.
     */
    static create1x1(
        device: GPUDevice,
        r = 255,
        g = 255,
        b = 255,
        a = 255
    ): TextureWGPU {
        const texture = device.createTexture({
            size: [1, 1, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const data = new Uint8Array([r, g, b, a]);
        device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: 256, rowsPerImage: 1 },
            [1, 1, 1]
        );
        return TextureWGPU.fromGPU(device, texture);
    }

    override destroy(): void {
        this.texture.destroy();
    }
}
