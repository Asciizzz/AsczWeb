import { Track } from "../track.js";
import { type Curve } from "../curve.js";

/**
 * 4D Quaternion rotation track.
 * Evaluates spherical linear interpolation (SLERP) with antipodal sign check and renormalization.
 */
export class QuatTrack extends Track<ArrayLike<number>, Float32Array> {
    constructor(initialCapacity = 16) {
        super(initialCapacity);
    }

    blend(a: ArrayLike<number>, b: ArrayLike<number>, alpha: number, out?: Float32Array): Float32Array {
        out ??= new Float32Array(4);

        const ax = a[0], ay = a[1], az = a[2], aw = a[3];
        let bx = b[0], by = b[1], bz = b[2], bw = b[3];

        let dot = ax * bx + ay * by + az * bz + aw * bw;
        if (dot < 0) {
            dot = -dot;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }

        let scale0: number;
        let scale1: number;

        if (dot > 0.9995) {
            scale0 = 1.0 - alpha;
            scale1 = alpha;
        } else {
            const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
            const sinTheta = Math.sin(theta);
            scale0 = Math.sin((1.0 - alpha) * theta) / sinTheta;
            scale1 = Math.sin(alpha * theta) / sinTheta;
        }

        const ox = scale0 * ax + scale1 * bx;
        const oy = scale0 * ay + scale1 * by;
        const oz = scale0 * az + scale1 * bz;
        const ow = scale0 * aw + scale1 * bw;

        const lenSq = ox * ox + oy * oy + oz * oz + ow * ow;
        if (lenSq > 1e-12) {
            const invLen = 1.0 / Math.sqrt(lenSq);
            out[0] = ox * invLen;
            out[1] = oy * invLen;
            out[2] = oz * invLen;
            out[3] = ow * invLen;
        } else {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            out[3] = 1;
        }

        return out;
    }

    protected defaultValue(out?: Float32Array): Float32Array {
        out ??= new Float32Array(4);
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return out;
    }

	/**
	 * Appends keyframe converted from axis and angle in radians.
	 */
	addAxisAngleKey(
		time: number,
		axis: ArrayLike<number>,
		rad: number,
		curve?: Curve<any>,
		curveData?: any,
		fps?: number
	): this {
		const half = rad * 0.5;
		const s = Math.sin(half);
		const q = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
		return this.addKey(time, q, curve, curveData, fps);
	}
}
