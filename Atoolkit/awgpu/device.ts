// ================================================================
//  Awgpu - Level 0: Hardware Foundation
// ================================================================

export interface DeviceConfig {
    canvas?: HTMLCanvasElement | string | null;
    powerPreference?: GPUPowerPreference;
    requiredFeatures?: GPUFeatureName[];
    requiredLimits?: Record<string, number>;
    alphaMode?: GPUCanvasAlphaMode;
    onError?: (event: GPUUncapturedErrorEvent) => void;
    onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

/**
 * Resolves a GPUDevice from either a Device instance or a native GPUDevice.
 */
export function resolveDevice(deviceOrGpu: Device | GPUDevice): GPUDevice {
    return "device" in deviceOrGpu ? deviceOrGpu.device : deviceOrGpu;
}

/**
 * Resolves GPUQueue from Device wrapper or raw GPUDevice.
 */
export function resolveQueue(deviceOrGpu: Device | GPUDevice): GPUQueue {
    return "device" in deviceOrGpu ? deviceOrGpu.device.queue : deviceOrGpu.queue;
}

/**
 * Encapsulates GPU adapter negotiation, device lifetime, and swapchain presentation.
 */
export class Device {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
    readonly queue: GPUQueue;
    readonly canvas: HTMLCanvasElement | null;
    readonly context: GPUCanvasContext | null;
    readonly format: GPUTextureFormat;

    constructor(
        adapter: GPUAdapter,
        device: GPUDevice,
        canvas: HTMLCanvasElement | null,
        context: GPUCanvasContext | null,
        format: GPUTextureFormat
    ) {
        this.adapter = adapter;
        this.device = device;
        this.queue = device.queue;
        this.canvas = canvas;
        this.context = context;
        this.format = format;
    }

    /**
     * Unabstracted native GPUDevice handle.
     */
    get native(): GPUDevice {
        return this.device;
    }

    /**
     * Hardware limit capabilities negotiated for device.
     */
    get limits(): GPUSupportedLimits {
        return this.device.limits;
    }

    /**
     * Set of feature flags enabled on device.
     */
    get features(): GPUSupportedFeatures {
        return this.device.features;
    }

    /**
     * Promise resolving when device disconnection occurs.
     */
    get lost(): Promise<GPUDeviceLostInfo> {
        return this.device.lost;
    }

    /**
     * Factory: Negotiates hardware adapter, acquires GPUDevice, and configures canvas swapchain.
     */
    static async create(config: DeviceConfig = {}): Promise<Device> {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not supported in this runtime environment.");
        }

        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: config.powerPreference ?? "high-performance",
        });

        if (!adapter) {
            throw new Error("Failed to acquire GPUAdapter matching requested configuration.");
        }

        const device = await adapter.requestDevice({
            requiredFeatures: config.requiredFeatures,
            requiredLimits: config.requiredLimits,
        });

        if (config.onError) {
            device.addEventListener("uncapturederror", config.onError);
        }

        if (config.onDeviceLost) {
            device.lost.then(config.onDeviceLost);
        }

        let canvasEl: HTMLCanvasElement | null = null;
        let ctx: GPUCanvasContext | null = null;
        let preferredFormat: GPUTextureFormat = "rgba8unorm";

        if (config.canvas) {
            if (typeof config.canvas === "string") {
                const el = document.querySelector(config.canvas);
                if (!el || !(el instanceof HTMLCanvasElement)) {
                    throw new Error(`Canvas element with selector '${config.canvas}' not found.`);
                }
                canvasEl = el;
            } else {
                canvasEl = config.canvas;
            }

            ctx = canvasEl.getContext("webgpu");
            if (!ctx) {
                throw new Error("Failed to acquire WebGPU presentation context from canvas.");
            }

            preferredFormat = navigator.gpu.getPreferredCanvasFormat();
            ctx.configure({
                device,
                format: preferredFormat,
                alphaMode: config.alphaMode ?? "premultiplied",
            });
        }

        return new Device(adapter, device, canvasEl, ctx, preferredFormat);
    }

    /**
     * Factory: Allocates a headless device omitting presentation swapchains for compute or offscreen testing.
     */
    static async createHeadless(config: DeviceConfig = {}): Promise<Device> {
        return Device.create({ ...config, canvas: null });
    }

    /**
     * Instantiates a fresh GPUCommandEncoder with optional diagnostic label.
     */
    createCommandEncoder(label?: string): GPUCommandEncoder {
        return this.device.createCommandEncoder({ label });
    }

    private _singleSubmitArray: [GPUCommandBuffer] = [null as unknown as GPUCommandBuffer];

    /**
     * Accepts a single command buffer/encoder or an array of command buffers/encoders.
     * Encoders are automatically finalized before submission.
     */
    submit(commands: (GPUCommandBuffer | GPUCommandEncoder)[] | GPUCommandBuffer | GPUCommandEncoder): void {
        if (!Array.isArray(commands)) {
            const buf = "finish" in commands ? commands.finish() : commands;
            this._singleSubmitArray[0] = buf;
            this.queue.submit(this._singleSubmitArray);
            this._singleSubmitArray[0] = null as unknown as GPUCommandBuffer;
            return;
        }

        const buffers: GPUCommandBuffer[] = new Array(commands.length);
        for (let i = 0; i < commands.length; i++) {
            const item = commands[i];
            buffers[i] = "finish" in item ? item.finish() : item;
        }

        this.queue.submit(buffers);
    }

    /**
     * Unconfigures presentation context and releases hardware device resources.
     */
    destroy(): void {
        if (this.context) {
            this.context.unconfigure();
        }
        this.device.destroy();
    }
}
