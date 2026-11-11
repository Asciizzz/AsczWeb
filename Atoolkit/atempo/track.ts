import { type Curve, type InterpolationContext, evaluateCurve } from "./curve.js";

/**
 * Boundary extrapolation policy for `Track` sampling outside `[startTime, endTime]`.
 */
export enum Extrapolation {
	Clamp = "clamp",
	Loop = "loop",
	PingPong = "ping-pong",
}

/**
 * Single keyframe entry storing timestamp, value, and outgoing segment curve metadata.
 */
export interface Keyframe<T> {
	readonly time: number;
	readonly value: T;
	readonly curve?: Curve;
	readonly curveData?: any;
	readonly fps?: number;
}

export interface TrackOptions {
	/** Enable frame snapping for keyframe timestamps. */
	quantizeToFrames?: boolean;
	/** Frame rate in frames per second used when quantizeToFrames is enabled (> 0). */
	quantizationFps?: number;
	/** Optional default interval quantization FPS applied during sampling. */
	fps?: number;
	/** Boundary extrapolation mode outside `[startTime, endTime]`. Defaults to `Extrapolation.Clamp`. */
	extrapolation?: Extrapolation;
}

/**
 * Abstract generic keyframe track over input values of type `T` and sampled outputs of type `TOut`.
 *
 * Keyframe contract:
 * - Timestamps must be finite numbers.
 * - Keys are maintained in strictly ascending timestamp order.
 * - Adding a key at an existing timestamp (after optional frame quantization) replaces
 *   the existing key at that timestamp rather than creating a zero-width interval.
 * - Interval lookup uses `[k_i.time, k_{i+1}.time)` for all interior intervals in both the
 *   temporal-locality cache check and the binary search fallback.
 */
export abstract class Track<T, TOut = T> {
	readonly #keys: Keyframe<T>[] = [];
	#lastKeyIndex = 0;
	readonly #interpContext: InterpolationContext = { dt: 0, k0Time: 0, k1Time: 0 };

	quantizeToFrames = false;
	quantizationFps = 60;
	fps?: number;
	extrapolation: Extrapolation = Extrapolation.Clamp;

	constructor(optionsOrInitialCapacity?: TrackOptions | number) {
		if (typeof optionsOrInitialCapacity === "object" && optionsOrInitialCapacity !== null) {
			const fps = optionsOrInitialCapacity.quantizationFps ?? 60;
			if (!Number.isFinite(fps) || fps <= 0) {
				throw new RangeError(`Track: quantizationFps must be a finite positive number, got ${fps}.`);
			}
			if (
				optionsOrInitialCapacity.fps !== undefined &&
				(!Number.isFinite(optionsOrInitialCapacity.fps) || optionsOrInitialCapacity.fps <= 0)
			) {
				throw new RangeError(
					`Track: fps must be a finite positive number, got ${optionsOrInitialCapacity.fps}.`
				);
			}
			this.quantizeToFrames = optionsOrInitialCapacity.quantizeToFrames ?? false;
			this.quantizationFps = fps;
			this.fps = optionsOrInitialCapacity.fps;
			this.extrapolation = optionsOrInitialCapacity.extrapolation ?? Extrapolation.Clamp;
		}
	}

	/**
	 * Interpolates between `a` and `b` at progress `alpha`, writing into `out` when applicable.
	 */
	abstract blend(a: T, b: T, alpha: number, out?: TOut): TOut;

	/**
	 * Produces the default output value when the track has no keyframes or `out` is omitted.
	 */
	protected abstract defaultValue(out?: TOut): TOut;

	/**
	 * Clones a keyframe input value on insertion so external mutations to caller arrays
	 * cannot corrupt stored keyframes.
	 */
	protected cloneInput(value: T): T {
		if (value instanceof Float32Array) {
			return new Float32Array(value) as unknown as T;
		}
		if (Array.isArray(value)) {
			return [...value] as unknown as T;
		}
		return value;
	}

	/** Configures frame quantization settings for keyframe timestamps and invalidates cached state. */
	setQuantization(fps: number, enabled = true): this {
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new RangeError(`Track.setQuantization: fps must be a finite positive number, got ${fps}.`);
		}
		this.quantizationFps = fps;
		this.quantizeToFrames = enabled;
		this.#lastKeyIndex = 0;
		return this;
	}

	/** Snaps `time` to the nearest frame boundary if `quantizeToFrames` is enabled. */
	quantizeTime(time: number): number {
		if (!Number.isFinite(time)) {
			throw new RangeError(`Track.quantizeTime: time must be a finite number, got ${time}.`);
		}
		if (!this.quantizeToFrames) return time;
		return Math.round(time * this.quantizationFps) / this.quantizationFps;
	}

	/**
	 * Inserts or replaces a keyframe at `time` (in seconds).
	 * If a keyframe already exists at the resolved timestamp, it is replaced in-place.
	 */
	addKey<TData = any>(
		time: number,
		value: T,
		curve?: Curve<TData>,
		curveData?: TData,
		fps?: number
	): this {
		if (!Number.isFinite(time)) {
			throw new RangeError(`Track.addKey: time must be a finite number, got ${time}.`);
		}
		if (fps !== undefined && (!Number.isFinite(fps) || fps <= 0)) {
			throw new RangeError(`Track.addKey: fps must be a finite positive number, got ${fps}.`);
		}
		const t = this.quantizeTime(time);
		const storedVal = this.cloneInput(value);
		const newKey: Keyframe<T> = { time: t, value: storedVal, curve, curveData, fps };

		this.#lastKeyIndex = 0;

		const len = this.#keys.length;
		if (len === 0 || t > this.#keys[len - 1].time) {
			this.#keys.push(newKey);
			return this;
		}

		let low = 0;
		let high = len - 1;
		while (low <= high) {
			const mid = (low + high) >>> 1;
			const midTime = this.#keys[mid].time;
			if (midTime === t || (this.quantizeToFrames && Math.abs(midTime - t) <= 1e-7)) {
				this.#keys[mid] = newKey;
				return this;
			}
			if (midTime < t) {
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		this.#keys.splice(low, 0, newKey);
		return this;
	}

	/** Updates the outgoing curve metadata on the keyframe at `index`. */
	setCurve<TData = any>(
		index: number,
		curve?: Curve<TData>,
		curveData?: TData,
		fps?: number
	): this {
		if (!Number.isInteger(index) || index < 0 || index >= this.#keys.length) {
			throw new RangeError(`Track.setCurve: index (${index}) out of bounds.`);
		}
		if (fps !== undefined && (!Number.isFinite(fps) || fps <= 0)) {
			throw new RangeError(`Track.setCurve: fps must be a finite positive number, got ${fps}.`);
		}
		const existing = this.#keys[index];
		this.#keys[index] = {
			time: existing.time,
			value: existing.value,
			curve,
			curveData,
			fps,
		};
		return this;
	}

	/** Returns the keyframe at `index`, or `undefined` if out of bounds. */
	getKey(index: number): Keyframe<T> | undefined {
		if (!Number.isInteger(index) || index < 0 || index >= this.#keys.length) {
			return undefined;
		}
		return this.#keys[index];
	}

	/** Removes the keyframe at `index` and invalidates cached interval state. */
	removeKeyAt(index: number): boolean {
		if (!Number.isInteger(index) || index < 0 || index >= this.#keys.length) {
			return false;
		}
		this.#keys.splice(index, 1);
		this.#lastKeyIndex = 0;
		return true;
	}

	/** Alias for `removeKeyAt(index)`. */
	removeKey(index: number): boolean {
		return this.removeKeyAt(index);
	}

	/** Removes all keyframes and resets cached interval state. */
	clear(): void {
		this.#keys.length = 0;
		this.#lastKeyIndex = 0;
	}

	/** Read-only snapshot of sorted keyframes. */
	get keys(): ReadonlyArray<Keyframe<T>> {
		return [...this.#keys];
	}

	/** Number of keyframes in this track. */
	get keyCount(): number {
		return this.#keys.length;
	}

	/** Alias for `keyCount`. */
	get length(): number {
		return this.#keys.length;
	}

	/** Timestamp of the first keyframe, or 0 if the track has no keys. */
	get startTime(): number {
		return this.#keys.length > 0 ? this.#keys[0].time : 0;
	}

	/** Timestamp of the last keyframe, or 0 if the track has no keys. */
	get endTime(): number {
		const len = this.#keys.length;
		return len > 0 ? this.#keys[len - 1].time : 0;
	}

	/** Span `endTime - startTime` (or `endTime` when `startTime === 0`). */
	/** Total keyframe span (`endTime - startTime`), or `0` if fewer than 2 keyframes exist. */
	get duration(): number {
		const len = this.#keys.length;
		if (len <= 1) return 0;
		return this.#keys[len - 1].time - this.#keys[0].time;
	}

	/**
	 * Resolves the interval index `i` such that `keys[i].time <= time < keys[i + 1].time`.
	 * Uses a temporal-locality hint followed by binary search with identical half-open `[t0, t1)` predicates.
	 */
	#findKeyIndex(time: number): number {
		const keys = this.#keys;
		const len = keys.length;

		const last = this.#lastKeyIndex;
		if (last >= 0 && last < len - 1) {
			if (time >= keys[last].time && time < keys[last + 1].time) {
				return last;
			}
			if (last + 1 < len - 1 && time >= keys[last + 1].time && time < keys[last + 2].time) {
				this.#lastKeyIndex = last + 1;
				return last + 1;
			}
		}

		let low = 0;
		let high = len - 2;
		while (low <= high) {
			const mid = (low + high) >>> 1;
			if (keys[mid].time <= time) {
				if (time < keys[mid + 1].time) {
					this.#lastKeyIndex = mid;
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		const fallback = Math.max(0, len - 2);
		this.#lastKeyIndex = fallback;
		return fallback;
	}

	#applyExtrapolation(time: number, tStart: number, tEnd: number): number {
		const span = tEnd - tStart;
		if (span <= 0 || this.extrapolation === Extrapolation.Clamp) {
			return time;
		}
		if (time >= tStart && time <= tEnd) {
			return time;
		}
		const offset = time - tStart;
		if (this.extrapolation === Extrapolation.Loop) {
			const rem = offset % span;
			return tStart + (rem < 0 ? rem + span : rem);
		}
		if (this.extrapolation === Extrapolation.PingPong) {
			const cycle = span * 2;
			let rem = offset % cycle;
			if (rem < 0) rem += cycle;
			return tStart + (rem <= span ? rem : cycle - rem);
		}
		return time;
	}

	/**
	 * Samples the track at `time` (in seconds), writing into `out` when provided.
	 * Throws a `RangeError` if `time` is non-finite.
	 */
	sample(time: number, out?: TOut): TOut {
		if (!Number.isFinite(time)) {
			throw new RangeError(`Track.sample: time must be a finite number, got ${time}.`);
		}
		const keys = this.#keys;
		const len = keys.length;

		if (len === 0) {
			return this.defaultValue(out);
		}
		if (len === 1) {
			return this.blend(keys[0].value, keys[0].value, 0, out);
		}

		const tStart = keys[0].time;
		const tEnd = keys[len - 1].time;
		const effectiveTime = this.#applyExtrapolation(time, tStart, tEnd);

		if (effectiveTime <= tStart) {
			return this.blend(keys[0].value, keys[0].value, 0, out);
		}
		if (effectiveTime >= tEnd) {
			return this.blend(keys[len - 1].value, keys[len - 1].value, 0, out);
		}

		const idx = this.#findKeyIndex(effectiveTime);
		const k0 = keys[idx];
		const k1 = keys[idx + 1];

		const dt = k1.time - k0.time;
		if (dt <= 0) {
			return this.blend(k0.value, k0.value, 0, out);
		}

		let localElapsed = effectiveTime - k0.time;
		const intervalFps = k0.fps ?? this.fps;
		if (intervalFps !== undefined && intervalFps > 0) {
			localElapsed = Math.min(dt, Math.floor(localElapsed * intervalFps) / intervalFps);
		}

		const u = localElapsed / dt;
		let alpha = u;
		if (k0.curve) {
			this.#interpContext.dt = dt;
			this.#interpContext.k0Time = k0.time;
			this.#interpContext.k1Time = k1.time;
			alpha = evaluateCurve(k0.curve, u, k0.curveData, this.#interpContext);
		}

		return this.blend(k0.value, k1.value, alpha, out);
	}

	/**
	 * Samples the track at a normalized ratio in `[0, 1]` mapped across `[startTime, endTime]`.
	 */
	sampleRatio(ratio: number, out?: TOut): TOut {
		if (!Number.isFinite(ratio)) {
			throw new RangeError(`Track.sampleRatio: ratio must be a finite number, got ${ratio}.`);
		}
		const len = this.#keys.length;
		if (len === 0) {
			return this.defaultValue(out);
		}
		const tStart = this.#keys[0].time;
		const tEnd = this.#keys[len - 1].time;
		const clamped = Math.max(0, Math.min(1, ratio));
		return this.sample(tStart + clamped * (tEnd - tStart), out);
	}
}
