import { EPSILON, EPSILON_SQ } from "./constants.js";

/**
 * 4-component 32-bit floating-point vector.
 * Memory layout: [x, y, z, w] in a 4-element Float32Array.
 */
export class Vec4 extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen zero tuple [0, 0, 0, 0]. */
	static readonly ZERO: readonly [number, number, number, number] = Object.freeze([0, 0, 0, 0]);
	/** Frozen unit tuple [1, 1, 1, 1]. */
	static readonly ONE: readonly [number, number, number, number] = Object.freeze([1, 1, 1, 1]);
	/** Frozen X-axis unit tuple [1, 0, 0, 0]. */
	static readonly UNIT_X: readonly [number, number, number, number] = Object.freeze([1, 0, 0, 0]);
	/** Frozen Y-axis unit tuple [0, 1, 0, 0]. */
	static readonly UNIT_Y: readonly [number, number, number, number] = Object.freeze([0, 1, 0, 0]);
	/** Frozen Z-axis unit tuple [0, 0, 1, 0]. */
	static readonly UNIT_Z: readonly [number, number, number, number] = Object.freeze([0, 0, 1, 0]);
	/** Frozen W-axis unit tuple [0, 0, 0, 1]. */
	static readonly UNIT_W: readonly [number, number, number, number] = Object.freeze([0, 0, 0, 1]);

	constructor(x: number | ArrayLike<number> = 0, y = 0, z = 0, w = 0) {
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
			this[3] = x[3] ?? 0;
		}
	}

	/** Allocates and initializes a new owned Vec4 instance. */
	static create(x: number | ArrayLike<number> = 0, y = 0, z = 0, w = 0): Vec4 {
		return new Vec4(x, y, z, w);
	}

	/** Allocates a new zeroed Vec4 instance. */
	static zero(out: Vec4 = new Vec4()): Vec4 {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		return out;
	}

	/** Allocates a new Vec4 initialized to [1, 1, 1, 1]. */
	static one(out: Vec4 = new Vec4()): Vec4 {
		out[0] = 1;
		out[1] = 1;
		out[2] = 1;
		out[3] = 1;
		return out;
	}

	get x(): number { return this[0]; }
	set x(v: number) { this[0] = v; }

	get y(): number { return this[1]; }
	set y(v: number) { this[1] = v; }

	get z(): number { return this[2]; }
	set z(v: number) { this[2] = v; }

	get w(): number { return this[3]; }
	set w(v: number) { this[3] = v; }

	get r(): number { return this[0]; }
	set r(v: number) { this[0] = v; }

	get g(): number { return this[1]; }
	set g(v: number) { this[1] = v; }

	get b(): number { return this[2]; }
	set b(v: number) { this[2] = v; }

	get a(): number { return this[3]; }
	set a(v: number) { this[3] = v; }

	/** Sets the vector components in-place. */
	setComponents(x: number, y: number, z: number, w: number): this {
		this[0] = x;
		this[1] = y;
		this[2] = z;
		this[3] = w;
		return this;
	}

	/** Sets all 4 components to the same scalar value. */
	setScalar(s: number): this {
		this[0] = s;
		this[1] = s;
		this[2] = s;
		this[3] = s;
		return this;
	}

	/** Copies values from another 4-component array-like object. */
	copy(v: ArrayLike<number>): this {
		this[0] = v[0];
		this[1] = v[1];
		this[2] = v[2];
		this[3] = v[3];
		return this;
	}

	/** Creates a new Vec4 initialized with this vector's components. */
	clone(): Vec4 {
		return new Vec4(this[0], this[1], this[2], this[3]);
	}

	/** Resets all components to zero. */
	zero(): this {
		this[0] = 0;
		this[1] = 0;
		this[2] = 0;
		this[3] = 0;
		return this;
	}

	/** Adds vector b to this vector. */
	add(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.add(this, b, out);
	}

	/** Subtracts vector b from this vector. */
	sub(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.sub(this, b, out);
	}

	/** Multiplies this vector component-wise by vector b. */
	mul(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.mul(this, b, out);
	}

	/** Divides this vector component-wise by vector b. */
	div(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.div(this, b, out);
	}

	/** Multiplies this vector by scalar s. */
	scale(s: number, out: Vec4 = this): Vec4 {
		return Vec4.scale(this, s, out);
	}

	/** Adds vector b scaled by s to this vector. */
	addScaled(b: ArrayLike<number>, s: number, out: Vec4 = this): Vec4 {
		return Vec4.addScaled(this, b, s, out);
	}

	/** Negates all components of this vector. */
	negate(out: Vec4 = this): Vec4 {
		return Vec4.negate(this, out);
	}

	/** Computes component-wise reciprocal (1 / x, 1 / y, 1 / z, 1 / w). */
	inverse(out: Vec4 = this): Vec4 {
		return Vec4.inverse(this, out);
	}

	/** Computes component-wise absolute value. */
	abs(out: Vec4 = this): Vec4 {
		return Vec4.abs(this, out);
	}

	/** Computes component-wise floor. */
	floor(out: Vec4 = this): Vec4 {
		return Vec4.floor(this, out);
	}

	/** Computes component-wise ceiling. */
	ceil(out: Vec4 = this): Vec4 {
		return Vec4.ceil(this, out);
	}

	/** Computes component-wise rounding to nearest integer. */
	round(out: Vec4 = this): Vec4 {
		return Vec4.round(this, out);
	}

	/** Computes component-wise minimum with vector b. */
	min(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.min(this, b, out);
	}

	/** Computes component-wise maximum with vector b. */
	max(b: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.max(this, b, out);
	}

	/** Clamps components between minVec and maxVec. */
	clamp(minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.clamp(this, minVec, maxVec, out);
	}

	/** Computes dot product with vector b. */
	dot(b: ArrayLike<number>): number {
		return Vec4.dot(this, b);
	}

	/** Computes Euclidean magnitude of this vector. */
	len(): number {
		return Vec4.len(this);
	}

	/** Computes Euclidean magnitude of this vector. */
	magnitude(): number {
		return Vec4.len(this);
	}

	/** Computes squared Euclidean magnitude of this vector. */
	lengthSq(): number {
		return Vec4.lengthSq(this);
	}

	/** Computes Euclidean distance to vector b. */
	distance(b: ArrayLike<number>): number {
		return Vec4.distance(this, b);
	}

	/** Computes squared Euclidean distance to vector b. */
	distanceSq(b: ArrayLike<number>): number {
		return Vec4.distanceSq(this, b);
	}

	/** Normalizes this vector to unit length. Zero vectors remain [0, 0, 0, 0]. */
	normalize(out: Vec4 = this): Vec4 {
		return Vec4.normalize(this, out);
	}

	/** Linearly interpolates between this vector and b by factor t. */
	lerp(b: ArrayLike<number>, t: number, out: Vec4 = this): Vec4 {
		return Vec4.lerp(this, b, t, out);
	}

	/** Transforms this 4D vector by a column-major 4x4 matrix. */
	transformMat4(m: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.transformMat4(this, m, out);
	}

	/** Rotates the xyz components by unit quaternion q [x, y, z, w], preserving w. */
	transformQuat(q: ArrayLike<number>, out: Vec4 = this): Vec4 {
		return Vec4.transformQuat(this, q, out);
	}

	/** Checks approximate equality with vector b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Vec4.equals(this, b, eps);
	}

	/** Checks strict component equality with vector b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Vec4.exactEquals(this, b);
	}

	/** Returns true if all components are finite numbers. */
	isFinite(): boolean {
		return (
			Number.isFinite(this[0]) &&
			Number.isFinite(this[1]) &&
			Number.isFinite(this[2]) &&
			Number.isFinite(this[3])
		);
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
		return `Vec4(${this[0].toFixed(4)}, ${this[1].toFixed(4)}, ${this[2].toFixed(4)}, ${this[3].toFixed(4)})`;
	}

	static add(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax + bx;
		out[1] = ay + by;
		out[2] = az + bz;
		out[3] = aw + bw;
		return out;
	}

	static sub(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax - bx;
		out[1] = ay - by;
		out[2] = az - bz;
		out[3] = aw - bw;
		return out;
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax * bx;
		out[1] = ay * by;
		out[2] = az * bz;
		out[3] = aw * bw;
		return out;
	}

	static div(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax / bx;
		out[1] = ay / by;
		out[2] = az / bz;
		out[3] = aw / bw;
		return out;
	}

	static scale(a: ArrayLike<number>, s: number, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = ax * s;
		out[1] = ay * s;
		out[2] = az * s;
		out[3] = aw * s;
		return out;
	}

	static addScaled(a: ArrayLike<number>, b: ArrayLike<number>, s: number, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax + bx * s;
		out[1] = ay + by * s;
		out[2] = az + bz * s;
		out[3] = aw + bw * s;
		return out;
	}

	static negate(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = -ax;
		out[1] = -ay;
		out[2] = -az;
		out[3] = -aw;
		return out;
	}

	static inverse(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = 1.0 / ax;
		out[1] = 1.0 / ay;
		out[2] = 1.0 / az;
		out[3] = 1.0 / aw;
		return out;
	}

	static abs(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = Math.abs(ax);
		out[1] = Math.abs(ay);
		out[2] = Math.abs(az);
		out[3] = Math.abs(aw);
		return out;
	}

	static floor(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = Math.floor(ax);
		out[1] = Math.floor(ay);
		out[2] = Math.floor(az);
		out[3] = Math.floor(aw);
		return out;
	}

	static ceil(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = Math.ceil(ax);
		out[1] = Math.ceil(ay);
		out[2] = Math.ceil(az);
		out[3] = Math.ceil(aw);
		return out;
	}

	static round(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		out[0] = Math.round(ax);
		out[1] = Math.round(ay);
		out[2] = Math.round(az);
		out[3] = Math.round(aw);
		return out;
	}

	static min(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = Math.min(ax, bx);
		out[1] = Math.min(ay, by);
		out[2] = Math.min(az, bz);
		out[3] = Math.min(aw, bw);
		return out;
	}

	static max(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = Math.max(ax, bx);
		out[1] = Math.max(ay, by);
		out[2] = Math.max(az, bz);
		out[3] = Math.max(aw, bw);
		return out;
	}

	static clamp(a: ArrayLike<number>, minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const minX = minVec[0], minY = minVec[1], minZ = minVec[2], minW = minVec[3];
		const maxX = maxVec[0], maxY = maxVec[1], maxZ = maxVec[2], maxW = maxVec[3];
		out[0] = Math.max(minX, Math.min(maxX, ax));
		out[1] = Math.max(minY, Math.min(maxY, ay));
		out[2] = Math.max(minZ, Math.min(maxZ, az));
		out[3] = Math.max(minW, Math.min(maxW, aw));
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

	static distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
	}

	static distanceSq(a: ArrayLike<number>, b: ArrayLike<number>): number {
		const dx = a[0] - b[0];
		const dy = a[1] - b[1];
		const dz = a[2] - b[2];
		const dw = a[3] - b[3];
		return dx * dx + dy * dy + dz * dz + dw * dw;
	}

	static normalize(a: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
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
			out[3] = 0;
		}
		return out;
	}

	static lerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec4 = new Vec4()): Vec4 {
		const ax = a[0], ay = a[1], az = a[2], aw = a[3];
		const bx = b[0], by = b[1], bz = b[2], bw = b[3];
		out[0] = ax + t * (bx - ax);
		out[1] = ay + t * (by - ay);
		out[2] = az + t * (bz - az);
		out[3] = aw + t * (bw - aw);
		return out;
	}

	static transformMat4(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const x = a[0], y = a[1], z = a[2], w = a[3];
		const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
		const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
		const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
		const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
		out[0] = m0 * x + m4 * y + m8 * z + m12 * w;
		out[1] = m1 * x + m5 * y + m9 * z + m13 * w;
		out[2] = m2 * x + m6 * y + m10 * z + m14 * w;
		out[3] = m3 * x + m7 * y + m11 * z + m15 * w;
		return out;
	}

	static transformQuat(a: ArrayLike<number>, q: ArrayLike<number>, out: Vec4 = new Vec4()): Vec4 {
		const vx = a[0], vy = a[1], vz = a[2], vw = a[3];
		const qx = q[0], qy = q[1], qz = q[2], qw = q[3];

		const tx = 2.0 * (qy * vz - qz * vy);
		const ty = 2.0 * (qz * vx - qx * vz);
		const tz = 2.0 * (qx * vy - qy * vx);

		out[0] = vx + qw * tx + (qy * tz - qz * ty);
		out[1] = vy + qw * ty + (qz * tx - qx * tz);
		out[2] = vz + qw * tz + (qx * ty - qy * tx);
		out[3] = vw;
		return out;
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		return (
			Math.abs(a[0] - b[0]) <= eps &&
			Math.abs(a[1] - b[1]) <= eps &&
			Math.abs(a[2] - b[2]) <= eps &&
			Math.abs(a[3] - b[3]) <= eps
		);
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
	}
}
