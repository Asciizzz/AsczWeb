import { Track, type TrackOptions } from "../track.js";

/**
 * Color channel interpolation mode for `ColorTrack`.
 * - `Linear` (`"linear"`): Direct linear interpolation of color channels.
 * - `ApproxGamma2` (`"approx-gamma2"`): Fast approximate gamma-2.0 transfer (squares RGB channels
 *   before linear interpolation and takes square root on output; alpha is interpolated linearly).
 *   Note: this is a gamma-2.0 approximation, not IEC 61966-2-1 piecewise sRGB or perceptual Oklab.
 * - `PerceptualGamma` / `SRGB`: Legacy aliases for `ApproxGamma2` retained for compatibility.
 */
export enum ColorSpace {
	Linear = "linear",
	ApproxGamma2 = "approx-gamma2",
	PerceptualGamma = "approx-gamma2",
	SRGB = "srgb",
}

export interface ColorTrackOptions extends TrackOptions {
	dimension?: 3 | 4;
	colorSpace?: ColorSpace;
}

/**
 * 3-channel RGB or 4-channel RGBA color keyframe track.
 */
export class ColorTrack extends Track<ArrayLike<number>, Float32Array> {
	readonly dimension: 3 | 4;
	colorSpace: ColorSpace;

	constructor(
		dimensionOrOptions: 3 | 4 | ColorTrackOptions = 4,
		colorSpace: ColorSpace = ColorSpace.Linear,
		initialCapacity?: number
	) {
		if (typeof dimensionOrOptions === "object" && dimensionOrOptions !== null) {
			super(dimensionOrOptions);
			const dim = dimensionOrOptions.dimension ?? 4;
			if (dim !== 3 && dim !== 4) {
				throw new RangeError(`ColorTrack: dimension must be 3 or 4, got ${dim}.`);
			}
			this.dimension = dim;
			this.colorSpace = dimensionOrOptions.colorSpace ?? ColorSpace.Linear;
		} else {
			super(initialCapacity);
			if (dimensionOrOptions !== 3 && dimensionOrOptions !== 4) {
				throw new RangeError(`ColorTrack: dimension must be 3 or 4, got ${dimensionOrOptions}.`);
			}
			this.dimension = dimensionOrOptions;
			this.colorSpace = colorSpace;
		}
	}

	protected override cloneInput(source: ArrayLike<number>): Float32Array {
		const out = new Float32Array(this.dimension);
		for (let i = 0; i < this.dimension; i++) {
			out[i] = source[i] ?? (i === 3 ? 1 : 0);
		}
		return out;
	}

	override blend(
		v0: ArrayLike<number>,
		v1: ArrayLike<number>,
		alpha: number,
		out?: Float32Array
	): Float32Array {
		const target = out ?? new Float32Array(this.dimension);
		const isGamma2 =
			this.colorSpace === ColorSpace.ApproxGamma2 ||
			this.colorSpace === ColorSpace.SRGB;

		if (isGamma2) {
			for (let i = 0; i < 3; i++) {
				const a0 = v0[i] ?? 0;
				const a1 = v1[i] ?? 0;
				const c0 = a0 >= 0 ? a0 * a0 : -a0 * a0;
				const c1 = a1 >= 0 ? a1 * a1 : -a1 * a1;
				const lerped = c0 + (c1 - c0) * alpha;
				target[i] = lerped >= 0 ? Math.sqrt(lerped) : -Math.sqrt(-lerped);
			}
			if (this.dimension === 4) {
				const w0 = v0[3] ?? 1;
				const w1 = v1[3] ?? 1;
				target[3] = w0 + (w1 - w0) * alpha;
			}
		} else {
			for (let i = 0; i < this.dimension; i++) {
				const a0 = v0[i] ?? (i === 3 ? 1 : 0);
				const a1 = v1[i] ?? (i === 3 ? 1 : 0);
				target[i] = a0 + (a1 - a0) * alpha;
			}
		}
		return target;
	}

	protected override defaultValue(out?: Float32Array): Float32Array {
		const target = out ?? new Float32Array(this.dimension);
		target[0] = 0;
		target[1] = 0;
		target[2] = 0;
		if (this.dimension === 4) {
			target[3] = 1;
		}
		return target;
	}
}
