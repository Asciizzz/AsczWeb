// ================================================================
//  Awgpu - Level 2: Render Destination Coordinator (Target)
// ================================================================

import { type Device } from "./device.js";
import { Texture, resolveTextureView } from "./memory.js";

export interface ColorTargetDesc {
    target: GPUTextureView | Texture | null; // null indicates swapchain canvas backbuffer
    clearColor?: GPUColor;
    loadOp?: GPULoadOp;
    storeOp?: GPUStoreOp;
    resolveTarget?: GPUTextureView | Texture | null;
}

export interface DepthTargetDesc {
    target: GPUTextureView | Texture;
    depthClearValue?: number;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
    stencilClearValue?: number;
    stencilLoadOp?: GPULoadOp;
    stencilStoreOp?: GPUStoreOp;
}

/**
 * Coordinates render destination attachments (swapchain, offscreen MRT, depth-only).
 * Automatically synchronizes canvas swapchain resizing and caches GPURenderPassDescriptor.
 * Supports MSAA color resolve directly to canvas swapchain backbuffers.
 */
export class Target {
    readonly label: string;
    readonly isScreen: boolean;
    readonly sampleCount: number;
    device?: Device;
    width: number;
    height: number;

    // Color and depth attachment descriptors. Mutate via setColorTarget / setDepthTarget
    // to guarantee cache invalidation; or call invalidateCache() after direct mutation.
    colorTargets: ColorTargetDesc[] = [];
    depthTarget?: DepthTargetDesc;

    colorFormat?: GPUTextureFormat;
    depthFormat?: GPUTextureFormat;

    // Managed textures created by createOffscreen. Exposed for downstream sampling.
    readonly colorTextures: Texture[] = [];

    private _cachedDescriptor?: GPURenderPassDescriptor;
    private _cachedColorAttachments: GPURenderPassColorAttachment[] = [];
    private _cachedDepthStencilAttachment?: GPURenderPassDepthStencilAttachment;
    private _depthTexture?: Texture;
    private _msaaColorTexture?: Texture;
    private _colorFormats: GPUTextureFormat[] = [];

    constructor(
        label: string,
        width: number,
        height: number,
        options: {
            isScreen?: boolean;
            device?: Device;
            colorTargets?: ColorTargetDesc[];
            depthTarget?: DepthTargetDesc;
            colorFormat?: GPUTextureFormat;
            depthFormat?: GPUTextureFormat;
            sampleCount?: number;
        } = {}
    ) {
        this.label = label;
        this.width = width;
        this.height = height;
        this.isScreen = options.isScreen ?? false;
        this.sampleCount = options.sampleCount ?? 1;
        this.device = options.device;
        this.colorTargets = options.colorTargets ?? [];
        this.depthTarget = options.depthTarget;
        this.colorFormat = options.colorFormat;
        this.depthFormat = options.depthFormat;
    }

    /**
     * Invalidates the cached GPURenderPassDescriptor and internal attachment caches.
     * Call after directly mutating colorTargets or depthTarget to force descriptor rebuild.
     */
    invalidateCache(): void {
        this._cachedDescriptor = undefined;
        this._cachedColorAttachments.length = 0;
        this._cachedDepthStencilAttachment = undefined;
    }

    /**
     * Updates color attachment at index and invalidates descriptor cache.
     */
    setColorTarget(index: number, desc: ColorTargetDesc): void {
        this.colorTargets[index] = desc;
        this.invalidateCache();
    }

    /**
     * Updates depth attachment and invalidates descriptor cache.
     */
    setDepthTarget(desc: DepthTargetDesc | undefined): void {
        this.depthTarget = desc;
        this.invalidateCache();
    }

    /**
     * Factory: Creates render target bound to canvas presentation swapchain.
     * Supports multisample anti-aliasing (MSAA) with automatic swapchain resolve target.
     * Pass depthFormat: null to create pure color pass omitting depth buffers.
     */
    static createScreen(
        device: Device,
        options: {
            depthFormat?: GPUTextureFormat | null;
            clearColor?: GPUColor;
            sampleCount?: number;
            label?: string;
        } = {}
    ): Target {
        const canvas = device.canvas;
        const w = Math.max(1, canvas ? canvas.width : 1);
        const h = Math.max(1, canvas ? canvas.height : 1);
        const hasDepth = options.depthFormat !== null;
        const depthFormat = hasDepth ? (options.depthFormat ?? "depth24plus") : undefined;
        const clearColor = options.clearColor ?? { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
        const label = options.label ?? "ScreenTarget";
        const sampleCount = options.sampleCount ?? 1;

        let msaaColorTex: Texture | undefined;
        let colorDesc: ColorTargetDesc;

        if (sampleCount > 1) {
            msaaColorTex = Texture.create2D(device, {
                width: w,
                height: h,
                format: device.format,
                sampleCount,
                label: `${label}_MSAAColor`,
            });
            colorDesc = {
                target: msaaColorTex,
                resolveTarget: null,
                clearColor,
                loadOp: "clear",
                storeOp: "discard",
            };
        } else {
            colorDesc = {
                target: null,
                clearColor,
                loadOp: "clear",
                storeOp: "store",
            };
        }

        let depthTarget: DepthTargetDesc | undefined;
        let depthTex: Texture | undefined;

        if (depthFormat) {
            depthTex = Texture.createDepth(device, {
                width: w,
                height: h,
                format: depthFormat,
                sampleCount,
                label: `${label}_Depth`,
            });
            depthTarget = {
                target: depthTex,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            };
        }

        const target = new Target(label, w, h, {
            isScreen: true,
            device,
            colorTargets: [colorDesc],
            depthTarget,
            colorFormat: device.format,
            depthFormat,
            sampleCount,
        });

        target._depthTexture = depthTex;
        target._msaaColorTexture = msaaColorTex;
        return target;
    }

    /**
     * Factory: Creates offscreen color and optional depth render target (RTT).
     * Managed color textures are accessible via colorTextures[] for downstream binding
     * as sampled inputs in subsequent passes.
     */
    static createOffscreen(
        device: Device | GPUDevice,
        desc: {
            width: number;
            height: number;
            colorFormats?: GPUTextureFormat[];
            depthFormat?: GPUTextureFormat;
            label?: string;
        }
    ): Target {
        const w = Math.max(1, desc.width);
        const h = Math.max(1, desc.height);
        const label = desc.label ?? "OffscreenTarget";
        const formats = desc.colorFormats ?? ["rgba8unorm"];

        const textures: Texture[] = [];
        const colorTargets: ColorTargetDesc[] = new Array(formats.length);
        for (let i = 0; i < formats.length; i++) {
            const tex = Texture.create2D(device, {
                width: w,
                height: h,
                format: formats[i],
                label: `${label}_Color${i}`,
            });
            textures.push(tex);
            colorTargets[i] = {
                target: tex,
                clearColor: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
            };
        }

        let depthTarget: DepthTargetDesc | undefined;
        let depthTex: Texture | undefined;
        if (desc.depthFormat) {
            depthTex = Texture.createDepth(device, {
                width: w,
                height: h,
                format: desc.depthFormat,
                label: `${label}_Depth`,
            });
            depthTarget = {
                target: depthTex,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            };
        }

        const target = new Target(label, w, h, {
            isScreen: false,
            colorTargets,
            depthTarget,
            colorFormat: formats[0],
            depthFormat: desc.depthFormat,
        });

        target._depthTexture = depthTex;

        // Populate managed texture list and format record for resize support.
        for (const tex of textures) {
            target.colorTextures.push(tex);
        }
        target._colorFormats = formats.slice();

        return target;
    }

    /**
     * Synchronizes attachments and returns cached GPURenderPassDescriptor.
     * Mutates pre-allocated attachment objects in-place to ensure zero heap allocations in hot paths.
     */
    getDescriptor(): GPURenderPassDescriptor {
        if (this.isScreen && this.device && this.device.canvas) {
            const cw = this.device.canvas.width;
            const ch = this.device.canvas.height;
            if (this.width !== cw || this.height !== ch) {
                this.resize(this.device, cw, ch);
            }
        }

        const colorCount = this.colorTargets.length;
        if (!this._cachedDescriptor || this._cachedColorAttachments.length !== colorCount) {
            this._cachedColorAttachments = new Array(colorCount);
            for (let i = 0; i < colorCount; i++) {
                this._cachedColorAttachments[i] = {
                    view: null as unknown as GPUTextureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                };
            }
            if (this.depthTarget) {
                this._cachedDepthStencilAttachment = {
                    view: null as unknown as GPUTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                };
            } else {
                this._cachedDepthStencilAttachment = undefined;
            }
            this._cachedDescriptor = {
                label: `${this.label}_PassDescriptor`,
                colorAttachments: this._cachedColorAttachments,
                depthStencilAttachment: this._cachedDepthStencilAttachment,
            };
        }

        for (let i = 0; i < colorCount; i++) {
            const cfg = this.colorTargets[i];
            const att = this._cachedColorAttachments[i];

            if (cfg.target === null) {
                if (!this.device || !this.device.context) {
                    throw new Error("Cannot render to swapchain: Device canvas context is unconfigured.");
                }
                att.view = this.device.context.getCurrentTexture().createView();
            } else {
                att.view = resolveTextureView(cfg.target);
            }

            att.clearValue = cfg.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
            att.loadOp = cfg.loadOp ?? "clear";
            att.storeOp = cfg.storeOp ?? "store";

            if (cfg.resolveTarget === null) {
                if (!this.device || !this.device.context) {
                    throw new Error("Cannot resolve to swapchain: Device canvas context is unconfigured.");
                }
                att.resolveTarget = this.device.context.getCurrentTexture().createView();
            } else if (cfg.resolveTarget !== undefined) {
                att.resolveTarget = resolveTextureView(cfg.resolveTarget);
            } else {
                att.resolveTarget = undefined;
            }
        }

        if (this.depthTarget) {
            if (!this._cachedDepthStencilAttachment) {
                this._cachedDepthStencilAttachment = {
                    view: null as unknown as GPUTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                };
                this._cachedDescriptor.depthStencilAttachment = this._cachedDepthStencilAttachment;
            }
            const ds = this._cachedDepthStencilAttachment;
            ds.view = resolveTextureView(this.depthTarget.target);
            ds.depthClearValue = this.depthTarget.depthClearValue ?? 1.0;
            ds.depthLoadOp = this.depthTarget.depthLoadOp ?? "clear";
            ds.depthStoreOp = this.depthTarget.depthStoreOp ?? "store";
            ds.stencilClearValue = this.depthTarget.stencilClearValue;
            ds.stencilLoadOp = this.depthTarget.stencilLoadOp;
            ds.stencilStoreOp = this.depthTarget.stencilStoreOp;
        } else if (this._cachedDescriptor.depthStencilAttachment) {
            this._cachedDescriptor.depthStencilAttachment = undefined;
            this._cachedDepthStencilAttachment = undefined;
        }

        return this._cachedDescriptor;
    }

    /**
     * Resizes internal attachment textures when dimensions change.
     * Handles both screen depth/MSAA buffers and offscreen color + depth textures.
     */
    resize(device: Device | GPUDevice, width: number, height: number): void {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);

        if (this.isScreen) {
            if (this.sampleCount > 1) {
                if (this._msaaColorTexture) {
                    this._msaaColorTexture.destroy();
                }
                this._msaaColorTexture = Texture.create2D(device, {
                    width: this.width,
                    height: this.height,
                    format: this.colorFormat ?? "rgba8unorm",
                    sampleCount: this.sampleCount,
                    label: `${this.label}_MSAAColor`,
                });
                this.colorTargets[0] = { ...this.colorTargets[0], target: this._msaaColorTexture };
            }

            if (this.depthFormat) {
                if (this._depthTexture) {
                    this._depthTexture.destroy();
                }
                this._depthTexture = Texture.createDepth(device, {
                    width: this.width,
                    height: this.height,
                    format: this.depthFormat,
                    sampleCount: this.sampleCount,
                    label: `${this.label}_Depth`,
                });
                if (this.depthTarget) {
                    this.depthTarget.target = this._depthTexture;
                }
            }
        } else if (!this.isScreen) {
            // Offscreen target: reallocate all managed color textures.
            for (let i = 0; i < this.colorTextures.length; i++) {
                this.colorTextures[i].destroy();
                const tex = Texture.create2D(device, {
                    width: this.width,
                    height: this.height,
                    format: this._colorFormats[i] ?? "rgba8unorm",
                    label: `${this.label}_Color${i}`,
                });
                this.colorTextures[i] = tex;
                this.colorTargets[i] = { ...this.colorTargets[i], target: tex };
            }
            // Reallocate depth texture for offscreen targets.
            if (this.depthFormat && this.depthTarget) {
                if (this._depthTexture) {
                    this._depthTexture.destroy();
                } else if (this.depthTarget.target instanceof Texture) {
                    this.depthTarget.target.destroy();
                }
                this._depthTexture = Texture.createDepth(device, {
                    width: this.width,
                    height: this.height,
                    format: this.depthFormat,
                    label: `${this.label}_Depth`,
                });
                this.depthTarget.target = this._depthTexture;
            }
        }

        this.invalidateCache();
    }
}
