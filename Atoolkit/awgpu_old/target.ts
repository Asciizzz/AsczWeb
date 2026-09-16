import type { Device } from "./device.js";

/**
 * GPU texture wrapper containing hardware texture, view, and metadata.
 */
export class Texture {
    readonly gpuTexture: GPUTexture;
    readonly gpuView: GPUTextureView;
    width: number;
    height: number;
    depthOrArrayLayers: number;
    readonly format: GPUTextureFormat;
    readonly sampleCount: number;
    readonly usage: GPUTextureUsageFlags;
    readonly gpuOwned: boolean;
    readonly label: string;

    constructor(
        gpuTexture: GPUTexture,
        gpuView: GPUTextureView,
        width: number,
        height: number,
        format: GPUTextureFormat,
        usage: GPUTextureUsageFlags,
        options: {
            depthOrArrayLayers?: number;
            sampleCount?: number;
            gpuOwned?: boolean;
            label?: string;
        } = {}
    ) {
        this.gpuTexture = gpuTexture;
        this.gpuView = gpuView;
        this.width = width;
        this.height = height;
        this.depthOrArrayLayers = options.depthOrArrayLayers ?? 1;
        this.format = format;
        this.sampleCount = options.sampleCount ?? 1;
        this.usage = usage;
        this.gpuOwned = options.gpuOwned ?? true;
        this.label = options.label ?? gpuTexture.label ?? "Texture";
    }

    destroy(): void {
        if (this.gpuOwned) {
            this.gpuTexture.destroy();
        }
    }

    /**
     * Creates 2D color or data texture.
     */
    static create2D(
        device: GPUDevice,
        options: {
            width: number;
            height: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            sampleCount?: number;
            label?: string;
        }
    ): Texture {
        const w = Math.max(1, options.width);
        const h = Math.max(1, options.height);
        const format = options.format ?? "rgba8unorm";
        const usage = options.usage ?? (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST);
        const label = options.label ?? "Texture2D";

        const gpuTexture = device.createTexture({
            label,
            size: [w, h, 1],
            format,
            usage,
            sampleCount: options.sampleCount ?? 1,
        });
        const gpuView = gpuTexture.createView({ label: `${label}_View` });
        return new Texture(gpuTexture, gpuView, w, h, format, usage, { label, sampleCount: options.sampleCount });
    }

    /**
     * Creates 2D depth or depth-stencil texture.
     */
    static createDepth(
        device: GPUDevice,
        options: {
            width: number;
            height: number;
            format?: GPUTextureFormat;
            usage?: GPUTextureUsageFlags;
            label?: string;
        }
    ): Texture {
        const w = Math.max(1, options.width);
        const h = Math.max(1, options.height);
        const format = options.format ?? "depth24plus";
        const usage = options.usage ?? (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
        const label = options.label ?? "DepthTexture";

        const gpuTexture = device.createTexture({
            label,
            size: [w, h, 1],
            format,
            usage,
        });
        const gpuView = gpuTexture.createView({ label: `${label}_View` });
        return new Texture(gpuTexture, gpuView, w, h, format, usage, { label });
    }

    /**
     * Wraps existing GPUTexture and GPUTextureView.
     */
    static fromTexture(
        gpuTexture: GPUTexture,
        options: {
            view?: GPUTextureView;
            label?: string;
            gpuOwned?: boolean;
        } = {}
    ): Texture {
        const view = options.view ?? gpuTexture.createView();
        return new Texture(
            gpuTexture,
            view,
            gpuTexture.width,
            gpuTexture.height,
            gpuTexture.format,
            gpuTexture.usage,
            {
                depthOrArrayLayers: gpuTexture.depthOrArrayLayers,
                sampleCount: gpuTexture.sampleCount,
                gpuOwned: options.gpuOwned ?? false,
                label: options.label ?? gpuTexture.label,
            }
        );
    }
}

/**
 * GPU sampler wrapper supporting filtering and depth comparison.
 */
export class Sampler {
    readonly gpuSampler: GPUSampler;
    readonly label: string;

    constructor(gpuSampler: GPUSampler, label = "Sampler") {
        this.gpuSampler = gpuSampler;
        this.label = label;
    }

    /**
     * Creates standard trilinear or bilinear filtering sampler.
     */
    static createLinear(device: GPUDevice, label = "SamplerLinear"): Sampler {
        const gpuSampler = device.createSampler({
            label,
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
        });
        return new Sampler(gpuSampler, label);
    }

    /**
     * Creates point / nearest-neighbor sampler.
     */
    static createNearest(device: GPUDevice, label = "SamplerNearest"): Sampler {
        const gpuSampler = device.createSampler({
            label,
            magFilter: "nearest",
            minFilter: "nearest",
            mipmapFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });
        return new Sampler(gpuSampler, label);
    }

    /**
     * Creates hardware depth comparison sampler (e.g. for depth tests, shadow mapping, or depth peeling).
     */
    static createComparison(
        device: GPUDevice,
        options: {
            compare?: GPUCompareFunction;
            label?: string;
        } = {}
    ): Sampler {
        const label = options.label ?? "ComparisonSampler";
        const gpuSampler = device.createSampler({
            label,
            compare: options.compare ?? "less",
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });
        return new Sampler(gpuSampler, label);
    }
}

export interface ColorAttachmentConfig {
    texture: Texture | null; // null indicates swapchain canvas texture view
    clearColor?: { r: number; g: number; b: number; a: number };
    loadOp?: GPULoadOp;
    storeOp?: GPUStoreOp;
    resolveTarget?: Texture | null;
}

export interface DepthAttachmentConfig {
    texture: Texture;
    depthClearValue?: number;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
    stencilClearValue?: number;
    stencilLoadOp?: GPULoadOp;
    stencilStoreOp?: GPUStoreOp;
}

/**
 * Render destination descriptor supporting screen canvas, offscreen color buffers, MRT, and depth-only targets.
 */
export class RenderTarget {
    readonly label: string;
    readonly isScreen: boolean;
    gfx?: Device;
    width: number;
    height: number;
    colorAttachments: ColorAttachmentConfig[] = [];
    depthAttachment?: DepthAttachmentConfig;

    private depthFormat?: GPUTextureFormat;
    private colorFormat?: GPUTextureFormat;
    private _cachedDescriptor?: GPURenderPassDescriptor;
    private _dirtyDescriptor = true;

    constructor(
        label: string,
        width: number,
        height: number,
        options: {
            isScreen?: boolean;
            gfx?: Device;
            colorAttachments?: ColorAttachmentConfig[];
            depthAttachment?: DepthAttachmentConfig;
            depthFormat?: GPUTextureFormat;
            colorFormat?: GPUTextureFormat;
        } = {}
    ) {
        this.label = label;
        this.width = width;
        this.height = height;
        this.isScreen = options.isScreen ?? false;
        this.gfx = options.gfx;
        this.colorAttachments = options.colorAttachments ?? [];
        this.depthAttachment = options.depthAttachment;
        this.depthFormat = options.depthFormat;
        this.colorFormat = options.colorFormat;
    }

    /**
     * Factory: Creates render target bound to canvas swapchain backbuffer.
     * Set depthFormat: null to create a pure color screen target (e.g. for 2D/post-processing).
     */
    /**
     * Factory: Creates render target bound to canvas swapchain backbuffer.
     * Set depthFormat: null to create a pure color screen target (e.g. for 2D/post-processing).
     */
    static createScreen(
        gfx: Device,
        options: {
            depthFormat?: GPUTextureFormat | null;
            clearColor?: { r: number; g: number; b: number; a: number };
            label?: string;
        } = {}
    ): RenderTarget {
        const device = gfx.device;
        const canvas = gfx.canvas!;
        const w = Math.max(1, canvas.width);
        const h = Math.max(1, canvas.height);
        const hasDepth = options.depthFormat !== null;
        const depthFormat = hasDepth ? (options.depthFormat ?? "depth24plus") : undefined;
        const clearColor = options.clearColor ?? { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
        const label = options.label ?? "ScreenTarget";

        let depthAttachment: DepthAttachmentConfig | undefined;
        if (depthFormat) {
            const depthTex = Texture.createDepth(device, {
                width: w,
                height: h,
                format: depthFormat,
                label: `${label}_Depth`,
            });
            depthAttachment = {
                texture: depthTex,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            };
        }

        return new RenderTarget(label, w, h, {
            isScreen: true,
            gfx,
            colorAttachments: [
                {
                    texture: null,
                    clearColor,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthAttachment,
            depthFormat,
            colorFormat: gfx.format ?? "bgra8unorm",
        });
    }

    /**
     * Factory: Creates offscreen color and depth render target (e.g. for HDR, G-buffer, or RTT).
     * Set depthFormat: null to create a pure color offscreen target.
     */
    static createOffscreen(
        device: GPUDevice,
        width: number,
        height: number,
        options: {
            colorFormat?: GPUTextureFormat;
            depthFormat?: GPUTextureFormat | null;
            clearColor?: { r: number; g: number; b: number; a: number };
            label?: string;
        } = {}
    ): RenderTarget {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        const colorFormat = options.colorFormat ?? "rgba8unorm";
        const hasDepth = options.depthFormat !== null;
        const depthFormat = hasDepth ? (options.depthFormat ?? "depth24plus") : undefined;
        const clearColor = options.clearColor ?? { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
        const label = options.label ?? "OffscreenTarget";

        const colorTex = Texture.create2D(device, {
            width: w,
            height: h,
            format: colorFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            label: `${label}_Color0`,
        });

        let depthAttachment: DepthAttachmentConfig | undefined;
        if (depthFormat) {
            const depthTex = Texture.createDepth(device, {
                width: w,
                height: h,
                format: depthFormat,
                label: `${label}_Depth`,
            });
            depthAttachment = {
                texture: depthTex,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            };
        }

        return new RenderTarget(label, w, h, {
            isScreen: false,
            colorAttachments: [
                {
                    texture: colorTex,
                    clearColor,
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthAttachment,
            depthFormat,
            colorFormat,
        });
    }

    /**
     * Factory: Creates depth-only render target (e.g. for shadow maps or depth prepasses).
     */
    static createDepthOnly(
        device: GPUDevice,
        width: number,
        height: number,
        options: {
            depthFormat?: GPUTextureFormat;
            label?: string;
        } = {}
    ): RenderTarget {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        const depthFormat = options.depthFormat ?? "depth32float";
        const label = options.label ?? "DepthOnlyTarget";

        const depthTex = Texture.createDepth(device, {
            width: w,
            height: h,
            format: depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            label: `${label}_Depth`,
        });

        return new RenderTarget(label, w, h, {
            isScreen: false,
            colorAttachments: [], // No color attachments in depth-only mode
            depthAttachment: {
                texture: depthTex,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
            depthFormat,
        });
    }

    /**
     * Resizes internal textures when target dimensions change.
     */
    resize(device: GPUDevice, width: number, height: number): void {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        if (this.width === w && this.height === h) return;

        this.width = w;
        this.height = h;

        // Reallocate depth texture
        if (this.depthAttachment && this.depthFormat) {
            this.depthAttachment.texture.destroy();
            this.depthAttachment.texture = Texture.createDepth(device, {
                width: w,
                height: h,
                format: this.depthFormat,
                label: `${this.label}_Depth`,
            });
        }

        // Reallocate offscreen color textures
        if (!this.isScreen && this.colorFormat) {
            for (let i = 0; i < this.colorAttachments.length; i++) {
                const ca = this.colorAttachments[i];
                if (ca.texture) {
                    ca.texture.destroy();
                    ca.texture = Texture.create2D(device, {
                        width: w,
                        height: h,
                        format: this.colorFormat,
                        label: `${this.label}_Color${i}`,
                    });
                }
            }
        }
        this._dirtyDescriptor = true;
    }


    /**
     * Marks cached GPURenderPassDescriptor dirty, forcing rebuild on next pass.
     */
    invalidateDescriptor(): void {
        this._dirtyDescriptor = true;
    }

    /**
     * Builds GPURenderPassDescriptor for command recording in active frame.
     * Caches descriptor structure to eliminate per-frame object allocation.
     * Supports optional per-pass loadOp and clear overrides for RTT chaining.
     */
    buildPassDescriptor(options?: {
        loadOp?: GPULoadOp;
        depthLoadOp?: GPULoadOp;
        clearColor?: { r: number; g: number; b: number; a: number };
        depthClearValue?: number;
    }): GPURenderPassDescriptor {
        // Automatically synchronize screen target dimensions when canvas resizes
        if (this.isScreen && this.gfx?.canvas) {
            const cw = Math.max(1, this.gfx.canvas.width);
            const ch = Math.max(1, this.gfx.canvas.height);
            if (cw !== this.width || ch !== this.height) {
                this.resize(this.gfx.device, cw, ch);
            }
        }

        if (this._dirtyDescriptor || !this._cachedDescriptor) {
            const colorAttachments: GPURenderPassColorAttachment[] = [];

            if (this.isScreen) {
                const ca = this.colorAttachments[0];
                colorAttachments.push({
                    view: null as any,
                    clearValue: ca?.clearColor ?? { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: ca?.loadOp ?? "clear",
                    storeOp: ca?.storeOp ?? "store",
                });
            } else {
                for (const ca of this.colorAttachments) {
                    if (ca.texture) {
                        const entry: GPURenderPassColorAttachment = {
                            view: ca.texture.gpuView,
                            clearValue: ca.clearColor ?? { r: 0, g: 0, b: 0, a: 1 },
                            loadOp: ca.loadOp ?? "clear",
                            storeOp: ca.storeOp ?? "store",
                        };
                        if (ca.resolveTarget) {
                            entry.resolveTarget = ca.resolveTarget.gpuView;
                        }
                        colorAttachments.push(entry);
                    }
                }
            }

            let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
            if (this.depthAttachment) {
                depthStencilAttachment = {
                    view: this.depthAttachment.texture.gpuView,
                    depthClearValue: this.depthAttachment.depthClearValue ?? 1.0,
                    depthLoadOp: this.depthAttachment.depthLoadOp ?? "clear",
                    depthStoreOp: this.depthAttachment.depthStoreOp ?? "store",
                };
            }

            this._cachedDescriptor = {
                label: `${this.label}_PassDescriptor`,
                colorAttachments,
                depthStencilAttachment,
            };
            this._dirtyDescriptor = false;
        }

        const desc = this._cachedDescriptor;
        const overrideLoadOp = options?.loadOp;
        const overrideClearColor = options?.clearColor;

        const cas = desc.colorAttachments as GPURenderPassColorAttachment[];
        if (this.isScreen) {
            const canvasView = this.gfx!.canvasContext!.getCurrentTexture().createView();
            const ca = cas[0];
            const def = this.colorAttachments[0];
            ca.view = canvasView;
            ca.clearValue = overrideClearColor ?? def?.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
            ca.loadOp = overrideLoadOp ?? def?.loadOp ?? "clear";
        } else {

            for (let i = 0; i < cas.length; i++) {
                const def = this.colorAttachments[i];
                if (overrideClearColor) cas[i].clearValue = overrideClearColor;
                else if (def?.clearColor) cas[i].clearValue = def.clearColor;
                if (overrideLoadOp) cas[i].loadOp = overrideLoadOp;
                else if (def?.loadOp) cas[i].loadOp = def.loadOp;
            }
        }

        if (desc.depthStencilAttachment && this.depthAttachment) {
            desc.depthStencilAttachment.depthLoadOp = options?.depthLoadOp ?? this.depthAttachment.depthLoadOp ?? "clear";
            desc.depthStencilAttachment.depthClearValue = options?.depthClearValue ?? this.depthAttachment.depthClearValue ?? 1.0;
        }

        return desc;
    }


    destroy(): void {
        if (this.depthAttachment) {
            this.depthAttachment.texture.destroy();
        }
        for (const ca of this.colorAttachments) {
            if (ca.texture) {
                ca.texture.destroy();
            }
        }
    }
}


