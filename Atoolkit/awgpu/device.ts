export interface DeviceDescriptor {
	/** Power preference hint for adapter selection. */
	powerPreference?: GPUPowerPreference;
	/** Required hardware features to request from the adapter. */
	requiredFeatures?: GPUFeatureName[];
	/** Required hardware limits to request from the adapter. */
	requiredLimits?: Record<string, number>;
	/** Optional debug label for the created GPUDevice. */
	label?: string;
	/** Optional callback invoked when the device is lost. */
	onLost?: (info: GPUDeviceLostInfo) => void;
	/** Optional callback invoked on uncaptured WebGPU validation or out-of-memory errors. */
	onUncapturedError?: (error: GPUError) => void;
}

export type DeviceConfig = DeviceDescriptor;

export interface CanvasSurfaceConfig {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	format?: GPUTextureFormat;
	usage?: GPUTextureUsageFlags;
	alphaMode?: GPUCanvasAlphaMode;
	colorSpace?: PredefinedColorSpace;
}

/**
 * Thin wrapper around a WebGPU adapter, device, and optional canvas context.
 * All awgpu primitives accept either a `Device` wrapper or a raw `GPUDevice`.
 */
export class Device {
	readonly adapter: GPUAdapter;
	readonly native: GPUDevice;
	readonly format: GPUTextureFormat;
	canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
	context: GPUCanvasContext | null = null;
	#destroyed = false;
	#lostInfo: GPUDeviceLostInfo | null = null;
	readonly #lossListeners = new Set<(info: GPUDeviceLostInfo) => void>();

	private constructor(
		adapter: GPUAdapter,
		device: GPUDevice,
		format: GPUTextureFormat
	) {
		this.adapter = adapter;
		this.native = device;
		this.format = format;
	}

	/**
	 * Requests a WebGPU adapter and device from `navigator.gpu`.
	 */
	static async create(desc: DeviceDescriptor = {}): Promise<Device> {
		if (typeof navigator === "undefined" || !navigator.gpu) {
			throw new Error("WebGPU is not supported in this environment (navigator.gpu is unavailable).");
		}

		const adapter = await navigator.gpu.requestAdapter({
			powerPreference: desc.powerPreference ?? "high-performance",
		});

		if (!adapter) {
			throw new Error("Failed to acquire a compatible WebGPU adapter.");
		}

		const requiredFeatures: GPUFeatureName[] = [];
		if (desc.requiredFeatures) {
			for (const feat of desc.requiredFeatures) {
				if (adapter.features.has(feat)) {
					requiredFeatures.push(feat);
				} else {
					throw new Error(`Requested WebGPU feature '${feat}' is not supported by the adapter.`);
				}
			}
		}

		const nativeDevice = await adapter.requestDevice({
			label: desc.label ?? "Awgpu_Device",
			requiredFeatures,
			requiredLimits: desc.requiredLimits,
		});

		const format = navigator.gpu.getPreferredCanvasFormat
			? navigator.gpu.getPreferredCanvasFormat()
			: "bgra8unorm";

		const instance = new Device(adapter, nativeDevice, format);

		if (nativeDevice.lost) {
			nativeDevice.lost.then((info) => {
				instance.#lostInfo = info;
				if (desc.onLost) {
					desc.onLost(info);
				}
				for (const listener of instance.#lossListeners) {
					try {
						listener(info);
					} catch {
						// Ignore listener errors during device loss notification.
					}
				}
			});
		}

		if (typeof nativeDevice.addEventListener === "function") {
			nativeDevice.addEventListener("uncapturederror", (event: Event) => {
				const gpuEvent = event as GPUUncapturedErrorEvent;
				if (desc.onUncapturedError) {
					desc.onUncapturedError(gpuEvent.error);
				}
			});
		}

		return instance;
	}

	/**
	 * Wraps an existing native `GPUDevice`.
	 * Note: calling `destroy()` on a wrapped device will destroy the underlying `GPUDevice`
	 * only if `owned` is set to true (defaults to false for `fromNative`).
	 */
	static fromNative(
		device: GPUDevice,
		adapter?: GPUAdapter,
		format: GPUTextureFormat = "bgra8unorm",
		options: { owned?: boolean } = {}
	): Device {
		const instance = new Device((adapter ?? null) as unknown as GPUAdapter, device, format);
		instance.#owned = options.owned ?? false;
		if (device.lost) {
			device.lost.then((info) => {
				instance.#lostInfo = info;
				for (const listener of instance.#lossListeners) {
					try {
						listener(info);
					} catch {
						// Ignore listener errors.
					}
				}
			});
		}
		return instance;
	}

	#owned = true;

	/** True if this wrapper owns the underlying `GPUDevice` lifetime. */
	get owned(): boolean {
		return this.#owned;
	}

	/** True if `destroy()` has been called on this wrapper. */
	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	/** Non-null if the underlying `GPUDevice` has reported device loss. */
	get lostInfo(): GPUDeviceLostInfo | null {
		return this.#lostInfo;
	}

	/** True if the device has been destroyed or lost. */
	get isLostOrDestroyed(): boolean {
		return this.#destroyed || this.#lostInfo !== null;
	}

	/** Registers a callback invoked if the device is lost. Returns an unsubscribe function. */
	onLost(listener: (info: GPUDeviceLostInfo) => void): () => void {
		if (this.#lostInfo) {
			listener(this.#lostInfo);
			return () => {};
		}
		this.#lossListeners.add(listener);
		return () => {
			this.#lossListeners.delete(listener);
		};
	}

	/** Configures a canvas context for swapchain presentation. */
	configureSurface(config: CanvasSurfaceConfig): GPUCanvasContext {
		const ctx = config.canvas.getContext("webgpu") as GPUCanvasContext | null;
		if (!ctx) {
			throw new Error("Failed to acquire 'webgpu' context from canvas.");
		}

		ctx.configure({
			device: this.native,
			format: config.format ?? this.format,
			usage: config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT,
			alphaMode: config.alphaMode ?? "opaque",
			colorSpace: config.colorSpace ?? "srgb",
		});

		this.canvas = config.canvas;
		this.context = ctx;
		return ctx;
	}

	/**
	 * Acquires the current frame's presentation texture from the configured canvas context.
	 * Must be called per frame/recording; presentation textures must not be cached across frames.
	 */
	getCurrentSurfaceTexture(): GPUTexture {
		if (!this.context) {
			throw new Error("No surface configured on Device. Call configureSurface() first.");
		}
		return this.context.getCurrentTexture();
	}

	/**
	 * Acquires a fresh view of the current frame's presentation texture.
	 * Must be called per frame/recording; presentation views must not be cached across frames.
	 */
	getCurrentSurfaceView(): GPUTextureView {
		return this.getCurrentSurfaceTexture().createView();
	}

	/** Native `GPUQueue` of the underlying device. */
	get queue(): GPUQueue {
		return this.native.queue;
	}

	/** Hardware limits of the underlying device. */
	get limits(): GPUSupportedLimits {
		return this.native.limits;
	}

	/** Enabled features of the underlying device. */
	get features(): GPUSupportedFeatures {
		return this.native.features;
	}

	/** Pushes error scopes for validation, out-of-memory, and internal errors. */
	pushErrorScopes(): void {
		this.native.pushErrorScope("validation");
		this.native.pushErrorScope("out-of-memory");
		this.native.pushErrorScope("internal");
	}

	/** Pops the 3 error scopes pushed by `pushErrorScopes()` and returns any captured errors. */
	async popErrorScopes(): Promise<GPUError[]> {
		const internalErr = await this.native.popErrorScope();
		const oomErr = await this.native.popErrorScope();
		const validationErr = await this.native.popErrorScope();

		const errors: GPUError[] = [];
		if (validationErr) errors.push(validationErr);
		if (oomErr) errors.push(oomErr);
		if (internalErr) errors.push(internalErr);
		return errors;
	}

	/**
	 * Marks this wrapper as destroyed and destroys the underlying `GPUDevice` if owned.
	 * Idempotent.
	 */
	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		if (this.#owned) {
			this.native.destroy();
		}
	}
}

/**
 * Resolves either a `Device` wrapper or a raw `GPUDevice` into the native `GPUDevice`.
 */
export function resolveDevice(device: Device | GPUDevice): GPUDevice {
	return device instanceof Device ? device.native : device;
}

/**
 * Resolves either a `Device` wrapper or a raw `GPUDevice` into its `GPUQueue`.
 */
export function resolveQueue(device: Device | GPUDevice): GPUQueue {
	return device instanceof Device ? device.queue : device.queue;
}

const _resourceIds = new WeakMap<object, number>();
let _nextResourceId = 1;

/**
 * Returns a process-unique numeric identity for any GPU object or wrapper reference.
 */
export function getResourceId(obj: object): number {
	let id = _resourceIds.get(obj);
	if (id === undefined) {
		id = _nextResourceId++;
		_resourceIds.set(obj, id);
	}
	return id;
}
