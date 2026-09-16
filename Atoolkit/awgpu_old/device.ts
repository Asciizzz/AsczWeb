import { RenderTarget } from "./target.js";

export interface DeviceOptions {
    /** Target canvas element or selector string. If omitted, device initializes in headless mode. */
    canvas?: string | HTMLCanvasElement | null;
    /** Preferred texture format for canvas presentation; defaults to navigator.gpu.getPreferredCanvasFormat() */
    format?: GPUTextureFormat;
    /** Power preference for adapter selection; defaults to "high-performance" */
    powerPreference?: GPUPowerPreference;
    /** Optional required WebGPU features */
    requiredFeatures?: GPUFeatureName[];
    /** Optional required WebGPU limits */
    requiredLimits?: Record<string, GPUSize64>;
    /** Canvas presentation alpha mode; defaults to "premultiplied" */
    alphaMode?: GPUCanvasAlphaMode;
    /** Label for diagnostic and debugging identification */
    label?: string;
}

function resolveCanvas(canvasRef: string | HTMLCanvasElement | null | undefined): HTMLCanvasElement | null {
    if (!canvasRef) return null;
    if (typeof HTMLCanvasElement !== "undefined" && canvasRef instanceof HTMLCanvasElement) return canvasRef;
    if (typeof canvasRef === "string" && typeof document !== "undefined") {
        const found = document.querySelector(canvasRef);
        if (typeof HTMLCanvasElement !== "undefined" && found instanceof HTMLCanvasElement) return found;
    }
    return null;
}

/**
 * Hardware WebGPU device wrapper managing adapter negotiation, device lifetime,
 * command submission queue, and canvas presentation context.
 */
export class Device {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
    readonly queue: GPUQueue;
    readonly canvas: HTMLCanvasElement | null;
    readonly canvasContext: GPUCanvasContext | null;
    readonly format: GPUTextureFormat;
    readonly label: string;

    constructor(
        adapter: GPUAdapter,
        device: GPUDevice,
        format: GPUTextureFormat,
        options: {
            canvas?: HTMLCanvasElement | null;
            canvasContext?: GPUCanvasContext | null;
            label?: string;
        } = {}
    ) {
        this.adapter = adapter;
        this.device = device;
        this.queue = device.queue;
        this.format = format;
        this.canvas = options.canvas ?? null;
        this.canvasContext = options.canvasContext ?? null;
        this.label = options.label ?? "Device";
    }

    /**
     * Initializes WebGPU device connected to HTML canvas for graphics rendering.
     */
    static async create(options: DeviceOptions = {}): Promise<Device> {
        if (typeof navigator === "undefined" || !navigator.gpu) {
            throw new Error("[Device] WebGPU is not supported or not available in this environment.");
        }

        const canvas = resolveCanvas(options.canvas);
        const powerPreference = options.powerPreference ?? "high-performance";

        const adapter = await navigator.gpu.requestAdapter({ powerPreference });
        if (!adapter) {
            throw new Error("[Device] Failed to acquire WebGPU GPUAdapter.");
        }

        const device = await adapter.requestDevice({
            label: options.label ?? "Device_GPUDevice",
            requiredFeatures: options.requiredFeatures,
            requiredLimits: options.requiredLimits,
        });

        const format = options.format ?? (canvas ? navigator.gpu.getPreferredCanvasFormat() : "rgba8unorm");

        let canvasContext: GPUCanvasContext | null = null;
        if (canvas) {
            canvasContext = canvas.getContext("webgpu") as GPUCanvasContext | null;
            if (!canvasContext) {
                throw new Error("[Device] Failed to get WebGPU context from canvas element.");
            }
            canvasContext.configure({
                device,
                format,
                alphaMode: options.alphaMode ?? "premultiplied",
            });
        }

        return new Device(adapter, device, format, {
            canvas,
            canvasContext,
            label: options.label ?? "Device",
        });
    }

    /**
     * Initializes headless WebGPU device without canvas (for compute passes, tests, or offscreen workers).
     */
    static async createHeadless(options: Omit<DeviceOptions, "canvas"> = {}): Promise<Device> {
        return Device.create({ ...options, canvas: null });
    }

    /**
     * Creates screen render target bound to device canvas swapchain.
     */
    createScreenTarget(
        options: {
            depthFormat?: GPUTextureFormat;
            clearColor?: { r: number; g: number; b: number; a: number };
            label?: string;
        } = {}
    ): RenderTarget {
        if (!this.canvas || !this.canvasContext) {
            throw new Error("[Device.createScreenTarget] Cannot create screen target on headless device.");
        }
        return RenderTarget.createScreen(this as any, options);
    }

    /**
     * Creates fresh GPUCommandEncoder on device.
     */
    createCommandEncoder(label = "CommandEncoder"): GPUCommandEncoder {
        return this.device.createCommandEncoder({ label });
    }

    /**
     * Submits command buffers or command encoders to device queue.
     */
    submit(commands: (GPUCommandBuffer | GPUCommandEncoder)[] | GPUCommandBuffer | GPUCommandEncoder): void {
        const list = Array.isArray(commands) ? commands : [commands];
        const buffers: GPUCommandBuffer[] = list.map((c) => {
            if ("finish" in c && typeof c.finish === "function") {
                return (c as GPUCommandEncoder).finish();
            }
            return c as GPUCommandBuffer;
        });
        this.queue.submit(buffers);
    }

    /**
     * Destroys device resources and unconfigures canvas context.
     */
    destroy(): void {
        if (this.canvasContext) {
            try {
                (this.canvasContext as GPUCanvasContext & { unconfigure?(): void }).unconfigure?.();
            } catch {
                // Ignore if unconfigure is unsupported in current browser
            }
        }
        this.device.destroy();
    }
}
