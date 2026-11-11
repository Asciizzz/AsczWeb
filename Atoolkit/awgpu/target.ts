// ================================================================
//  Awgpu - Level 2: Render Destination Coordinator (Target)
// ================================================================

import { type Device } from "./device.js";
import { Texture, resolveTextureView } from "./memory.js";

export interface ColorTargetDesc {
	/** Target attachment view or texture. `null` indicates the swapchain canvas backbuffer. */
	target: GPUTextureView | Texture | null;
	clearColor?: GPUColor;
	loadOp?: GPULoadOp;
	storeOp?: GPUStoreOp;
	/** Optional MSAA resolve destination. `null` resolves directly to the swapchain canvas backbuffer. */
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

export interface TargetResizeOptions {
	/**
	 * Optional array to receive replaced owned `Texture` instances instead of destroying them immediately.
	 * Use this when resizing while prior command encoders referencing the old attachments have not yet been submitted.
	 */
	retiredOut?: Texture[];
}

export interface TargetAttachmentMutationOptions {
	/** When true, `Target` takes ownership of the provided `Texture` and will destroy/retire it on replacement, `resize()`, or `destroy()`. Defaults to `false` (borrowed). */
	owned?: boolean;
	/** Optional array to receive a replaced owned `Texture` instead of destroying it immediately. */
	retiredOut?: Texture[];
}

function cloneAndFreezeClearColor(color: GPUColor | undefined): GPUColor | undefined {
	if (color === undefined) {
		return undefined;
	}
	if (Array.isArray(color) || Symbol.iterator in Object(color)) {
		return Object.freeze(Array.from(color as Iterable<number>));
	}
	const dict = color as GPUColorDict;
	return Object.freeze({
		r: dict.r,
		g: dict.g,
		b: dict.b,
		a: dict.a,
	});
}

function cloneAndFreezeColorTargetDesc(desc: ColorTargetDesc): Readonly<ColorTargetDesc> {
	if (!desc || typeof desc !== "object") {
		throw new TypeError("Target: color target descriptor must be an object.");
	}
	return Object.freeze({
		target: desc.target,
		clearColor: cloneAndFreezeClearColor(desc.clearColor),
		loadOp: desc.loadOp,
		storeOp: desc.storeOp,
		resolveTarget: desc.resolveTarget,
	});
}

function cloneAndFreezeDepthTargetDesc(desc: DepthTargetDesc): Readonly<DepthTargetDesc> {
	if (!desc || typeof desc !== "object" || !desc.target) {
		throw new TypeError("Target: depth target descriptor must be an object with a valid target.");
	}
	return Object.freeze({
		target: desc.target,
		depthClearValue: desc.depthClearValue,
		depthLoadOp: desc.depthLoadOp,
		depthStoreOp: desc.depthStoreOp,
		stencilClearValue: desc.stencilClearValue,
		stencilLoadOp: desc.stencilLoadOp,
		stencilStoreOp: desc.stencilStoreOp,
	});
}

/**
 * Coordinates render pass color, resolve, and depth/stencil attachments.
 *
 * Ownership and lifetime contract:
 * - `Target.createScreen` and `Target.createOffscreen` own the attachment `Texture` instances they allocate.
 * - Attachments supplied to `new Target(...)`, `setColorTarget()`, `setResolveTarget()`, or `setDepthTarget()`
 *   are borrowed by default unless `options.owned` is true.
 * - `colorTargets`, `depthTarget`, and `colorTextures` are read-only inspection snapshots. All attachment
 *   changes must go through `setColorTarget()`, `setResolveTarget()`, `setDepthTarget()`, or `resize()` so
 *   `generation` and cached `GPURenderPassDescriptor` state remain synchronized with `PassGraph`.
 * - `resize()` and `destroy()` only destroy owned textures and never destroy borrowed caller textures.
 * - Call `resize()` or `destroy()` at a submission boundary (or pass `retiredOut` to `resize()`) so textures
 *   referenced by unsubmitted command encoders are not destroyed prematurely.
 */
export class Target {
	readonly label: string;
	readonly isScreen: boolean;
	readonly sampleCount: number;
	device?: Device;
	width: number;
	height: number;

	colorFormat?: GPUTextureFormat;
	depthFormat?: GPUTextureFormat;

	#colorTargets: Readonly<ColorTargetDesc>[] = [];
	#colorTargetsSnapshot: ReadonlyArray<Readonly<ColorTargetDesc>> = Object.freeze([]);
	#depthTarget?: Readonly<DepthTargetDesc>;
	#colorTexturesSnapshot: ReadonlyArray<Texture> = Object.freeze([]);

	#generation = 1;
	#destroyed = false;
	#cachedDescriptor?: GPURenderPassDescriptor;
	#cachedColorAttachments: GPURenderPassColorAttachment[] = [];
	#cachedDepthStencilAttachment?: GPURenderPassDepthStencilAttachment;
	#ownedColorTextures = new Set<Texture>();
	#ownedDepthTexture: Texture | null = null;
	#ownedMsaaColorTexture: Texture | null = null;
	#colorFormats: GPUTextureFormat[] = [];

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
		if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
			throw new RangeError(`Target: width (${width}) and height (${height}) must be positive integers.`);
		}
		this.label = label;
		this.width = width;
		this.height = height;
		this.isScreen = options.isScreen ?? false;
		this.sampleCount = options.sampleCount ?? 1;
		this.device = options.device;
		this.#colorTargets = options.colorTargets
			? options.colorTargets.map((c) => cloneAndFreezeColorTargetDesc(c))
			: [];
		this.#depthTarget = options.depthTarget
			? cloneAndFreezeDepthTargetDesc(options.depthTarget)
			: undefined;
		this.colorFormat = options.colorFormat;
		this.depthFormat = options.depthFormat;
		this.#syncSnapshots();
	}

	#syncSnapshots(): void {
		this.#colorTargetsSnapshot = Object.freeze([...this.#colorTargets]);
		const textures: Texture[] = [];
		for (let i = 0; i < this.#colorTargets.length; i++) {
			const t = this.#colorTargets[i].target;
			if (t instanceof Texture) {
				textures.push(t);
			}
		}
		this.#colorTexturesSnapshot = Object.freeze(textures);
	}

	/** Read-only snapshot of color attachment descriptors. Mutate via `setColorTarget` / `setResolveTarget`. */
	get colorTargets(): ReadonlyArray<Readonly<ColorTargetDesc>> {
		return this.#colorTargetsSnapshot;
	}

	/** Read-only snapshot of the depth/stencil attachment descriptor. Mutate via `setDepthTarget`. */
	get depthTarget(): Readonly<DepthTargetDesc> | undefined {
		return this.#depthTarget;
	}

	/** Read-only snapshot of `Texture` attachments currently bound to color slots. */
	get colorTextures(): ReadonlyArray<Texture> {
		return this.#colorTexturesSnapshot;
	}

	#assertMutable(): void {
		if (this.#destroyed) throw new Error("Target has been destroyed.");
	}

	/** Monotonic attachment generation incremented whenever attachments or dimensions change. */
	get generation(): number {
		return this.#generation;
	}

	/** True if `destroy()` has been called on this target. */
	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	/**
	 * Invalidates the cached `GPURenderPassDescriptor` and increments `generation`.
	 */
	invalidateCache(): void {
		this.#cachedDescriptor = undefined;
		this.#cachedColorAttachments.length = 0;
		this.#cachedDepthStencilAttachment = undefined;
		this.#generation++;
	}

	/**
	 * Updates the color attachment descriptor at `index`.
	 * `index` must be in `[0, colorTargets.length]` (sparse indices are rejected).
	 * By default, caller-provided textures are borrowed (`owned = false`).
	 */
	setColorTarget(
		index: number,
		desc: ColorTargetDesc,
		options?: TargetAttachmentMutationOptions
	): void {
		this.#assertMutable();
		if (!Number.isInteger(index) || index < 0 || index > this.#colorTargets.length) {
			throw new RangeError(
				`Target.setColorTarget: index (${index}) must be an integer in [0, ${this.#colorTargets.length}].`
			);
		}
		const frozenDesc = cloneAndFreezeColorTargetDesc(desc);
		const prev = this.#colorTargets[index];
		if (prev && prev.target instanceof Texture && this.#ownedColorTextures.has(prev.target)) {
			if (prev.target !== frozenDesc.target) {
				this.#ownedColorTextures.delete(prev.target);
				this.#retireOrDestroy(prev.target, options?.retiredOut);
			}
		}
		if (
			this.isScreen &&
			index === 0 &&
			this.#ownedMsaaColorTexture !== null &&
			this.#ownedMsaaColorTexture !== frozenDesc.target
		) {
			const oldMsaa = this.#ownedMsaaColorTexture;
			this.#ownedMsaaColorTexture = null;
			this.#retireOrDestroy(oldMsaa, options?.retiredOut);
		}
		this.#colorTargets[index] = frozenDesc;
		if (frozenDesc.target instanceof Texture) {
			if (options?.owned) {
				this.#ownedColorTextures.add(frozenDesc.target);
			} else {
				this.#ownedColorTextures.delete(frozenDesc.target);
			}
			this.#colorFormats[index] = frozenDesc.target.format;
		}
		this.#syncSnapshots();
		this.invalidateCache();
	}

	/**
	 * Updates the MSAA resolve target at `index`.
	 */
	setResolveTarget(index: number, resolveTarget: GPUTextureView | Texture | null | undefined): void {
		this.#assertMutable();
		if (!Number.isInteger(index) || index < 0 || index >= this.#colorTargets.length) {
			throw new RangeError(`Target.setResolveTarget: index (${index}) out of bounds.`);
		}
		this.#colorTargets[index] = cloneAndFreezeColorTargetDesc({
			...this.#colorTargets[index],
			resolveTarget,
		});
		this.#syncSnapshots();
		this.invalidateCache();
	}

	/**
	 * Updates the depth/stencil attachment descriptor.
	 * By default, a caller-provided texture is borrowed (`owned = false`).
	 */
	setDepthTarget(
		desc: DepthTargetDesc | undefined,
		options?: TargetAttachmentMutationOptions
	): void {
		this.#assertMutable();
		const frozenDesc = desc !== undefined ? cloneAndFreezeDepthTargetDesc(desc) : undefined;
		if (this.#ownedDepthTexture && (!frozenDesc || frozenDesc.target !== this.#ownedDepthTexture)) {
			const oldDepth = this.#ownedDepthTexture;
			this.#ownedDepthTexture = null;
			this.#retireOrDestroy(oldDepth, options?.retiredOut);
		}
		this.#depthTarget = frozenDesc;
		if (frozenDesc && frozenDesc.target instanceof Texture) {
			this.#ownedDepthTexture = options?.owned ? frozenDesc.target : null;
			this.depthFormat = frozenDesc.target.format;
		}
		this.invalidateCache();
	}

	/**
	 * Creates a render target bound to the device's canvas presentation swapchain.
	 * Pass `depthFormat: null` to create a color-only target without a depth attachment.
	 */
	static createScreen(
		device: Device,
		options: {
			depthFormat?: GPUTextureFormat | null;
			depthClearValue?: number;
			depthLoadOp?: GPULoadOp;
			depthStoreOp?: GPUStoreOp;
			clearColor?: GPUColor;
			loadOp?: GPULoadOp;
			storeOp?: GPUStoreOp;
			sampleCount?: number;
			label?: string;
		} = {}
	): Target {
		const canvas = device.canvas;
		const w = Math.max(1, canvas ? (canvas.width | 0) : 1);
		const h = Math.max(1, canvas ? (canvas.height | 0) : 1);
		const hasDepth = options.depthFormat !== null;
		const depthFormat = hasDepth ? (options.depthFormat ?? "depth24plus") : undefined;
		const clearColor = options.clearColor ?? { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
		const label = options.label ?? "ScreenTarget";
		const sampleCount = options.sampleCount ?? 1;

		let msaaColorTex: Texture | null = null;
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
				loadOp: options.loadOp ?? "clear",
				storeOp: options.storeOp ?? "discard",
			};
		} else {
			colorDesc = {
				target: null,
				clearColor,
				loadOp: options.loadOp ?? "clear",
				storeOp: options.storeOp ?? "store",
			};
		}

		let depthTarget: DepthTargetDesc | undefined;
		let depthTex: Texture | null = null;

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
				depthClearValue: options.depthClearValue ?? 1.0,
				depthLoadOp: options.depthLoadOp ?? "clear",
				depthStoreOp: options.depthStoreOp ?? "store",
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

		target.#ownedDepthTexture = depthTex;
		target.#ownedMsaaColorTexture = msaaColorTex;
		return target;
	}

	/**
	 * Creates an offscreen color and optional depth render target (RTT).
	 * Owned color textures are exposed via `colorTextures[]`.
	 */
	static createOffscreen(
		device: Device | GPUDevice,
		desc: {
			width: number;
			height: number;
			colorFormats?: GPUTextureFormat[];
			depthFormat?: GPUTextureFormat;
			depthClearValue?: number;
			depthLoadOp?: GPULoadOp;
			depthStoreOp?: GPUStoreOp;
			clearColor?: GPUColor;
			loadOp?: GPULoadOp;
			storeOp?: GPUStoreOp;
			sampleCount?: number;
			label?: string;
		}
	): Target {
		if (!Number.isInteger(desc.width) || desc.width < 1 || !Number.isInteger(desc.height) || desc.height < 1) {
			throw new RangeError(
				`Target.createOffscreen: width (${desc.width}) and height (${desc.height}) must be positive integers.`
			);
		}
		const w = desc.width;
		const h = desc.height;
		const label = desc.label ?? "OffscreenTarget";
		const formats = desc.colorFormats ?? ["rgba8unorm"];
		const sampleCount = desc.sampleCount ?? 1;
		const clearColor = desc.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };

		const textures: Texture[] = [];
		const colorTargets: ColorTargetDesc[] = new Array(formats.length);
		for (let i = 0; i < formats.length; i++) {
			const tex = Texture.create2D(device, {
				width: w,
				height: h,
				format: formats[i],
				sampleCount,
				label: `${label}_Color${i}`,
			});
			textures.push(tex);
			colorTargets[i] = {
				target: tex,
				clearColor,
				loadOp: desc.loadOp ?? "clear",
				storeOp: desc.storeOp ?? "store",
			};
		}

		let depthTarget: DepthTargetDesc | undefined;
		let depthTex: Texture | null = null;
		if (desc.depthFormat) {
			depthTex = Texture.createDepth(device, {
				width: w,
				height: h,
				format: desc.depthFormat,
				sampleCount,
				label: `${label}_Depth`,
			});
			depthTarget = {
				target: depthTex,
				depthClearValue: desc.depthClearValue ?? 1.0,
				depthLoadOp: desc.depthLoadOp ?? "clear",
				depthStoreOp: desc.depthStoreOp ?? "store",
			};
		}

		const target = new Target(label, w, h, {
			isScreen: false,
			colorTargets,
			depthTarget,
			colorFormat: formats[0],
			depthFormat: desc.depthFormat,
			sampleCount,
		});

		target.#ownedDepthTexture = depthTex;
		for (const tex of textures) {
			target.#ownedColorTextures.add(tex);
		}
		target.#colorFormats = formats.slice();
		target.#syncSnapshots();

		return target;
	}

	/**
	 * Synchronizes attachments and returns a `GPURenderPassDescriptor`.
	 * Presentation views (`target === null` or `resolveTarget === null`) are acquired fresh per call.
	 */
	getDescriptor(): GPURenderPassDescriptor {
		if (this.#destroyed) {
			throw new Error("Target.getDescriptor: cannot use a destroyed Target.");
		}
		if (this.isScreen && this.device && this.device.canvas) {
			const cw = Math.max(1, this.device.canvas.width | 0);
			const ch = Math.max(1, this.device.canvas.height | 0);
			if (this.width !== cw || this.height !== ch) {
				this.resize(this.device, cw, ch);
			}
		}

		const colorCount = this.#colorTargets.length;
		if (!this.#cachedDescriptor || this.#cachedColorAttachments.length !== colorCount) {
			this.#cachedColorAttachments = new Array(colorCount);
			for (let i = 0; i < colorCount; i++) {
				this.#cachedColorAttachments[i] = {
					view: null as unknown as GPUTextureView,
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				};
			}
			if (this.#depthTarget) {
				this.#cachedDepthStencilAttachment = {
					view: null as unknown as GPUTextureView,
					depthClearValue: 1.0,
					depthLoadOp: "clear",
					depthStoreOp: "store",
				};
			} else {
				this.#cachedDepthStencilAttachment = undefined;
			}
			this.#cachedDescriptor = {
				label: `${this.label}_PassDescriptor`,
				colorAttachments: this.#cachedColorAttachments,
				depthStencilAttachment: this.#cachedDepthStencilAttachment,
			};
		}

		for (let i = 0; i < colorCount; i++) {
			const cfg = this.#colorTargets[i];
			const att = this.#cachedColorAttachments[i];

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

		if (this.#depthTarget) {
			if (!this.#cachedDepthStencilAttachment) {
				this.#cachedDepthStencilAttachment = {
					view: null as unknown as GPUTextureView,
					depthClearValue: 1.0,
					depthLoadOp: "clear",
					depthStoreOp: "store",
				};
				this.#cachedDescriptor.depthStencilAttachment = this.#cachedDepthStencilAttachment;
			}
			const ds = this.#cachedDepthStencilAttachment;
			ds.view = resolveTextureView(this.#depthTarget.target);
			ds.depthClearValue = this.#depthTarget.depthClearValue ?? 1.0;
			ds.depthLoadOp = this.#depthTarget.depthLoadOp ?? "clear";
			ds.depthStoreOp = this.#depthTarget.depthStoreOp ?? "store";
			ds.stencilClearValue = this.#depthTarget.stencilClearValue;
			ds.stencilLoadOp = this.#depthTarget.stencilLoadOp;
			ds.stencilStoreOp = this.#depthTarget.stencilStoreOp;
		} else if (this.#cachedDescriptor.depthStencilAttachment) {
			this.#cachedDescriptor.depthStencilAttachment = undefined;
			this.#cachedDepthStencilAttachment = undefined;
		}

		return this.#cachedDescriptor;
	}

	#retireOrDestroy(tex: Texture | null, retiredOut?: Texture[]): void {
		if (!tex) return;
		if (retiredOut) {
			retiredOut.push(tex);
		} else {
			tex.destroy();
		}
	}

	/**
	 * Resizes owned internal attachment textures and increments `generation`.
	 * Borrowed caller-supplied textures are never destroyed by `resize()`.
	 */
	resize(
		device: Device | GPUDevice,
		width: number,
		height: number,
		options?: TargetResizeOptions
	): void {
		if (this.#destroyed) {
			throw new Error("Target.resize: cannot resize a destroyed Target.");
		}
		if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
			throw new RangeError(
				`Target.resize: width (${width}) and height (${height}) must be positive integers.`
			);
		}

		this.width = width;
		this.height = height;
		const retiredOut = options?.retiredOut;

		if (this.isScreen) {
			if (this.sampleCount > 1 && this.#ownedMsaaColorTexture !== null) {
				const oldMsaa = this.#ownedMsaaColorTexture;
				this.#ownedMsaaColorTexture = Texture.create2D(device, {
					width: this.width,
					height: this.height,
					format: this.colorFormat ?? "rgba8unorm",
					sampleCount: this.sampleCount,
					label: `${this.label}_MSAAColor`,
				});
				if (this.#colorTargets[0]) {
					this.#colorTargets[0] = cloneAndFreezeColorTargetDesc({
						...this.#colorTargets[0],
						target: this.#ownedMsaaColorTexture,
					});
				}
				this.#retireOrDestroy(oldMsaa, retiredOut);
			}

			if (this.depthFormat && this.#ownedDepthTexture !== null) {
				const oldDepth = this.#ownedDepthTexture;
				this.#ownedDepthTexture = Texture.createDepth(device, {
					width: this.width,
					height: this.height,
					format: this.depthFormat,
					sampleCount: this.sampleCount,
					label: `${this.label}_Depth`,
				});
				if (this.#depthTarget) {
					this.#depthTarget = cloneAndFreezeDepthTargetDesc({
						...this.#depthTarget,
						target: this.#ownedDepthTexture,
					});
				}
				this.#retireOrDestroy(oldDepth, retiredOut);
			}
		} else {
			for (let i = 0; i < this.#colorTargets.length; i++) {
				const oldTarget = this.#colorTargets[i].target;
				if (!(oldTarget instanceof Texture) || !this.#ownedColorTextures.has(oldTarget)) {
					continue;
				}
				const newTex = Texture.create2D(device, {
					width: this.width,
					height: this.height,
					format: this.#colorFormats[i] ?? oldTarget.format ?? "rgba8unorm",
					sampleCount: this.sampleCount,
					label: `${this.label}_Color${i}`,
				});
				this.#ownedColorTextures.delete(oldTarget);
				this.#ownedColorTextures.add(newTex);
				this.#colorTargets[i] = cloneAndFreezeColorTargetDesc({
					...this.#colorTargets[i],
					target: newTex,
				});
				this.#retireOrDestroy(oldTarget, retiredOut);
			}

			if (this.depthFormat && this.#depthTarget && this.#ownedDepthTexture !== null) {
				const oldDepth = this.#ownedDepthTexture;
				this.#ownedDepthTexture = Texture.createDepth(device, {
					width: this.width,
					height: this.height,
					format: this.depthFormat,
					sampleCount: this.sampleCount,
					label: `${this.label}_Depth`,
				});
				this.#depthTarget = cloneAndFreezeDepthTargetDesc({
					...this.#depthTarget,
					target: this.#ownedDepthTexture,
				});
				this.#retireOrDestroy(oldDepth, retiredOut);
			}
		}

		this.#syncSnapshots();
		this.invalidateCache();
	}

	/**
	 * Destroys all attachment textures owned by this `Target`.
	 * Borrowed caller-supplied textures and the `Device` are never destroyed. Idempotent.
	 */
	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		for (const tex of this.#ownedColorTextures) {
			tex.destroy();
		}
		this.#ownedColorTextures.clear();
		if (this.#ownedMsaaColorTexture) {
			this.#ownedMsaaColorTexture.destroy();
			this.#ownedMsaaColorTexture = null;
		}
		if (this.#ownedDepthTexture) {
			this.#ownedDepthTexture.destroy();
			this.#ownedDepthTexture = null;
		}
		this.invalidateCache();
	}
}
