import { EPSILON, EPSILON_SQ } from "./constants.js";

/**
 * 2-component 32-bit floating-point vector.
 * Memory layout: [x, y] in a 2-element Float32Array.
 */
export class Vec2 extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen zero tuple [0, 0]. */
	static readonly ZERO: readonly [number, number] = Object.freeze([0, 0]);
	/** Frozen unit tuple [1, 1]. */
	static readonly ONE: readonly [number, number] = Object.freeze([1, 1]);
	/** Frozen X-axis unit tuple [1, 0]. */
	static readonly RIGHT: readonly [number, number] = Object.freeze([1, 0]);
	/** Frozen negative X-axis unit tuple [-1, 0]. */
	static readonly LEFT: readonly [number, number] = Object.freeze([-1, 0]);
	/** Frozen Y-axis unit tuple [0, 1]. */
	static readonly UP: readonly [number, number] = Object.freeze([0, 1]);
	/** Frozen negative Y-axis unit tuple [0, -1]. */
	static readonly DOWN: readonly [number, number] = Object.freeze([0, -1]);

	constructor(x: number | ArrayLike<number> = 0, y = 0) {
		super(2);
		if (typeof x === "number") {
			this[0] = x;
			this[1] = y;
		} else {
			this[0] = x[0] ?? 0;
			this[1] = x[1] ?? 0;
		}
	}

	/** Allocates and initializes a new owned Vec2 instance. */
	static create(x: number | ArrayLike<number> = 0, y = 0): Vec2 {
		return new Vec2(x, y);
	}

	/** Allocates a new zeroed Vec2 instance. */
	static zero(out: Vec2 = new Vec2()): Vec2 {
		out[0] = 0;
		out[1] = 0;
		return out;
	}

	/** Allocates a new Vec2 initialized to [1, 1]. */
	static one(out: Vec2 = new Vec2()): Vec2 {
		out[0] = 1;
		out[1] = 1;
		return out;
	}

	get x(): number { return this[0]; }
	set x(v: number) { this[0] = v; }

	get y(): number { return this[1]; }
	set y(v: number) { this[1] = v; }

	get u(): number { return this[0]; }
	set u(v: number) { this[0] = v; }

	get v(): number { return this[1]; }
	set v(v: number) { this[1] = v; }

	get width(): number { return this[0]; }
	set width(v: number) { this[0] = v; }

	get height(): number { return this[1]; }
	set height(v: number) { this[1] = v; }

	/** Sets the vector components in-place. */
	setComponents(x: number, y: number): this {
		this[0] = x;
		this[1] = y;
		return this;
	}

	/** Sets both components to the same scalar value. */
	setScalar(s: number): this {
		this[0] = s;
		this[1] = s;
		return this;
	}

	/** Copies values from another 2-component array-like object. */
	copy(v: ArrayLike<number>): this {
		this[0] = v[0];
		this[1] = v[1];
		return this;
	}

	/** Creates a new Vec2 initialized with this vector's components. */
	clone(): Vec2 {
		return new Vec2(this[0], this[1]);
	}

	/** Resets all components to zero. */
	zero(): this {
		this[0] = 0;
		this[1] = 0;
		return this;
	}

	/** Adds vector b to this vector. */
	add(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.add(this, b, out);
	}

	/** Subtracts vector b from this vector. */
	sub(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.sub(this, b, out);
	}

	/** Multiplies this vector component-wise by vector b. */
	mul(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.mul(this, b, out);
	}

	/** Divides this vector component-wise by vector b. */
	div(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.div(this, b, out);
	}

	/** Multiplies this vector by scalar s. */
	scale(s: number, out: Vec2 = this): Vec2 {
		return Vec2.scale(this, s, out);
	}

	/** Adds vector b scaled by s to this vector. */
	addScaled(b: ArrayLike<number>, s: number, out: Vec2 = this): Vec2 {
		return Vec2.addScaled(this, b, s, out);
	}

	/** Negates all components of this vector. */
	negate(out: Vec2 = this): Vec2 {
		return Vec2.negate(this, out);
	}

	/** Computes component-wise reciprocal (1 / x, 1 / y). */
	inverse(out: Vec2 = this): Vec2 {
		return Vec2.inverse(this, out);
	}

	/** Computes component-wise absolute value. */
	abs(out: Vec2 = this): Vec2 {
		return Vec2.abs(this, out);
	}

	/** Computes component-wise floor. */
	floor(out: Vec2 = this): Vec2 {
		return Vec2.floor(this, out);
	}

	/** Computes component-wise ceiling. */
	ceil(out: Vec2 = this): Vec2 {
		return Vec2.ceil(this, out);
	}

	/** Computes component-wise rounding to nearest integer. */
	round(out: Vec2 = this): Vec2 {
		return Vec2.round(this, out);
	}

	/** Computes component-wise minimum with vector b. */
	min(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.min(this, b, out);
	}

	/** Computes component-wise maximum with vector b. */
	max(b: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.max(this, b, out);
	}

	/** Clamps components between minVec and maxVec. */
	clamp(minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.clamp(this, minVec, maxVec, out);
	}

	/** Clamps vector magnitude between minLen and maxLen. */
	clampLength(minLen: number, maxLen: number, out: Vec2 = this): Vec2 {
		const x = this[0], y = this[1];
		const sqLen = x * x + y * y;
		if (sqLen > EPSILON_SQ) {
			const len = Math.sqrt(sqLen);
			const factor = Math.max(minLen, Math.min(maxLen, len)) / len;
			out[0] = x * factor;
			out[1] = y * factor;
		} else {
			out[0] = 0;
			out[1] = 0;
		}
		return out;
	}

	/** Computes dot product with vector b. */
	dot(b: ArrayLike<number>): number {
		return Vec2.dot(this, b);
	}

	/** Computes 2D scalar cross product (z-component of 3D cross product). */
	cross(b: ArrayLike<number>): number {
		return Vec2.cross(this, b);
	}

	/** Computes Euclidean magnitude of this vector. */
	len(): number {
		return Vec2.len(this);
	}

	/** Computes Euclidean magnitude of this vector. */
	magnitude(): number {
		return Vec2.len(this);
	}

	/** Computes squared Euclidean magnitude of this vector. */
	lengthSq(): number {
		return Vec2.lengthSq(this);
	}

	/** Computes Euclidean distance to vector b. */
	distance(b: ArrayLike<number>): number {
		return Vec2.distance(this, b);
	}

	/** Computes squared Euclidean distance to vector b. */
	distanceSq(b: ArrayLike<number>): number {
		return Vec2.distanceSq(this, b);
	}

	/** Normalizes this vector to unit length. Zero vectors remain [0, 0]. */
	normalize(out: Vec2 = this): Vec2 {
		return Vec2.normalize(this, out);
	}

	/** Linearly interpolates between this vector and b by factor t. */
	lerp(b: ArrayLike<number>, t: number, out: Vec2 = this): Vec2 {
		return Vec2.lerp(this, b, t, out);
	}

	/** Rotates this vector counter-clockwise around origin by rad radians. */
	rotate(rad: number, origin: ArrayLike<number> = Vec2.ZERO, out: Vec2 = this): Vec2 {
		return Vec2.rotate(this, origin, rad, out);
	}

	/** Computes counter-clockwise perpendicular vector (-y, x). */
	perp(out: Vec2 = this): Vec2 {
		const x = this[0];
		out[0] = -this[1];
		out[1] = x;
		return out;
	}

	/** Computes clockwise perpendicular vector (y, -x). */
	perpCW(out: Vec2 = this): Vec2 {
		const x = this[0];
		out[0] = this[1];
		out[1] = -x;
		return out;
	}

	/** Computes angle in radians from positive X-axis, or signed angle to vector b. */
	angle(b?: ArrayLike<number>): number {
		if (!b) {
			return Math.atan2(this[1], this[0]);
		}
		return Vec2.angle(this, b);
	}

	/** Transforms this 2D point by a column-major 3x3 matrix (implicitly z = 1). */
	transformMat3(m: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.transformMat3(this, m, out);
	}

	/** Transforms this 2D point by a column-major 4x4 matrix (implicitly z = 0, w = 1). */
	transformMat4(m: ArrayLike<number>, out: Vec2 = this): Vec2 {
		return Vec2.transformMat4(this, m, out);
	}

	/** Checks approximate equality with vector b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Vec2.equals(this, b, eps);
	}

	/** Checks strict component equality with vector b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Vec2.exactEquals(this, b);
	}

	/** Returns true if all components are finite numbers. */
	isFinite(): boolean {
		return Number.isFinite(this[0]) && Number.isFinite(this[1]);
	}

	/** Copies components from array starting at offset. */
	fromArray(arr: ArrayLike<number>, offset = 0): this {
		this[0] = arr[offset];
		this[1] = arr[offset + 1];
		return this;
	}

	/** Writes components into target array starting at offset. */
	toArray<T extends number[] | Float32Array = number[]>(out: T = [] as unknown as T, offset = 0): T {
		out[offset] = this[0];
		out[offset + 1] = this[1];
		return out;
	}

	override toString(): string {
		return `Vec2(${this[0].toFixed(4)}, ${this[1].toFixed(4)})`;
	}

	static add(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax + bx;
		out[1] = ay + by;
		return out;
	}

	static sub(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax - bx;
		out[1] = ay - by;
		return out;
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax * bx;
		out[1] = ay * by;
		return out;
	}

	static div(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax / bx;
		out[1] = ay / by;
		return out;
	}

	static scale(a: ArrayLike<number>, s: number, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = ax * s;
		out[1] = ay * s;
		return out;
	}

	static addScaled(a: ArrayLike<number>, b: ArrayLike<number>, s: number, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax + bx * s;
		out[1] = ay + by * s;
		return out;
	}

	static negate(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = -ax;
		out[1] = -ay;
		return out;
	}

	static inverse(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = 1.0 / ax;
		out[1] = 1.0 / ay;
		return out;
	}

	static abs(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = Math.abs(ax);
		out[1] = Math.abs(ay);
		return out;
	}

	static floor(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = Math.floor(ax);
		out[1] = Math.floor(ay);
		return out;
	}

	static ceil(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = Math.ceil(ax);
		out[1] = Math.ceil(ay);
		return out;
	}

	static round(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		out[0] = Math.round(ax);
		out[1] = Math.round(ay);
		return out;
	}

	static min(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = Math.min(ax, bx);
		out[1] = Math.min(ay, by);
		return out;
	}

	static max(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = Math.max(ax, bx);
		out[1] = Math.max(ay, by);
		return out;
	}

	static clamp(a: ArrayLike<number>, minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const minX = minVec[0], minY = minVec[1];
		const maxX = maxVec[0], maxY = maxVec[1];
		out[0] = Math.max(minX, Math.min(maxX, ax));
		out[1] = Math.max(minY, Math.min(maxY, ay));
		return out;
	}

	static dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return a[0] * b[0] + a[1] * b[1];
	}

	static cross(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return a[0] * b[1] - a[1] * b[0];
	}

	static len(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1]);
	}

	static magnitude(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1]);
	}

	static lengthSq(a: ArrayLike<number>): number {
		return a[0] * a[0] + a[1] * a[1];
	}

	static distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return Math.hypot(a[0] - b[0], a[1] - b[1]);
	}

	static distanceSq(a: ArrayLike<number>, b: ArrayLike<number>): number {
		const dx = a[0] - b[0];
		const dy = a[1] - b[1];
		return dx * dx + dy * dy;
	}

	static normalize(a: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const x = a[0];
		const y = a[1];
		const sqLen = x * x + y * y;
		if (sqLen > EPSILON_SQ) {
			const invLen = 1.0 / Math.sqrt(sqLen);
			out[0] = x * invLen;
			out[1] = y * invLen;
		} else {
			out[0] = 0;
			out[1] = 0;
		}
		return out;
	}

	static lerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec2 = new Vec2()): Vec2 {
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax + t * (bx - ax);
		out[1] = ay + t * (by - ay);
		return out;
	}

	static smoothStep(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec2 = new Vec2()): Vec2 {
		const clampedT = Math.max(0, Math.min(1, t));
		const st = clampedT * clampedT * (3 - 2 * clampedT);
		const ax = a[0], ay = a[1];
		const bx = b[0], by = b[1];
		out[0] = ax + st * (bx - ax);
		out[1] = ay + st * (by - ay);
		return out;
	}

	static rotate(a: ArrayLike<number>, origin: ArrayLike<number>, rad: number, out: Vec2 = new Vec2()): Vec2 {
		const ox = origin[0];
		const oy = origin[1];
		const px = a[0] - ox;
		const py = a[1] - oy;
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		out[0] = px * c - py * s + ox;
		out[1] = px * s + py * c + oy;
		return out;
	}

	static angle(a: ArrayLike<number>, b: ArrayLike<number>): number {
		const cross = a[0] * b[1] - a[1] * b[0];
		const dot = a[0] * b[0] + a[1] * b[1];
		return Math.atan2(cross, dot);
	}

	static transformMat3(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const x = a[0];
		const y = a[1];
		const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
		out[0] = m0 * x + m3 * y + m6;
		out[1] = m1 * x + m4 * y + m7;
		return out;
	}

	static transformMat4(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec2 = new Vec2()): Vec2 {
		const x = a[0];
		const y = a[1];
		const m0 = m[0], m1 = m[1], m4 = m[4], m5 = m[5], m12 = m[12], m13 = m[13];
		out[0] = m0 * x + m4 * y + m12;
		out[1] = m1 * x + m5 * y + m13;
		return out;
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return a[0] === b[0] && a[1] === b[1];
	}
}
