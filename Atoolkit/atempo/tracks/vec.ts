import { Track, type TrackOptions } from "../track.js";

/**
 * N-dimensional vector sequence track.
 */
export class VecTrack extends Track<ArrayLike<number>, Float32Array> {
	readonly dimension: number;

	constructor(dimension = 3, options?: TrackOptions | number) {
		super(options);
		if (!Number.isInteger(dimension) || dimension < 1) {
			throw new RangeError(`VecTrack: dimension must be a positive integer, got ${dimension}.`);
		}
		this.dimension = dimension;
	}

	protected override cloneInput(value: ArrayLike<number>): Float32Array {
		const out = new Float32Array(this.dimension);
		for (let i = 0; i < this.dimension; i++) {
			out[i] = value[i] ?? 0;
		}
		return out;
	}

	override blend(
		a: ArrayLike<number>,
		b: ArrayLike<number>,
		alpha: number,
		out?: Float32Array
	): Float32Array {
		const target = out ?? new Float32Array(this.dimension);
		const inv = 1.0 - alpha;
		for (let i = 0; i < this.dimension; i++) {
			const va = a[i] ?? 0;
			const vb = b[i] ?? 0;
			target[i] = va * inv + vb * alpha;
		}
		return target;
	}

	protected override defaultValue(out?: Float32Array): Float32Array {
		const target = out ?? new Float32Array(this.dimension);
		target.fill(0);
		return target;
	}
}

export { VecTrack as VectorTrack };
