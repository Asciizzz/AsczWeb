import { EPSILON, EPSILON_SQ } from "./constants.js";
import { Vec3 } from "./vec3.js";
import { Vec4 } from "./vec4.js";
import { Quat } from "./quat.js";
import type { Mat3 } from "./mat3.js";

/**
 * 4x4 32-bit floating-point matrix stored in column-major order.
 * Indices:
 * [ 0, 4,  8, 12 ]
 * [ 1, 5,  9, 13 ]
 * [ 2, 6, 10, 14 ]
 * [ 3, 7, 11, 15 ]
 *
 * Conventions:
 * - Column-major layout matching WebGPU/WGSL mat4x4<f32>.
 * - Column-vector post-multiplication: M * v transforms column vector v; A.mul(B) computes A * B.
 * - Right-handed coordinate system (+X right, +Y up, -Z forward).
 * - Angles are in radians.
 */
export class Mat4 extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen identity 4x4 matrix tuple in column-major order. */
	static readonly IDENTITY: readonly [
		number, number, number, number,
		number, number, number, number,
		number, number, number, number,
		number, number, number, number,
	] = Object.freeze([
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	]);

	/** Frozen zero 4x4 matrix tuple. */
	static readonly ZERO: readonly [
		number, number, number, number,
		number, number, number, number,
		number, number, number, number,
		number, number, number, number,
	] = Object.freeze([
		0, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0,
	]);

	constructor(values?: ArrayLike<number>) {
		super(16);
		if (values) {
			for (let i = 0; i < 16; i++) {
				this[i] = values[i] ?? 0;
			}
		} else {
			this[0] = 1;
			this[5] = 1;
			this[10] = 1;
			this[15] = 1;
		}
	}

	/** Allocates and initializes a new owned Mat4 instance. */
	static create(values?: ArrayLike<number>): Mat4 {
		return new Mat4(values);
	}

	/** Sets all 16 elements in column-major order (c0r0..c0r3, c1r0..c1r3, c2r0..c2r3, c3r0..c3r3). */
	setElements(
		m00: number, m01: number, m02: number, m03: number,
		m10: number, m11: number, m12: number, m13: number,
		m20: number, m21: number, m22: number, m23: number,
		m30: number, m31: number, m32: number, m33: number
	): this {
		this[0] = m00;  this[1] = m01;  this[2] = m02;  this[3] = m03;
		this[4] = m10;  this[5] = m11;  this[6] = m12;  this[7] = m13;
		this[8] = m20;  this[9] = m21;  this[10] = m22; this[11] = m23;
		this[12] = m30; this[13] = m31; this[14] = m32; this[15] = m33;
		return this;
	}

	/** Resets this matrix to the 4x4 identity matrix. */
	identity(): this {
		return Mat4.identity(this) as this;
	}

	/** Resets all elements to zero. */
	zero(): this {
		this.fill(0);
		return this;
	}

	/** Copies values from another 16-element array-like object. */
	copy(m: ArrayLike<number>): this {
		for (let i = 0; i < 16; i++) {
			this[i] = m[i];
		}
		return this;
	}

	/** Creates a new Mat4 initialized with this matrix's elements. */
	clone(): Mat4 {
		return new Mat4(this);
	}

	/** Extracts column index (0, 1, 2, or 3) into out. */
	getColumn(index: 0 | 1 | 2 | 3, out: Vec4 = new Vec4()): Vec4 {
		const offset = index * 4;
		out[0] = this[offset];
		out[1] = this[offset + 1];
		out[2] = this[offset + 2];
		out[3] = this[offset + 3];
		return out;
	}

	/** Sets column index (0, 1, 2, or 3) from v. */
	setColumn(index: 0 | 1 | 2 | 3, v: ArrayLike<number>): this {
		const offset = index * 4;
		this[offset] = v[0];
		this[offset + 1] = v[1];
		this[offset + 2] = v[2];
		this[offset + 3] = v[3];
		return this;
	}

	/** Multiplies this matrix by b (out = this * b). */
	mul(b: ArrayLike<number>, out: Mat4 = this): Mat4 {
		return Mat4.mul(this, b, out);
	}

	/** Pre-multiplies this matrix by a (out = a * this). */
	premultiply(a: ArrayLike<number>, out: Mat4 = this): Mat4 {
		return Mat4.mul(a, this, out);
	}

	/** Transposes this matrix into out. Supports out === this. */
	transpose(out: Mat4 = this): Mat4 {
		return Mat4.transpose(this, out);
	}

	/** Computes the determinant of this matrix. */
	determinant(): number {
		return Mat4.determinant(this);
	}

	/**
	 * Inverts this matrix into out.
	 * Returns null and leaves out unchanged if the matrix is singular (|det| <= minAbsDet).
	 */
	invert(out: Mat4 = this, minAbsDet = 0): Mat4 | null {
		return Mat4.invert(this, out, minAbsDet);
	}

	/**
	 * Computes the 4x4 normal matrix (inverse-transpose of upper-left 3x3 embedded with identity 4th row/column).
	 * Returns null and leaves out unchanged if the upper-left 3x3 block is singular.
	 */
	normalMatrix(out: Mat4 = this, minAbsDet = 0): Mat4 | null {
		return Mat4.normalMatrix(this, out, minAbsDet);
	}

	/** Post-multiplies this matrix by a translation v (out = this * T(v)). */
	translate(v: ArrayLike<number>, out: Mat4 = this): Mat4 {
		return Mat4.translate(this, v, out);
	}

	/** Post-multiplies this matrix by a scale v (out = this * S(v)). */
	scale(v: ArrayLike<number>, out: Mat4 = this): Mat4 {
		return Mat4.scale(this, v, out);
	}

	/** Post-multiplies this matrix by a uniform scalar scale s. */
	scaleUniform(s: number, out: Mat4 = this): Mat4 {
		return Mat4.scale(this, [s, s, s], out);
	}

	/** Post-multiplies this matrix by an X-axis rotation of rad radians. */
	rotateX(rad: number, out: Mat4 = this): Mat4 {
		return Mat4.rotateX(this, rad, out);
	}

	/** Post-multiplies this matrix by a Y-axis rotation of rad radians. */
	rotateY(rad: number, out: Mat4 = this): Mat4 {
		return Mat4.rotateY(this, rad, out);
	}

	/** Post-multiplies this matrix by a Z-axis rotation of rad radians. */
	rotateZ(rad: number, out: Mat4 = this): Mat4 {
		return Mat4.rotateZ(this, rad, out);
	}

	/** Post-multiplies this matrix by a rotation around axis by rad radians. */
	rotateAxis(axis: ArrayLike<number>, rad: number, out: Mat4 = this): Mat4 | null {
		return Mat4.rotateAxis(this, axis, rad, out);
	}

	/** Post-multiplies this matrix by unit quaternion rotation q. */
	rotateQ(q: ArrayLike<number>, out: Mat4 = this): Mat4 {
		return Mat4.rotateQ(this, q, out);
	}

	/** Extracts translation column [m12, m13, m14] into out. */
	getTranslation(out: Vec3 = new Vec3()): Vec3 {
		return Mat4.getTranslation(this, out);
	}

	/** Extracts non-negative column scale factors into out. */
	getScaling(out: Vec3 = new Vec3()): Vec3 {
		return Mat4.getScaling(this, out);
	}

	/** Extracts unit rotation quaternion after removing scale (accounting for negative determinant). */
	getRotation(out: Quat = new Quat()): Quat {
		return Mat4.getRotation(this, out);
	}

	/** Decomposes this affine TRS matrix into translation, rotation, and scale. */
	decompose(
		outTranslation: Vec3 = new Vec3(),
		outRotation: Quat = new Quat(),
		outScale: Vec3 = new Vec3()
	): boolean {
		return Mat4.decompose(this, outTranslation, outRotation, outScale);
	}

	/** Checks approximate element-wise equality with b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Mat4.equals(this, b, eps);
	}

	/** Checks strict element-wise equality with b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Mat4.exactEquals(this, b);
	}

	/** Copies 16 elements from arr starting at offset. */
	fromArray(arr: ArrayLike<number>, offset = 0): this {
		for (let i = 0; i < 16; i++) {
			this[i] = arr[offset + i];
		}
		return this;
	}

	/** Writes 16 elements into out starting at offset. */
	toArray<T extends number[] | Float32Array = number[]>(out: T = [] as unknown as T, offset = 0): T {
		for (let i = 0; i < 16; i++) {
			out[offset + i] = this[i];
		}
		return out;
	}

	override toString(): string {
		return (
			`Mat4(\n` +
			`  [${this[0].toFixed(4)}, ${this[4].toFixed(4)}, ${this[8].toFixed(4)}, ${this[12].toFixed(4)}],\n` +
			`  [${this[1].toFixed(4)}, ${this[5].toFixed(4)}, ${this[9].toFixed(4)}, ${this[13].toFixed(4)}],\n` +
			`  [${this[2].toFixed(4)}, ${this[6].toFixed(4)}, ${this[10].toFixed(4)}, ${this[14].toFixed(4)}],\n` +
			`  [${this[3].toFixed(4)}, ${this[7].toFixed(4)}, ${this[11].toFixed(4)}, ${this[15].toFixed(4)}]\n)`
		);
	}

	static identity(out: Mat4 = new Mat4()): Mat4 {
		out[0] = 1;  out[1] = 0;  out[2] = 0;  out[3] = 0;
		out[4] = 0;  out[5] = 1;  out[6] = 0;  out[7] = 0;
		out[8] = 0;  out[9] = 0;  out[10] = 1; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	static fromTranslation(v: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const x = v[0], y = v[1], z = v[2];
		out[0] = 1;  out[1] = 0;  out[2] = 0;  out[3] = 0;
		out[4] = 0;  out[5] = 1;  out[6] = 0;  out[7] = 0;
		out[8] = 0;  out[9] = 0;  out[10] = 1; out[11] = 0;
		out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
		return out;
	}

	static fromScaling(v: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const x = v[0], y = v[1], z = v[2];
		out[0] = x;  out[1] = 0;  out[2] = 0;  out[3] = 0;
		out[4] = 0;  out[5] = y;  out[6] = 0;  out[7] = 0;
		out[8] = 0;  out[9] = 0;  out[10] = z; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	static fromRotationX(rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		out[0] = 1;  out[1] = 0;  out[2] = 0;  out[3] = 0;
		out[4] = 0;  out[5] = c;  out[6] = s;  out[7] = 0;
		out[8] = 0;  out[9] = -s; out[10] = c; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	static fromRotationY(rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		out[0] = c;  out[1] = 0;  out[2] = -s; out[3] = 0;
		out[4] = 0;  out[5] = 1;  out[6] = 0;  out[7] = 0;
		out[8] = s;  out[9] = 0;  out[10] = c; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	static fromRotationZ(rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		out[0] = c;  out[1] = s;  out[2] = 0;  out[3] = 0;
		out[4] = -s; out[5] = c;  out[6] = 0;  out[7] = 0;
		out[8] = 0;  out[9] = 0;  out[10] = 1; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	static fromRotationAxis(axis: ArrayLike<number>, rad: number, out: Mat4 = new Mat4()): Mat4 | null {
		let x = axis[0], y = axis[1], z = axis[2];
		const lenSq = x * x + y * y + z * z;
		if (lenSq < EPSILON_SQ) return null;
		const invLen = 1.0 / Math.sqrt(lenSq);
		x *= invLen;
		y *= invLen;
		z *= invLen;

		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const t = 1 - c;

		out[0] = x * x * t + c;
		out[1] = y * x * t + z * s;
		out[2] = z * x * t - y * s;
		out[3] = 0;

		out[4] = x * y * t - z * s;
		out[5] = y * y * t + c;
		out[6] = z * y * t + x * s;
		out[7] = 0;

		out[8] = x * z * t + y * s;
		out[9] = y * z * t - x * s;
		out[10] = z * z * t + c;
		out[11] = 0;

		out[12] = 0;
		out[13] = 0;
		out[14] = 0;
		out[15] = 1;
		return out;
	}

	static fromQuat(q: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const x = q[0], y = q[1], z = q[2], w = q[3];
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, yx = y * x2, yy = y * y2;
		const zx = z * x2, zy = z * y2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;

		out[0] = 1 - yy - zz;
		out[1] = yx + wz;
		out[2] = zx - wy;
		out[3] = 0;

		out[4] = yx - wz;
		out[5] = 1 - xx - zz;
		out[6] = zy + wx;
		out[7] = 0;

		out[8] = zx + wy;
		out[9] = zy - wx;
		out[10] = 1 - xx - yy;
		out[11] = 0;

		out[12] = 0;
		out[13] = 0;
		out[14] = 0;
		out[15] = 1;
		return out;
	}

	static fromMat3(m: Mat3 | ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const m0 = m[0], m1 = m[1], m2 = m[2];
		const m3 = m[3], m4 = m[4], m5 = m[5];
		const m6 = m[6], m7 = m[7], m8 = m[8];
		out[0] = m0; out[1] = m1; out[2] = m2; out[3] = 0;
		out[4] = m3; out[5] = m4; out[6] = m5; out[7] = 0;
		out[8] = m6; out[9] = m7; out[10] = m8; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	}

	/**
	 * Composes a 4x4 affine transformation matrix from Translation, Rotation (Quat), and Scale: T * R * S.
	 */
	static fromTRS(
		translation: ArrayLike<number>,
		rotation: ArrayLike<number>,
		scale: ArrayLike<number>,
		out: Mat4 = new Mat4()
	): Mat4 {
		const x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3];
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2;
		const yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;

		const sx = scale[0], sy = scale[1], sz = scale[2];
		const tx = translation[0], ty = translation[1], tz = translation[2];

		out[0] = (1 - (yy + zz)) * sx;
		out[1] = (xy + wz) * sx;
		out[2] = (xz - wy) * sx;
		out[3] = 0;

		out[4] = (xy - wz) * sy;
		out[5] = (1 - (xx + zz)) * sy;
		out[6] = (yz + wx) * sy;
		out[7] = 0;

		out[8] = (xz + wy) * sz;
		out[9] = (yz - wx) * sz;
		out[10] = (1 - (xx + yy)) * sz;
		out[11] = 0;

		out[12] = tx;
		out[13] = ty;
		out[14] = tz;
		out[15] = 1;
		return out;
	}

	static fromRotationTranslationScaleOrigin(
		q: ArrayLike<number>,
		v: ArrayLike<number>,
		s: ArrayLike<number>,
		origin: ArrayLike<number>,
		out: Mat4 = new Mat4()
	): Mat4 {
		const x = q[0], y = q[1], z = q[2], w = q[3];
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2;
		const yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;

		const sx = s[0], sy = s[1], sz = s[2];
		const ox = origin[0], oy = origin[1], oz = origin[2];
		const vx = v[0], vy = v[1], vz = v[2];

		const r0 = (1 - (yy + zz)) * sx;
		const r1 = (xy + wz) * sx;
		const r2 = (xz - wy) * sx;

		const r4 = (xy - wz) * sy;
		const r5 = (1 - (xx + zz)) * sy;
		const r6 = (yz + wx) * sy;

		const r8 = (xz + wy) * sz;
		const r9 = (yz - wx) * sz;
		const r10 = (1 - (xx + yy)) * sz;

		out[0] = r0; out[1] = r1; out[2] = r2; out[3] = 0;
		out[4] = r4; out[5] = r5; out[6] = r6; out[7] = 0;
		out[8] = r8; out[9] = r9; out[10] = r10; out[11] = 0;

		out[12] = vx + ox - (r0 * ox + r4 * oy + r8 * oz);
		out[13] = vy + oy - (r1 * ox + r5 * oy + r9 * oz);
		out[14] = vz + oz - (r2 * ox + r6 * oy + r10 * oz);
		out[15] = 1;
		return out;
	}

	static decompose(
		m: ArrayLike<number>,
		outTranslation: Vec3 = new Vec3(),
		outRotation: Quat = new Quat(),
		outScale: Vec3 = new Vec3()
	): boolean {
		const m0 = m[0], m1 = m[1], m2 = m[2];
		const m4 = m[4], m5 = m[5], m6 = m[6];
		const m8 = m[8], m9 = m[9], m10 = m[10];
		const m12 = m[12], m13 = m[13], m14 = m[14];

		outTranslation[0] = m12;
		outTranslation[1] = m13;
		outTranslation[2] = m14;

		let sx = Math.hypot(m0, m1, m2);
		const sy = Math.hypot(m4, m5, m6);
		const sz = Math.hypot(m8, m9, m10);

		const det = Mat4.determinant(m);
		if (det < 0) sx = -sx;

		outScale[0] = sx;
		outScale[1] = sy;
		outScale[2] = sz;

		if (Math.abs(sx) < EPSILON || sy < EPSILON || sz < EPSILON) {
			Quat.identity(outRotation);
			return false;
		}

		const isx = 1.0 / sx;
		const isy = 1.0 / sy;
		const isz = 1.0 / sz;

		Quat._fromRotationElements(
			m0 * isx, m4 * isy, m8 * isz,
			m1 * isx, m5 * isy, m9 * isz,
			m2 * isx, m6 * isy, m10 * isz,
			outRotation
		);
		return true;
	}

	/**
	 * Right-handed perspective projection matrix with [0, 1] depth range (near -> 0, far -> 1).
	 * Pass far = Infinity for an infinite far plane.
	 */
	static perspective(
		fovYRad: number,
		aspect: number,
		near: number,
		far = Infinity,
		out: Mat4 = new Mat4()
	): Mat4 {
		return Mat4.perspectiveZO(fovYRad, aspect, near, far, out);
	}

	/**
	 * Right-handed perspective projection matrix with [0, 1] depth range (near -> 0, far -> 1).
	 * Pass far = Infinity for an infinite far plane.
	 */
	static perspectiveZO(
		fovYRad: number,
		aspect: number,
		near: number,
		far = Infinity,
		out: Mat4 = new Mat4()
	): Mat4 {
		const f = 1.0 / Math.tan(fovYRad * 0.5);
		out[0] = f / aspect;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = f;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[11] = -1;

		out[12] = 0;
		out[13] = 0;
		out[15] = 0;

		if (far !== null && far !== Infinity && Number.isFinite(far)) {
			const nf = 1.0 / (near - far);
			out[10] = far * nf;
			out[14] = far * near * nf;
		} else {
			out[10] = -1;
			out[14] = -near;
		}
		return out;
	}

	/**
	 * Right-handed perspective projection matrix with reversed-Z [1, 0] depth range (near -> 1, far -> 0).
	 * Pass far = Infinity for an infinite far plane.
	 */
	static perspectiveReversedZ(
		fovYRad: number,
		aspect: number,
		near: number,
		far = Infinity,
		out: Mat4 = new Mat4()
	): Mat4 {
		const f = 1.0 / Math.tan(fovYRad * 0.5);
		out[0] = f / aspect;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = f;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[11] = -1;

		out[12] = 0;
		out[13] = 0;
		out[15] = 0;

		if (far !== null && far !== Infinity && Number.isFinite(far)) {
			const rangeInv = 1.0 / (far - near);
			out[10] = near * rangeInv;
			out[14] = far * near * rangeInv;
		} else {
			out[10] = 0;
			out[14] = near;
		}
		return out;
	}

	/**
	 * Right-handed perspective projection matrix with [-1, 1] depth range (near -> -1, far -> 1).
	 */
	static perspectiveNO(
		fovYRad: number,
		aspect: number,
		near: number,
		far = Infinity,
		out: Mat4 = new Mat4()
	): Mat4 {
		const f = 1.0 / Math.tan(fovYRad * 0.5);
		out[0] = f / aspect;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = f;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[11] = -1;

		out[12] = 0;
		out[13] = 0;
		out[15] = 0;

		if (far !== null && far !== Infinity && Number.isFinite(far)) {
			const nf = 1.0 / (near - far);
			out[10] = (far + near) * nf;
			out[14] = 2 * far * near * nf;
		} else {
			out[10] = -1;
			out[14] = -2 * near;
		}
		return out;
	}

	/**
	 * Right-handed orthographic projection matrix with [0, 1] depth range (near -> 0, far -> 1).
	 */
	static ortho(
		left: number,
		right: number,
		bottom: number,
		top: number,
		near: number,
		far: number,
		out: Mat4 = new Mat4()
	): Mat4 {
		return Mat4.orthoZO(left, right, bottom, top, near, far, out);
	}

	/**
	 * Right-handed orthographic projection matrix with [0, 1] depth range (near -> 0, far -> 1).
	 */
	static orthoZO(
		left: number,
		right: number,
		bottom: number,
		top: number,
		near: number,
		far: number,
		out: Mat4 = new Mat4()
	): Mat4 {
		const lr = 1.0 / (left - right);
		const bt = 1.0 / (bottom - top);
		const nf = 1.0 / (near - far);

		out[0] = -2 * lr;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = -2 * bt;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[10] = nf;
		out[11] = 0;

		out[12] = (left + right) * lr;
		out[13] = (top + bottom) * bt;
		out[14] = near * nf;
		out[15] = 1;
		return out;
	}

	/**
	 * Right-handed orthographic projection matrix with reversed-Z [1, 0] depth range (near -> 1, far -> 0).
	 */
	static orthoReversedZ(
		left: number,
		right: number,
		bottom: number,
		top: number,
		near: number,
		far: number,
		out: Mat4 = new Mat4()
	): Mat4 {
		const lr = 1.0 / (left - right);
		const bt = 1.0 / (bottom - top);
		const rangeInv = 1.0 / (far - near);

		out[0] = -2 * lr;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = -2 * bt;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[10] = rangeInv;
		out[11] = 0;

		out[12] = (left + right) * lr;
		out[13] = (top + bottom) * bt;
		out[14] = far * rangeInv;
		out[15] = 1;
		return out;
	}

	/**
	 * Right-handed orthographic projection matrix with [-1, 1] depth range (near -> -1, far -> 1).
	 */
	static orthoNO(
		left: number,
		right: number,
		bottom: number,
		top: number,
		near: number,
		far: number,
		out: Mat4 = new Mat4()
	): Mat4 {
		const lr = 1.0 / (left - right);
		const bt = 1.0 / (bottom - top);
		const nf = 1.0 / (near - far);

		out[0] = -2 * lr;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;

		out[4] = 0;
		out[5] = -2 * bt;
		out[6] = 0;
		out[7] = 0;

		out[8] = 0;
		out[9] = 0;
		out[10] = 2 * nf;
		out[11] = 0;

		out[12] = (left + right) * lr;
		out[13] = (top + bottom) * bt;
		out[14] = (far + near) * nf;
		out[15] = 1;
		return out;
	}

	/**
	 * Right-handed view matrix looking from eye toward target with up vector.
	 */
	static lookAt(
		eye: ArrayLike<number>,
		target: ArrayLike<number>,
		up: ArrayLike<number> = Vec3.UP,
		out: Mat4 = new Mat4()
	): Mat4 {
		const eyex = eye[0], eyey = eye[1], eyez = eye[2];
		const upx = up[0], upy = up[1], upz = up[2];
		const centerx = target[0], centery = target[1], centerz = target[2];

		let z0 = eyex - centerx;
		let z1 = eyey - centery;
		let z2 = eyez - centerz;
		let len = z0 * z0 + z1 * z1 + z2 * z2;
		if (len > EPSILON_SQ) {
			len = 1.0 / Math.sqrt(len);
			z0 *= len;
			z1 *= len;
			z2 *= len;
		} else {
			return Mat4.identity(out);
		}

		let x0 = upy * z2 - upz * z1;
		let x1 = upz * z0 - upx * z2;
		let x2 = upx * z1 - upy * z0;
		len = x0 * x0 + x1 * x1 + x2 * x2;
		if (len > EPSILON_SQ) {
			len = 1.0 / Math.sqrt(len);
			x0 *= len;
			x1 *= len;
			x2 *= len;
		} else {
			x0 = 0;
			x1 = 0;
			x2 = 0;
		}

		let y0 = z1 * x2 - z2 * x1;
		let y1 = z2 * x0 - z0 * x2;
		let y2 = z0 * x1 - z1 * x0;
		len = y0 * y0 + y1 * y1 + y2 * y2;
		if (len > EPSILON_SQ) {
			len = 1.0 / Math.sqrt(len);
			y0 *= len;
			y1 *= len;
			y2 *= len;
		} else {
			y0 = 0;
			y1 = 0;
			y2 = 0;
		}

		out[0] = x0;
		out[1] = y0;
		out[2] = z0;
		out[3] = 0;

		out[4] = x1;
		out[5] = y1;
		out[6] = z1;
		out[7] = 0;

		out[8] = x2;
		out[9] = y2;
		out[10] = z2;
		out[11] = 0;

		out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
		out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
		out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
		out[15] = 1;
		return out;
	}

	/**
	 * World-space transform matrix placing an object at eye oriented toward target.
	 */
	static targetTo(
		eye: ArrayLike<number>,
		target: ArrayLike<number>,
		up: ArrayLike<number> = Vec3.UP,
		out: Mat4 = new Mat4()
	): Mat4 {
		const eyex = eye[0], eyey = eye[1], eyez = eye[2];
		const upx = up[0], upy = up[1], upz = up[2];

		let z0 = eyex - target[0];
		let z1 = eyey - target[1];
		let z2 = eyez - target[2];
		let len = z0 * z0 + z1 * z1 + z2 * z2;
		if (len > EPSILON_SQ) {
			len = 1.0 / Math.sqrt(len);
			z0 *= len;
			z1 *= len;
			z2 *= len;
		}

		let x0 = upy * z2 - upz * z1;
		let x1 = upz * z0 - upx * z2;
		let x2 = upx * z1 - upy * z0;
		len = x0 * x0 + x1 * x1 + x2 * x2;
		if (len > EPSILON_SQ) {
			len = 1.0 / Math.sqrt(len);
			x0 *= len;
			x1 *= len;
			x2 *= len;
		} else {
			x0 = 0;
			x1 = 0;
			x2 = 0;
		}

		out[0] = x0;
		out[1] = x1;
		out[2] = x2;
		out[3] = 0;

		out[4] = z1 * x2 - z2 * x1;
		out[5] = z2 * x0 - z0 * x2;
		out[6] = z0 * x1 - z1 * x0;
		out[7] = 0;

		out[8] = z0;
		out[9] = z1;
		out[10] = z2;
		out[11] = 0;

		out[12] = eyex;
		out[13] = eyey;
		out[14] = eyez;
		out[15] = 1;
		return out;
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
		const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
		const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
		const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

		out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
		out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
		out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
		out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;

		out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
		out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
		out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
		out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;

		out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
		out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
		out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
		out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;

		out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
		out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
		out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
		out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
		return out;
	}

	static transpose(a: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[0] = a00; out[1] = a10; out[2] = a20; out[3] = a30;
		out[4] = a01; out[5] = a11; out[6] = a21; out[7] = a31;
		out[8] = a02; out[9] = a12; out[10] = a22; out[11] = a32;
		out[12] = a03; out[13] = a13; out[14] = a23; out[15] = a33;
		return out;
	}

	static determinant(a: ArrayLike<number>): number {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		const b00 = a00 * a11 - a01 * a10;
		const b01 = a00 * a12 - a02 * a10;
		const b02 = a00 * a13 - a03 * a10;
		const b03 = a01 * a12 - a02 * a11;
		const b04 = a01 * a13 - a03 * a11;
		const b05 = a02 * a13 - a03 * a12;
		const b06 = a20 * a31 - a21 * a30;
		const b07 = a20 * a32 - a22 * a30;
		const b08 = a20 * a33 - a23 * a30;
		const b09 = a21 * a32 - a22 * a31;
		const b10 = a21 * a33 - a23 * a31;
		const b11 = a22 * a33 - a23 * a32;

		return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	}

	static invert(a: ArrayLike<number>, out: Mat4 = new Mat4(), minAbsDet = 0): Mat4 | null {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		const b00 = a00 * a11 - a01 * a10;
		const b01 = a00 * a12 - a02 * a10;
		const b02 = a00 * a13 - a03 * a10;
		const b03 = a01 * a12 - a02 * a11;
		const b04 = a01 * a13 - a03 * a11;
		const b05 = a02 * a13 - a03 * a12;
		const b06 = a20 * a31 - a21 * a30;
		const b07 = a20 * a32 - a22 * a30;
		const b08 = a20 * a33 - a23 * a30;
		const b09 = a21 * a32 - a22 * a31;
		const b10 = a21 * a33 - a23 * a31;
		const b11 = a22 * a33 - a23 * a32;

		const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
		if (!Number.isFinite(det) || Math.abs(det) <= minAbsDet) {
			return null;
		}
		const invDet = 1.0 / det;
		if (!Number.isFinite(invDet)) {
			return null;
		}

		out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
		out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * invDet;
		out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
		out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * invDet;
		out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * invDet;
		out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
		out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * invDet;
		out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
		out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
		out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * invDet;
		out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
		out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet;
		out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet;
		out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
		out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet;
		out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
		return out;
	}

	/**
	 * Computes the 4x4 normal matrix: the inverse-transpose of the upper-left 3x3 block of a,
	 * embedded in a 4x4 matrix with zero translation/perspective and 1 at element 15.
	 * Returns null and leaves out unchanged if the upper-left 3x3 is singular (|det| <= minAbsDet).
	 */
	static normalMatrix(a: ArrayLike<number>, out: Mat4 = new Mat4(), minAbsDet = 0): Mat4 | null {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[4], a11 = a[5], a12 = a[6];
		const a20 = a[8], a21 = a[9], a22 = a[10];

		const b01 = a22 * a11 - a12 * a21;
		const b11 = -a22 * a10 + a12 * a20;
		const b21 = a21 * a10 - a11 * a20;

		const det = a00 * b01 + a01 * b11 + a02 * b21;
		if (!Number.isFinite(det) || Math.abs(det) <= minAbsDet) {
			return null;
		}
		const invDet = 1.0 / det;
		if (!Number.isFinite(invDet)) {
			return null;
		}

		// Inverse-transpose places column-0 cofactors into column 0, etc.
		out[0] = b01 * invDet;
		out[1] = b11 * invDet;
		out[2] = b21 * invDet;
		out[3] = 0;

		out[4] = (-a22 * a01 + a02 * a21) * invDet;
		out[5] = (a22 * a00 - a02 * a20) * invDet;
		out[6] = (-a21 * a00 + a01 * a20) * invDet;
		out[7] = 0;

		out[8] = (a12 * a01 - a02 * a11) * invDet;
		out[9] = (-a12 * a00 + a02 * a10) * invDet;
		out[10] = (a11 * a00 - a01 * a10) * invDet;
		out[11] = 0;

		out[12] = 0;
		out[13] = 0;
		out[14] = 0;
		out[15] = 1;
		return out;
	}

	static getTranslation(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		out[0] = a[12];
		out[1] = a[13];
		out[2] = a[14];
		return out;
	}

	static getScaling(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		out[0] = Math.hypot(a[0], a[1], a[2]);
		out[1] = Math.hypot(a[4], a[5], a[6]);
		out[2] = Math.hypot(a[8], a[9], a[10]);
		return out;
	}

	static getRotation(a: ArrayLike<number>, out: Quat = new Quat()): Quat {
		const m0 = a[0], m1 = a[1], m2 = a[2];
		const m4 = a[4], m5 = a[5], m6 = a[6];
		const m8 = a[8], m9 = a[9], m10 = a[10];

		let sx = Math.hypot(m0, m1, m2);
		const sy = Math.hypot(m4, m5, m6);
		const sz = Math.hypot(m8, m9, m10);

		if (Mat4.determinant(a) < 0) sx = -sx;

		if (Math.abs(sx) < EPSILON || sy < EPSILON || sz < EPSILON) {
			return Quat.identity(out);
		}

		const isx = 1.0 / sx;
		const isy = 1.0 / sy;
		const isz = 1.0 / sz;

		return Quat._fromRotationElements(
			m0 * isx, m4 * isy, m8 * isz,
			m1 * isx, m5 * isy, m9 * isz,
			m2 * isx, m6 * isy, m10 * isz,
			out
		);
	}

	static translate(a: ArrayLike<number>, v: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const x = v[0], y = v[1], z = v[2];
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
		out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
		out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;

		out[12] = a00 * x + a10 * y + a20 * z + a30;
		out[13] = a01 * x + a11 * y + a21 * z + a31;
		out[14] = a02 * x + a12 * y + a22 * z + a32;
		out[15] = a03 * x + a13 * y + a23 * z + a33;
		return out;
	}

	static scale(a: ArrayLike<number>, v: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		const x = v[0], y = v[1], z = v[2];
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[0] = a00 * x; out[1] = a01 * x; out[2] = a02 * x; out[3] = a03 * x;
		out[4] = a10 * y; out[5] = a11 * y; out[6] = a12 * y; out[7] = a13 * y;
		out[8] = a20 * z; out[9] = a21 * z; out[10] = a22 * z; out[11] = a23 * z;
		out[12] = a30;    out[13] = a31;    out[14] = a32;    out[15] = a33;
		return out;
	}

	static rotateX(a: ArrayLike<number>, rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
		out[12] = a30; out[13] = a31; out[14] = a32; out[15] = a33;

		out[4] = a10 * c + a20 * s;
		out[5] = a11 * c + a21 * s;
		out[6] = a12 * c + a22 * s;
		out[7] = a13 * c + a23 * s;

		out[8] = a20 * c - a10 * s;
		out[9] = a21 * c - a11 * s;
		out[10] = a22 * c - a12 * s;
		out[11] = a23 * c - a13 * s;
		return out;
	}

	static rotateY(a: ArrayLike<number>, rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
		out[12] = a30; out[13] = a31; out[14] = a32; out[15] = a33;

		out[0] = a00 * c - a20 * s;
		out[1] = a01 * c - a21 * s;
		out[2] = a02 * c - a22 * s;
		out[3] = a03 * c - a23 * s;

		out[8] = a00 * s + a20 * c;
		out[9] = a01 * s + a21 * c;
		out[10] = a02 * s + a22 * c;
		out[11] = a03 * s + a23 * c;
		return out;
	}

	static rotateZ(a: ArrayLike<number>, rad: number, out: Mat4 = new Mat4()): Mat4 {
		const s = Math.sin(rad), c = Math.cos(rad);
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;
		out[12] = a30; out[13] = a31; out[14] = a32; out[15] = a33;

		out[0] = a00 * c + a10 * s;
		out[1] = a01 * c + a11 * s;
		out[2] = a02 * c + a12 * s;
		out[3] = a03 * c + a13 * s;

		out[4] = a10 * c - a00 * s;
		out[5] = a11 * c - a01 * s;
		out[6] = a12 * c - a02 * s;
		out[7] = a13 * c - a03 * s;
		return out;
	}

	static rotateAxis(a: ArrayLike<number>, axis: ArrayLike<number>, rad: number, out: Mat4 = new Mat4()): Mat4 | null {
		let x = axis[0], y = axis[1], z = axis[2];
		const lenSq = x * x + y * y + z * z;
		if (lenSq < EPSILON_SQ) return null;
		const invLen = 1.0 / Math.sqrt(lenSq);
		x *= invLen;
		y *= invLen;
		z *= invLen;

		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const t = 1 - c;

		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		const b00 = x * x * t + c;
		const b01 = y * x * t + z * s;
		const b02 = z * x * t - y * s;
		const b10 = x * y * t - z * s;
		const b11 = y * y * t + c;
		const b12 = z * y * t + x * s;
		const b20 = x * z * t + y * s;
		const b21 = y * z * t - x * s;
		const b22 = z * z * t + c;

		out[0] = a00 * b00 + a10 * b01 + a20 * b02;
		out[1] = a01 * b00 + a11 * b01 + a21 * b02;
		out[2] = a02 * b00 + a12 * b01 + a22 * b02;
		out[3] = a03 * b00 + a13 * b01 + a23 * b02;

		out[4] = a00 * b10 + a10 * b11 + a20 * b12;
		out[5] = a01 * b10 + a11 * b11 + a21 * b12;
		out[6] = a02 * b10 + a12 * b11 + a22 * b12;
		out[7] = a03 * b10 + a13 * b11 + a23 * b12;

		out[8] = a00 * b20 + a10 * b21 + a20 * b22;
		out[9] = a01 * b20 + a11 * b21 + a21 * b22;
		out[10] = a02 * b20 + a12 * b21 + a22 * b22;
		out[11] = a03 * b20 + a13 * b21 + a23 * b22;

		out[12] = a30;
		out[13] = a31;
		out[14] = a32;
		out[15] = a33;
		return out;
	}

	static rotateQ(a: ArrayLike<number>, q: ArrayLike<number>, out: Mat4 = new Mat4()): Mat4 {
		Mat4.fromQuat(q, _rotateQScratch);
		return Mat4.mul(a, _rotateQScratch, out);
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		for (let i = 0; i < 16; i++) {
			if (Math.abs(a[i] - b[i]) > eps) return false;
		}
		return true;
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		for (let i = 0; i < 16; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}
}

const _rotateQScratch = new Mat4();
