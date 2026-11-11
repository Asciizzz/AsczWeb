import { EPSILON } from "./constants.js";
import { Vec2 } from "./vec2.js";

/**
 * 3x3 32-bit floating-point matrix stored in column-major order.
 * Indices:
 * [ 0, 3, 6 ]
 * [ 1, 4, 7 ]
 * [ 2, 5, 8 ]
 */
export class Mat3 extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen identity 3x3 matrix tuple in column-major order. */
	static readonly IDENTITY: readonly [
		number, number, number,
		number, number, number,
		number, number, number,
	] = Object.freeze([
		1, 0, 0,
		0, 1, 0,
		0, 0, 1,
	]);

	/** Frozen zero 3x3 matrix tuple. */
	static readonly ZERO: readonly [
		number, number, number,
		number, number, number,
		number, number, number,
	] = Object.freeze([
		0, 0, 0,
		0, 0, 0,
		0, 0, 0,
	]);

	constructor(values?: ArrayLike<number>) {
		super(9);
		if (values) {
			for (let i = 0; i < 9; i++) {
				this[i] = values[i] ?? 0;
			}
		} else {
			this[0] = 1;
			this[4] = 1;
			this[8] = 1;
		}
	}

	/** Allocates and initializes a new owned Mat3 instance. */
	static create(values?: ArrayLike<number>): Mat3 {
		return new Mat3(values);
	}

	/** Sets all 9 elements in column-major order. */
	setElements(
		m00: number, m01: number, m02: number,
		m10: number, m11: number, m12: number,
		m20: number, m21: number, m22: number
	): this {
		this[0] = m00; this[1] = m01; this[2] = m02;
		this[3] = m10; this[4] = m11; this[5] = m12;
		this[6] = m20; this[7] = m21; this[8] = m22;
		return this;
	}

	/** Resets this matrix to the 3x3 identity matrix. */
	identity(): this {
		return Mat3.identity(this) as this;
	}

	/** Resets all elements to zero. */
	zero(): this {
		this.fill(0);
		return this;
	}

	/** Copies values from another 9-element array-like object. */
	copy(m: ArrayLike<number>): this {
		for (let i = 0; i < 9; i++) {
			this[i] = m[i];
		}
		return this;
	}

	/** Creates a new Mat3 initialized with this matrix's elements. */
	clone(): Mat3 {
		return new Mat3(this);
	}

	/** Extracts column index (0, 1, or 2) into out. */
	getColumn(index: 0 | 1 | 2, out: Float32Array = new Float32Array(3)): Float32Array {
		const offset = index * 3;
		out[0] = this[offset];
		out[1] = this[offset + 1];
		out[2] = this[offset + 2];
		return out;
	}

	/** Sets column index (0, 1, or 2) from v. */
	setColumn(index: 0 | 1 | 2, v: ArrayLike<number>): this {
		const offset = index * 3;
		this[offset] = v[0];
		this[offset + 1] = v[1];
		this[offset + 2] = v[2];
		return this;
	}

	/** Multiplies this matrix by b (out = this * b). */
	mul(b: ArrayLike<number>, out: Mat3 = this): Mat3 {
		return Mat3.mul(this, b, out);
	}

	/** Pre-multiplies this matrix by a (out = a * this). */
	premultiply(a: ArrayLike<number>, out: Mat3 = this): Mat3 {
		return Mat3.mul(a, this, out);
	}

	/** Transposes this matrix into out. Supports out === this. */
	transpose(out: Mat3 = this): Mat3 {
		return Mat3.transpose(this, out);
	}

	/** Computes the determinant of this matrix. */
	determinant(): number {
		return Mat3.determinant(this);
	}

	/**
	 * Inverts this matrix into out.
	 * Returns null and leaves out unchanged if the matrix is singular (|det| <= minAbsDet).
	 */
	invert(out: Mat3 = this, minAbsDet = 0): Mat3 | null {
		return Mat3.invert(this, out, minAbsDet);
	}

	/**
	 * Sets this matrix to the 3x3 normal matrix (inverse-transpose of the upper-left 3x3 of m).
	 * Returns null and leaves this matrix unchanged if the upper-left 3x3 of m is singular.
	 */
	normalMatrix(m: ArrayLike<number>, minAbsDet = 0): this | null {
		const res = Mat3.normalMatrix(m, this, minAbsDet);
		return res ? this : null;
	}

	/** Copies the upper-left 3x3 block of a column-major 4x4 matrix into this matrix. */
	fromMat4(m: ArrayLike<number>): this {
		return Mat3.fromMat4(m, this) as this;
	}

	/** Sets this matrix from a unit quaternion [x, y, z, w]. */
	fromQuat(q: ArrayLike<number>): this {
		return Mat3.fromQuat(q, this) as this;
	}

	/** Post-multiplies this 2D affine matrix by a 2D translation v. */
	translate2D(v: ArrayLike<number>, out: Mat3 = this): Mat3 {
		return Mat3.translate2D(this, v, out);
	}

	/** Post-multiplies this 2D affine matrix by a counter-clockwise 2D rotation of rad radians. */
	rotate2D(rad: number, out: Mat3 = this): Mat3 {
		return Mat3.rotate2D(this, rad, out);
	}

	/** Post-multiplies this 2D affine matrix by a 2D scale v. */
	scale2D(v: ArrayLike<number>, out: Mat3 = this): Mat3 {
		return Mat3.scale2D(this, v, out);
	}

	/** Checks approximate element-wise equality with b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Mat3.equals(this, b, eps);
	}

	/** Checks strict element-wise equality with b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Mat3.exactEquals(this, b);
	}

	/** Copies 9 elements from arr starting at offset. */
	fromArray(arr: ArrayLike<number>, offset = 0): this {
		for (let i = 0; i < 9; i++) {
			this[i] = arr[offset + i];
		}
		return this;
	}

	/** Writes 9 elements into out starting at offset. */
	toArray<T extends number[] | Float32Array = number[]>(out: T = [] as unknown as T, offset = 0): T {
		for (let i = 0; i < 9; i++) {
			out[offset + i] = this[i];
		}
		return out;
	}

	override toString(): string {
		return (
			`Mat3(\n` +
			`  [${this[0].toFixed(4)}, ${this[3].toFixed(4)}, ${this[6].toFixed(4)}],\n` +
			`  [${this[1].toFixed(4)}, ${this[4].toFixed(4)}, ${this[7].toFixed(4)}],\n` +
			`  [${this[2].toFixed(4)}, ${this[5].toFixed(4)}, ${this[8].toFixed(4)}]\n)`
		);
	}

	static identity(out: Mat3 = new Mat3()): Mat3 {
		out[0] = 1; out[1] = 0; out[2] = 0;
		out[3] = 0; out[4] = 1; out[5] = 0;
		out[6] = 0; out[7] = 0; out[8] = 1;
		return out;
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];

		const b00 = b[0], b01 = b[1], b02 = b[2];
		const b10 = b[3], b11 = b[4], b12 = b[5];
		const b20 = b[6], b21 = b[7], b22 = b[8];

		out[0] = b00 * a00 + b01 * a10 + b02 * a20;
		out[1] = b00 * a01 + b01 * a11 + b02 * a21;
		out[2] = b00 * a02 + b01 * a12 + b02 * a22;

		out[3] = b10 * a00 + b11 * a10 + b12 * a20;
		out[4] = b10 * a01 + b11 * a11 + b12 * a21;
		out[5] = b10 * a02 + b11 * a12 + b12 * a22;

		out[6] = b20 * a00 + b21 * a10 + b22 * a20;
		out[7] = b20 * a01 + b21 * a11 + b22 * a21;
		out[8] = b20 * a02 + b21 * a12 + b22 * a22;
		return out;
	}

	static transpose(a: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];

		out[0] = a00;
		out[1] = a10;
		out[2] = a20;
		out[3] = a01;
		out[4] = a11;
		out[5] = a21;
		out[6] = a02;
		out[7] = a12;
		out[8] = a22;
		return out;
	}

	static determinant(a: ArrayLike<number>): number {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];

		return (
			a00 * (a22 * a11 - a12 * a21) +
			a01 * (-a22 * a10 + a12 * a20) +
			a02 * (a21 * a10 - a11 * a20)
		);
	}

	static invert(a: ArrayLike<number>, out: Mat3 = new Mat3(), minAbsDet = 0): Mat3 | null {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];

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

		out[0] = b01 * invDet;
		out[1] = (-a22 * a01 + a02 * a21) * invDet;
		out[2] = (a12 * a01 - a02 * a11) * invDet;
		out[3] = b11 * invDet;
		out[4] = (a22 * a00 - a02 * a20) * invDet;
		out[5] = (-a12 * a00 + a02 * a10) * invDet;
		out[6] = b21 * invDet;
		out[7] = (-a21 * a00 + a01 * a20) * invDet;
		out[8] = (a11 * a00 - a01 * a10) * invDet;
		return out;
	}

	/**
	 * Computes the 3x3 normal matrix: the inverse-transpose of the upper-left 3x3 of a column-major 4x4 matrix.
	 * Returns null and leaves out unchanged if the upper-left 3x3 is singular (|det| <= minAbsDet).
	 */
	static normalMatrix(a: ArrayLike<number>, out: Mat3 = new Mat3(), minAbsDet = 0): Mat3 | null {
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
		out[3] = (-a22 * a01 + a02 * a21) * invDet;
		out[4] = (a22 * a00 - a02 * a20) * invDet;
		out[5] = (-a21 * a00 + a01 * a20) * invDet;
		out[6] = (a12 * a01 - a02 * a11) * invDet;
		out[7] = (-a12 * a00 + a02 * a10) * invDet;
		out[8] = (a11 * a00 - a01 * a10) * invDet;
		return out;
	}

	static fromMat4(a: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const a0 = a[0], a1 = a[1], a2 = a[2];
		const a4 = a[4], a5 = a[5], a6 = a[6];
		const a8 = a[8], a9 = a[9], a10 = a[10];
		out[0] = a0; out[1] = a1; out[2] = a2;
		out[3] = a4; out[4] = a5; out[5] = a6;
		out[6] = a8; out[7] = a9; out[8] = a10;
		return out;
	}

	static fromQuat(q: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const x = q[0], y = q[1], z = q[2], w = q[3];
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, yx = y * x2, yy = y * y2;
		const zx = z * x2, zy = z * y2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;

		out[0] = 1 - yy - zz;
		out[3] = yx - wz;
		out[6] = zx + wy;

		out[1] = yx + wz;
		out[4] = 1 - xx - zz;
		out[7] = zy - wx;

		out[2] = zx - wy;
		out[5] = zy + wx;
		out[8] = 1 - xx - yy;
		return out;
	}

	static translate2D(a: ArrayLike<number>, v: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];
		const x = v[0], y = v[1];

		out[0] = a00;
		out[1] = a01;
		out[2] = a02;
		out[3] = a10;
		out[4] = a11;
		out[5] = a12;
		out[6] = x * a00 + y * a10 + a20;
		out[7] = x * a01 + y * a11 + a21;
		out[8] = x * a02 + y * a12 + a22;
		return out;
	}

	static rotate2D(a: ArrayLike<number>, rad: number, out: Mat3 = new Mat3()): Mat3 {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];
		const s = Math.sin(rad), c = Math.cos(rad);

		out[0] = c * a00 + s * a10;
		out[1] = c * a01 + s * a11;
		out[2] = c * a02 + s * a12;

		out[3] = c * a10 - s * a00;
		out[4] = c * a11 - s * a01;
		out[5] = c * a12 - s * a02;

		out[6] = a20;
		out[7] = a21;
		out[8] = a22;
		return out;
	}

	static scale2D(a: ArrayLike<number>, v: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const a00 = a[0], a01 = a[1], a02 = a[2];
		const a10 = a[3], a11 = a[4], a12 = a[5];
		const a20 = a[6], a21 = a[7], a22 = a[8];
		const x = v[0], y = v[1];

		out[0] = x * a00;
		out[1] = x * a01;
		out[2] = x * a02;

		out[3] = y * a10;
		out[4] = y * a11;
		out[5] = y * a12;

		out[6] = a20;
		out[7] = a21;
		out[8] = a22;
		return out;
	}

	static fromTranslation2D(v: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const x = v[0], y = v[1];
		out[0] = 1; out[1] = 0; out[2] = 0;
		out[3] = 0; out[4] = 1; out[5] = 0;
		out[6] = x; out[7] = y; out[8] = 1;
		return out;
	}

	static fromRotation2D(rad: number, out: Mat3 = new Mat3()): Mat3 {
		const s = Math.sin(rad), c = Math.cos(rad);
		out[0] = c;  out[1] = s; out[2] = 0;
		out[3] = -s; out[4] = c; out[5] = 0;
		out[6] = 0;  out[7] = 0; out[8] = 1;
		return out;
	}

	static fromScaling2D(v: ArrayLike<number>, out: Mat3 = new Mat3()): Mat3 {
		const x = v[0], y = v[1];
		out[0] = x; out[1] = 0; out[2] = 0;
		out[3] = 0; out[4] = y; out[5] = 0;
		out[6] = 0; out[7] = 0; out[8] = 1;
		return out;
	}

	/**
	 * Builds a 2D UV transform matrix: T(center) * R(rotation) * S(scale) * T(-center) * T(offset).
	 */
	static fromUVTransform(
		offset: ArrayLike<number> = Vec2.ZERO,
		scale: ArrayLike<number> = Vec2.ONE,
		rotationRad = 0,
		center: ArrayLike<number> = Vec2.ZERO,
		out: Mat3 = new Mat3()
	): Mat3 {
		const c = Math.cos(rotationRad);
		const s = Math.sin(rotationRad);
		const sx = scale[0], sy = scale[1];
		const cx = center[0], cy = center[1];
		const tx = offset[0], ty = offset[1];

		out[0] = sx * c;
		out[1] = sx * s;
		out[2] = 0;

		out[3] = -sy * s;
		out[4] = sy * c;
		out[5] = 0;

		out[6] = -sx * c * cx + sy * s * cy + cx + tx;
		out[7] = -sx * s * cx - sy * c * cy + cy + ty;
		out[8] = 1;
		return out;
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		for (let i = 0; i < 9; i++) {
			if (Math.abs(a[i] - b[i]) > eps) return false;
		}
		return true;
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		for (let i = 0; i < 9; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}
}
