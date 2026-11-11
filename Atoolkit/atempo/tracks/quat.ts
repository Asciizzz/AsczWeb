import { Quat } from "../../alm/quat.js";
import { Vec3 } from "../../alm/vec3.js";
import { Track, type TrackOptions } from "../track.js";
import type { Curve } from "../curve.js";

const _normScratch0 = new Quat();
const _normScratch1 = new Quat();
const _axisScratch = new Vec3();

/**
 * 4D unit quaternion keyframe track `[x, y, z, w]`.
 *
 * Normalizes input keyframes on insertion and interpolates via shortest-arc
 * spherical linear interpolation (`Quat.slerp`).
 */
export class QuatTrack extends Track<ArrayLike<number>, Float32Array> {
	constructor(options?: TrackOptions | number) {
		super(options);
	}

	protected override cloneInput(source: ArrayLike<number>): Float32Array {
		Quat.normalize(source, _normScratch0);
		return new Float32Array([
			_normScratch0[0],
			_normScratch0[1],
			_normScratch0[2],
			_normScratch0[3],
		]);
	}

	/**
	 * Converts an axis-angle rotation into a unit quaternion and inserts a keyframe at `time`.
	 */
	addAxisAngleKey<TData = any>(
		time: number,
		axis: ArrayLike<number>,
		rad: number,
		curve?: Curve<TData>,
		curveData?: TData,
		fps?: number
	): this {
		Vec3.normalize(axis, _axisScratch);
		Quat.fromAxisAngle(_axisScratch, rad, _normScratch0);
		return this.addKey(time, _normScratch0, curve, curveData, fps);
	}

	override blend(
		v0: ArrayLike<number>,
		v1: ArrayLike<number>,
		alpha: number,
		out?: Float32Array
	): Float32Array {
		const target = out ?? new Float32Array([0, 0, 0, 1]);
		Quat.normalize(v0, _normScratch0);
		Quat.normalize(v1, _normScratch1);
		Quat.slerp(_normScratch0, _normScratch1, alpha, _normScratch0);
		target[0] = _normScratch0[0];
		target[1] = _normScratch0[1];
		target[2] = _normScratch0[2];
		target[3] = _normScratch0[3];
		return target;
	}

	protected override defaultValue(out?: Float32Array): Float32Array {
		const target = out ?? new Float32Array(4);
		target[0] = 0;
		target[1] = 0;
		target[2] = 0;
		target[3] = 1;
		return target;
	}
}
