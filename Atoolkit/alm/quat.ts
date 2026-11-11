import { EPSILON, EPSILON_SQ, type EulerOrder } from "./constants.js";
import { Vec3 } from "./vec3.js";

/**
 * 4-component Hamilton unit quaternion representing 3D orientation.
 * Memory layout: [x, y, z, w] where w is the scalar part.
 */
export class Quat extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen identity quaternion tuple [0, 0, 0, 1]. */
	static readonly IDENTITY: readonly [number, number, number, number] = Object.freeze([0, 0, 0, 1]);

	constructor(x: number | ArrayLike<number> = 0, y = 0, z = 0, w = 1) {
		super(4);
		if (typeof x === "number") {
			this[0] = x;
			this[1] = y;
			this[2] = z;
			this[3] = w;
		} else {
			this[0] = x[0] ?? 0;
			this[1] = x[1] ?? 0;
			this[2] = x[2] ?? 0;
			this[3] = x[3] ?? 1;
		}
	}

	/** Allocates and initializes a new owned Quat instance. */
	static create(x: number | ArrayLike<number> = 0, y = 0, z = 0, w = 1): Quat {
		return new Quat(x, y, z, w);
	}

	get x(): number { return this[0]; }
	set x(v: number) { this[0] = v; }

	get y(): number { return this[1]; }
	set y(v: number) { this[1] = v; }

	get z(): number { return this[2]; }
	set z(v: number) { this[2] = v; }

	get w(): number { return this[3]; }
	set w(v: number) { this[3] = v; }

	/** Sets quaternion components [x, y, z, w] in-place. */
	setComponents(x: number, y: number, z: number, w: number): this {
		this[0] = x;
		this[1] = y;
		this[2] = z;
		this[3] = w;
		return this;
	}

	/** Resets this quaternion to identity [0, 0, 0, 1]. */
	identity(): this {
		this[0] = 0;
		this[1] = 0;
		this[2] = 0;
		this[3] = 1;
		return this;
	}

	/** Copies values from another 4-component array-like object. */
	copy(q: ArrayLike<number>): this {
		this[0] = q[0];
		this[1] = q[1];
		this[2] = q[2];
		this[3] = q[3];
		return this;
	}

	/** Creates a new Quat initialized with this quaternion's components. */
	clone(): Quat {
		return new Quat(this[0], this[1], this[2], this[3]);
	}

	/** Hamilton product (this * b). Applies rotation b in the local frame of this quaternion. */
	mul(b: ArrayLike<number>, out: Quat = this): Quat {
		return Quat.mul(this, b, out);
	}

	/** Rotates this quaternion around the local X-axis by rad radians. */
	rotateX(rad: number, out: Quat = this): Quat {
		return Quat.rotateX(this, rad, out);
	}

	/** Rotates this quaternion around the local Y-axis by rad radians. */
	rotateY(rad: number, out: Quat = this): Quat {
		return Quat.rotateY(this, rad, out);
	}

	/** Rotates this quaternion around the local Z-axis by rad radians. */
	rotateZ(rad: number, out: Quat = this): Quat {
		return Quat.rotateZ(this, rad, out);
	}

	/** Computes the conjugate [-x, -y, -z, w]. */
	conjugate(out: Quat = this): Quat {
		return Quat.conjugate(this, out);
	}

	/** Computes the multiplicative inverse. Returns null and leaves out unchanged if norm is zero. */
	invert(out: Quat = this): Quat | null {
		return Quat.invert(this, out);
	}

	/** Normalizes this quaternion to unit length. Zero quaternions reset to identity [0, 0, 0, 1]. */
	normalize(out: Quat = this): Quat {
		return Quat.normalize(this, out);
	}

	/** Computes dot product with quaternion b. */
	dot(b: ArrayLike<number>): number {
		return Quat.dot(this, b);
	}

	/** Computes Euclidean norm of this quaternion. */
	len(): number {
		return Quat.len(this);
	}

	/** Computes Euclidean norm of this quaternion. */
	magnitude(): number {
		return Quat.len(this);
	}

	/** Computes squared Euclidean norm of this quaternion. */
	lengthSq(): number {
		return Quat.lengthSq(this);
	}

	/** Linearly interpolates between this quaternion and b by factor t. */
	lerp(b: ArrayLike<number>, t: number, out: Quat = this): Quat {
		return Quat.lerp(this, b, t, out);
	}

	/** Spherically interpolates between this unit quaternion and b along the shortest arc. */
	slerp(b: ArrayLike<number>, t: number, out: Quat = this): Quat {
		return Quat.slerp(this, b, t, out);
	}

	/** Extracts unit rotation axis into outAxis and returns angle in radians in [0, 2*PI]. */
	getAxisAngle(outAxis: Vec3 = new Vec3()): number {
		const qw = Math.max(-1.0, Math.min(1.0, this[3]));
		const rad = Math.acos(qw) * 2.0;
		const s = Math.sin(rad * 0.5);
		if (s > EPSILON) {
			outAxis[0] = this[0] / s;
			outAxis[1] = this[1] / s;
			outAxis[2] = this[2] / s;
		} else {
			outAxis[0] = 1;
			outAxis[1] = 0;
			outAxis[2] = 0;
		}
		return rad;
	}

	/** Computes unsigned angular distance in radians between this unit quaternion and b. */
	angleTo(b: ArrayLike<number>): number {
		const d = Math.min(1.0, Math.abs(this.dot(b)));
		return Math.acos(2 * d * d - 1);
	}

	/** Extracts Euler angles (radians) in XYZ order. */
	toEuler(out: Vec3 = new Vec3()): Vec3 {
		const x = this[0], y = this[1], z = this[2], w = this[3];
		const x2 = x * x, y2 = y * y, z2 = z * z, w2 = w * w;

		const sinp = 2.0 * (w * y - z * x);
		if (Math.abs(sinp) >= 0.99999) {
			out[0] = 0;
			out[1] = Math.sign(sinp) * (Math.PI * 0.5);
			out[2] = Math.atan2(2.0 * (x * y + w * z), w2 + x2 - y2 - z2);
		} else {
			out[0] = Math.atan2(2.0 * (y * z + w * x), w2 - x2 - y2 + z2);
			out[1] = Math.asin(sinp);
			out[2] = Math.atan2(2.0 * (x * y + w * z), w2 + x2 - y2 - z2);
		}
		return out;
	}

	/** Checks approximate component-wise equality with b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Quat.equals(this, b, eps);
	}

	/** Checks whether this unit quaternion and b represent the same 3D orientation (q ~= b or q ~= -b). */
	 rotationEquals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Quat.rotationEquals(this, b, eps);
	}

	/** Checks strict component equality with b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Quat.exactEquals(this, b);
	}

	/** Copies components from array starting at offset. */
	fromArray(arr: ArrayLike<number>, offset = 0): this {
		this[0] = arr[offset];
		this[1] = arr[offset + 1];
		this[2] = arr[offset + 2];
		this[3] = arr[offset + 3];
		return this;
	}

	/** Writes components into target array starting at offset. */
	toArray<T extends number[] | Float32Array = number[]>(out: T = [] as unknown as T, offset = 0): T {
		out[offset] = this[0];
		out[offset + 1] = this[1];
		out[offset + 2] = this[2];
		out[offset + 3] = this[3];
		return out;
	}

	override toString(): string {
		return `Quat(${this[0].toFixed(4)}, ${this[1].toFixed(4)}, ${this[2].toFixed(4)}, ${this[3].toFixed(4)})`;
	}

	static identity(out: Quat = new Quat()): Quat {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		out[3] = 1;
		return out;
	}

	static fromAxisAngle(axis: ArrayLike<number>, rad: number, out: Quat = new Quat()): Quat {
		const half = rad * 0.5;
		const s = Math.sin(half);
		const ax = axis[0], ay = axis[1], az = axis[2];
		const lenSq = ax * ax + ay * ay + az * az;
		if (lenSq <= EPSILON_SQ) {
			return Quat.identity(out);
		}
		const invLen = s / Math.sqrt(lenSq);
		out[0] = ax * invLen;
		out[1] = ay * invLen;
		out[2] = az * invLen;
		out[3] = Math.cos(half);
		return out;
	}

	static fromEuler(xRad: number, yRad: number, zRad: number, order: EulerOrder = "XYZ", out: Quat = new Quat()): Quat {
		const c1 = Math.cos(xRad * 0.5);
		const c2 = Math.cos(yRad * 0.5);
		const c3 = Math.cos(zRad * 0.5);
		const s1 = Math.sin(xRad * 0.5);
		const s2 = Math.sin(yRad * 0.5);
		const s3 = Math.sin(zRad * 0.5);

		switch (order) {
			case "XYZ":
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "YXZ":
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case "ZXY":
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "ZYX":
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case "YZX":
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case "XZY":
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
		}
		return out;
	}

	static fromUnitVectors(vFrom: ArrayLike<number>, vTo: ArrayLike<number>, out: Quat = new Quat()): Quat {
		const fx = vFrom[0], fy = vFrom[1], fz = vFrom[2];
		const tx = vTo[0], ty = vTo[1], tz = vTo[2];
		let r = fx * tx + fy * ty + fz * tz + 1.0;
		if (r < EPSILON) {
			r = 0;
			if (Math.abs(fx) > Math.abs(fz)) {
				out[0] = -fy;
				out[1] = fx;
				out[2] = 0;
				out[3] = r;
			} else {
				out[0] = 0;
				out[1] = -fz;
				out[2] = fy;
				out[3] = r;
			}
		} else {
			out[0] = fy * tz - fz * ty;
			out[1] = fz * tx - fx * tz;
			out[2] = fx * ty - fy * tx;
			out[3] = r;
		}
		return Quat.normalize(out, out);
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Quat = new Quat()): Quat {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax * bw + aw * bx + ay * bz - az * by;
		out[1] = ay * bw + aw * by + az * bx - ax * bz;
		out[2] = az * bw + aw * bz + ax * by - ay * bx;
		out[3] = aw * bw - ax * bx - ay * by - az * bz;
		return out;
	}

	static rotateX(a: ArrayLike<number>, rad: number, out: Quat = new Quat()): Quat {
		const half = rad * 0.5;
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = Math.sin(half), bw = Math.cos(half);
		out[0] = ax * bw + aw * bx;
		out[1] = ay * bw + az * bx;
		out[2] = az * bw - ay * bx;
		out[3] = aw * bw - ax * bx;
		return out;
	}

	static rotateY(a: ArrayLike<number>, rad: number, out: Quat = new Quat()): Quat {
		const half = rad * 0.5;
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const by = Math.sin(half), bw = Math.cos(half);
		out[0] = ax * bw - az * by;
		out[1] = ay * bw + aw * by;
		out[2] = az * bw + ax * by;
		out[3] = aw * bw - ay * by;
		return out;
	}

	static rotateZ(a: ArrayLike<number>, rad: number, out: Quat = new Quat()): Quat {
		const half = rad * 0.5;
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bz = Math.sin(half), bw = Math.cos(half);
		out[0] = ax * bw + ay * bz;
		out[1] = ay * bw - ax * bz;
		out[2] = az * bw + aw * bz;
		out[3] = aw * bw - az * bz;
		return out;
	}

	static conjugate(a: ArrayLike<number>, out: Quat = new Quat()): Quat {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = -ax;
		out[1] = -ay;
		out[2] = -az;
		out[3] = aw;
		return out;
	}

	static invert(a: ArrayLike<number>, out: Quat = new Quat()): Quat | null {
		const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
		const dot = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
		if (!Number.isFinite(dot) || dot === 0) {
			return null;
		}
		const invDot = 1.0 / dot;
		if (!Number.isFinite(invDot)) {
			return null;
		}
		out[0] = -a0 * invDot;
		out[1] = -a1 * invDot;
		out[2] = -a2 * invDot;
		out[3] = a3 * invDot;
		return out;
	}

	static dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	}

	static len(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1], a[2], a[3]);
	}

	static magnitude(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1], a[2], a[3]);
	}

	static lengthSq(a: ArrayLike<number>): number {
		return a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3];
	}

	static normalize(a: ArrayLike<number>, out: Quat = new Quat()): Quat {
		const x = a[0], y = a[1], z = a[2], w = a[3];
		const sqLen = x * x + y * y + z * z + w * w;
		if (sqLen > EPSILON_SQ) {
			const invLen = 1.0 / Math.sqrt(sqLen);
			out[0] = x * invLen;
			out[1] = y * invLen;
			out[2] = z * invLen;
			out[3] = w * invLen;
		} else {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			out[3] = 1;
		}
		return out;
	}

	static lerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Quat = new Quat()): Quat {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax + t * (bx - ax);
		out[1] = ay + t * (by - ay);
		out[2] = az + t * (bz - az);
		out[3] = aw + t * (bw - aw);
		return out;
	}

	static slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Quat = new Quat()): Quat {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		let bx = b[0], by = b[1], bz = b[2], bw = b[3];

		let cosom = ax * bx + ay * by + az * bz + aw * bw;
		if (cosom < 0.0) {
			cosom = -cosom;
			bx = -bx;
			by = -by;
			bz = -bz;
			bw = -bw;
		}

		let scale0: number;
		let scale1: number;
		if (1.0 - cosom > EPSILON) {
			const omega = Math.acos(Math.min(1.0, cosom));
			const sinom = Math.sin(omega);
			scale0 = Math.sin((1.0 - t) * omega) / sinom;
			scale1 = Math.sin(t * omega) / sinom;
		} else {
			scale0 = 1.0 - t;
			scale1 = t;
		}

		out[0] = scale0 * ax + scale1 * bx;
		out[1] = scale0 * ay + scale1 * by;
		out[2] = scale0 * az + scale1 * bz;
		out[3] = scale0 * aw + scale1 * bw;
		return Quat.normalize(out, out);
	}

	static sqlerp(
		a: ArrayLike<number>,
		b: ArrayLike<number>,
		c: ArrayLike<number>,
		d: ArrayLike<number>,
		t: number,
		out: Quat = new Quat()
	): Quat {
		Quat.slerp(a, d, t, _sqlerpScratch1);
		Quat.slerp(b, c, t, _sqlerpScratch2);
		return Quat.slerp(_sqlerpScratch1, _sqlerpScratch2, 2 * t * (1 - t), out);
	}

	/**
	 * Extracts a unit quaternion from a column-major 3x3 rotation matrix.
	 * Matrix indexing: col 0 = [0, 1, 2], col 1 = [3, 4, 5], col 2 = [6, 7, 8].
	 */
	static fromMat3(m: ArrayLike<number>, out: Quat = new Quat()): Quat {
		return Quat._fromRotationElements(
			m[0], m[3], m[6],
			m[1], m[4], m[7],
			m[2], m[5], m[8],
			out
		);
	}

	/**
	 * Extracts a unit quaternion from the upper-left 3x3 of a column-major 4x4 rotation matrix.
	 * Assumes the upper-left 3x3 is orthonormal; for scaled matrices use Mat4.getRotation.
	 */
	static fromMat4(m: ArrayLike<number>, out: Quat = new Quat()): Quat {
		return Quat._fromRotationElements(
			m[0], m[4], m[8],
			m[1], m[5], m[9],
			m[2], m[6], m[10],
			out
		);
	}

	/**
	 * Shared Shepperd quaternion extraction kernel from row-indexed rotation elements:
	 * row 0: (m00, m01, m02), row 1: (m10, m11, m12), row 2: (m20, m21, m22).
	 */
	static _fromRotationElements(
		m00: number, m01: number, m02: number,
		m10: number, m11: number, m12: number,
		m20: number, m21: number, m22: number,
		out: Quat
	): Quat {
		const trace = m00 + m11 + m22;
		if (trace > 0) {
			const s = 0.5 / Math.sqrt(trace + 1.0);
			out[0] = (m21 - m12) * s;
			out[1] = (m02 - m20) * s;
			out[2] = (m10 - m01) * s;
			out[3] = 0.25 / s;
		} else if (m00 > m11 && m00 > m22) {
			const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
			out[0] = 0.25 * s;
			out[1] = (m01 + m10) / s;
			out[2] = (m02 + m20) / s;
			out[3] = (m21 - m12) / s;
		} else if (m11 > m22) {
			const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
			out[0] = (m01 + m10) / s;
			out[1] = 0.25 * s;
			out[2] = (m12 + m21) / s;
			out[3] = (m02 - m20) / s;
		} else {
			const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
			out[0] = (m02 + m20) / s;
			out[1] = (m12 + m21) / s;
			out[2] = 0.25 * s;
			out[3] = (m10 - m01) / s;
		}
		return Quat.normalize(out, out);
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		return (
			Math.abs(a[0] - b[0]) <= eps &&
			Math.abs(a[1] - b[1]) <= eps &&
			Math.abs(a[2] - b[2]) <= eps &&
			Math.abs(a[3] - b[3]) <= eps
		);
	}

	static rotationEquals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		const sameSign = (
			Math.abs(a[0] - b[0]) <= eps &&
			Math.abs(a[1] - b[1]) <= eps &&
			Math.abs(a[2] - b[2]) <= eps &&
			Math.abs(a[3] - b[3]) <= eps
		);
		if (sameSign) return true;
		return (
			Math.abs(a[0] + b[0]) <= eps &&
			Math.abs(a[1] + b[1]) <= eps &&
			Math.abs(a[2] + b[2]) <= eps &&
			Math.abs(a[3] + b[3]) <= eps
		);
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
	}
}

const _sqlerpScratch1 = new Quat();
const _sqlerpScratch2 = new Quat();
