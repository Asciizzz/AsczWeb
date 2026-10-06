import { type Curve, type InterpolationContext } from "./curve.js";

export enum Extrapolation {
	Clamp = 0,
	Loop = 1,
	PingPong = 2,
}

export interface Keyframe<T, TCurveData = any> {
	time: number;
	value: T;
	curve?: Curve<TCurveData>;
	curveData?: TCurveData;
	fps?: number;
}

/**
 * Base temporal sequence track.
 * Stores chronological keyframes and evaluates interval interpolation.
 * Subclasses implement blend(a, b, alpha, out) for concrete data types.
 */
export abstract class Track<T, TOut = T> {
	extrapolation: Extrapolation = Extrapolation.Clamp;
	fps?: number;

	protected _times: Float64Array;
	protected _values: T[] = [];
	protected _curves: (Curve<any> | undefined)[] = [];
	protected _curveData: (any | undefined)[] = [];
	protected _fps: (number | undefined)[] = [];
	protected _count = 0;
	protected _capacity: number;
	protected _cachedIndex = 0;

	constructor(initialCapacity = 16) {
		this._capacity = Math.max(4, initialCapacity);
		this._times = new Float64Array(this._capacity);
	}

	get count(): number {
		return this._count;
	}

	get startTime(): number {
		return this._count > 0 ? this._times[0] : 0;
	}

	get endTime(): number {
		return this._count > 0 ? this._times[this._count - 1] : 0;
	}

	get duration(): number {
		if (this._count < 2) return 0;
		return this._times[this._count - 1] - this._times[0];
	}

	/**
	 * Appends or inserts keyframe maintaining ascending chronological order.
	 *
	 * @param time Keyframe timestamp in seconds
	 * @param value Interpolation target value
	 * @param curve Optional shaping curve evaluator
	 * @param curveData Optional parameter bag passed to curve evaluator
	 * @param fps Optional interval simulation frame rate
	 */
	addKey(
		time: number,
		value: T,
		curve?: Curve<any>,
		curveData?: any,
		fps?: number
	): this {
		if (this._count >= this._capacity) {
			this._grow();
		}

		if (this._count === 0 || time >= this._times[this._count - 1]) {
			const idx = this._count;
			this._times[idx] = time;
			this._values.push(value);
			this._curves.push(curve);
			this._curveData.push(curveData);
			this._fps.push(fps);
			this._count++;
			return this;
		}

		let low = 0;
		let high = this._count - 1;
		let insertIdx = this._count;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (this._times[mid] >= time) {
				insertIdx = mid;
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}

		this._times.copyWithin(insertIdx + 1, insertIdx, this._count);
		this._times[insertIdx] = time;
		this._values.splice(insertIdx, 0, value);
		this._curves.splice(insertIdx, 0, curve);
		this._curveData.splice(insertIdx, 0, curveData);
		this._fps.splice(insertIdx, 0, fps);
		this._count++;

		return this;
	}

	/**
	 * Updates curve evaluator, parameter bag, and frame rate on an existing keyframe.
	 *
	 * @param index Target keyframe index
	 * @param curve Optional shaping curve evaluator
	 * @param curveData Optional parameter bag passed to curve evaluator
	 * @param fps Optional interval simulation frame rate
	 */
	setCurve(
		index: number,
		curve?: Curve<any>,
		curveData?: any,
		fps?: number
	): boolean {
		if (index < 0 || index >= this._count) return false;
		this._curves[index] = curve;
		this._curveData[index] = curveData;
		if (fps !== undefined) {
			this._fps[index] = fps;
		}
		return true;
	}

	/**
	 * Removes keyframe at specified index.
	 */
	removeKey(index: number): boolean {
		if (index < 0 || index >= this._count) return false;

		this._times.copyWithin(index, index + 1, this._count);
		this._values.splice(index, 1);
		this._curves.splice(index, 1);
		this._curveData.splice(index, 1);
		this._fps.splice(index, 1);
		this._count--;
		this._cachedIndex = Math.max(0, Math.min(this._cachedIndex, this._count - 2));
		return true;
	}

	/**
	 * Clears all keyframes.
	 */
	clear(): this {
		this._count = 0;
		this._values.length = 0;
		this._curves.length = 0;
		this._curveData.length = 0;
		this._fps.length = 0;
		this._cachedIndex = 0;
		return this;
	}

	/**
	 * Retrieves keyframe at index.
	 */
	getKey(index: number): Keyframe<T> | undefined {
		if (index < 0 || index >= this._count) return undefined;
		return {
			time: this._times[index],
			value: this._values[index],
			curve: this._curves[index],
			curveData: this._curveData[index],
			fps: this._fps[index],
		};
	}

	/**
	 * Samples track value at specified timestamp.
	 * Evaluates active interval span, computes shaped alpha, and invokes blend().
	 *
	 * @param time Sample timestamp
	 * @param out Optional pre-allocated destination buffer
	 */
	sample(time: number, out?: TOut): TOut {
		if (this._count === 0) {
			return this.defaultValue(out);
		}

		if (this._count === 1) {
			return this.blend(this._values[0], this._values[0], 0, out);
		}

		const tStart = this._times[0];
		const tEnd = this._times[this._count - 1];
		const totalDuration = tEnd - tStart;

		let evalTime = time;
		if (totalDuration > 0) {
			if (this.extrapolation === Extrapolation.Loop) {
				const rem = ((evalTime - tStart) % totalDuration + totalDuration) % totalDuration;
				evalTime = tStart + rem;
			} else if (this.extrapolation === Extrapolation.PingPong) {
				const doubleDur = totalDuration * 2;
				const rem = ((evalTime - tStart) % doubleDur + doubleDur) % doubleDur;
				evalTime = rem < totalDuration ? tStart + rem : tEnd - (rem - totalDuration);
			}
		}

		if (evalTime <= tStart) {
			return this.blend(this._values[0], this._values[0], 0, out);
		}
		if (evalTime >= tEnd) {
			const last = this._count - 1;
			return this.blend(this._values[last], this._values[last], 1, out);
		}

		let idx = this._cachedIndex;
		if (idx < this._count - 1 && evalTime >= this._times[idx] && evalTime < this._times[idx + 1]) {
			// Sequential cache hit
		} else {
			let low = 0;
			let high = this._count - 1;
			while (low <= high) {
				const mid = (low + high) >> 1;
				if (this._times[mid] <= evalTime) {
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			idx = Math.max(0, Math.min(this._count - 2, high));
			this._cachedIndex = idx;
		}

		const k0Time = this._times[idx];
		const k1Time = this._times[idx + 1];
		const dt = k1Time - k0Time;
		let tau = dt > 0 ? (evalTime - k0Time) / dt : 0;

		const effectiveFps = this._fps[idx] ?? this.fps;
		if (effectiveFps !== undefined && effectiveFps > 0 && dt > 0) {
			const totalSteps = Math.max(1, Math.round(dt * effectiveFps));
			tau = Math.floor(tau * totalSteps) / totalSteps;
		}

		const curve = this._curves[idx];
		const curveData = this._curveData[idx];
		const alpha = curve ? curve(tau, curveData, { dt, k0Time, k1Time }) : tau;

		return this.blend(this._values[idx], this._values[idx + 1], alpha, out);
	}

	/**
	 * Evaluates track value at normalized progression ratio in [0.0, 1.0].
	 * Maps ratio across track time span: startTime + ratio * duration.
	 *
	 * @param ratio Normalized progression ratio in [0.0, 1.0]
	 * @param out Optional pre-allocated destination buffer
	 */
	sampleRatio(ratio: number, out?: TOut): TOut {
		if (this._count <= 1 || this.duration <= 0) {
			return this.sample(this.startTime, out);
		}
		return this.sample(this.startTime + ratio * this.duration, out);
	}

	/**
	 * Subclasses implement value blending between two keyframes.
	 *
	 * @param a Left keyframe value
	 * @param b Right keyframe value
	 * @param alpha Shaped interval progress
	 * @param out Optional output destination buffer
	 */
	abstract blend(a: T, b: T, alpha: number, out?: TOut): TOut;

	/**
	 * Fallback value when track contains zero keyframes.
	 */
	protected defaultValue(out?: TOut): TOut {
		return out as unknown as TOut;
	}

	private _grow(): void {
		this._capacity *= 2;
		const newTimes = new Float64Array(this._capacity);
		newTimes.set(this._times);
		this._times = newTimes;
	}
}
