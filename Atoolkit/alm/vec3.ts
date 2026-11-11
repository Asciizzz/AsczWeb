import { EPSILON, EPSILON_SQ } from "./constants.js";

/**
 * 3-component 32-bit floating-point vector.
 * Memory layout: [x, y, z] in a 3-element Float32Array.
 */
export class Vec3 extends Float32Array {
	static get [Symbol.species](): Float32ArrayConstructor {
		return Float32Array;
	}

	/** Frozen zero tuple [0, 0, 0]. */
	static readonly ZERO: readonly [number, number, number] = Object.freeze([0, 0, 0]);
	/** Frozen unit scale tuple [1, 1, 1]. */
	static readonly ONE: readonly [number, number, number] = Object.freeze([1, 1, 1]);
	/** Frozen positive X-axis unit tuple [1, 0, 0]. */
	static readonly RIGHT: readonly [number, number, number] = Object.freeze([1, 0, 0]);
	/** Frozen negative X-axis unit tuple [-1, 0, 0]. */
	static readonly LEFT: readonly [number, number, number] = Object.freeze([-1, 0, 0]);
	/** Frozen positive Y-axis unit tuple [0, 1, 0]. */
	static readonly UP: readonly [number, number, number] = Object.freeze([0, 1, 0]);
	/** Frozen negative Y-axis unit tuple [0, -1, 0]. */
	static readonly DOWN: readonly [number, number, number] = Object.freeze([0, -1, 0]);
	/** Frozen right-handed forward tuple [0, 0, -1]. */
	static readonly FORWARD: readonly [number, number, number] = Object.freeze([0, 0, -1]);
	/** Frozen right-handed backward tuple [0, 0, 1]. */
	static readonly BACK: readonly [number, number, number] = Object.freeze([0, 0, 1]);

	constructor(x: number | ArrayLike<number> = 0, y = 0, z = 0) {
		super(3);
		if (typeof x === "number") {
			this[0] = x;
			this[1] = y;
			this[2] = z;
		} else {
			this[0] = x[0] ?? 0;
			this[1] = x[1] ?? 0;
			this[2] = x[2] ?? 0;
		}
	}

	/** Allocates and initializes a new owned Vec3 instance. */
	static create(x: number | ArrayLike<number> = 0, y = 0, z = 0): Vec3 {
		return new Vec3(x, y, z);
	}

	/** Allocates a new zeroed Vec3 instance. */
	static zero(out: Vec3 = new Vec3()): Vec3 {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		return out;
	}

	/** Allocates a new Vec3 initialized to [1, 1, 1]. */
	static one(out: Vec3 = new Vec3()): Vec3 {
		out[0] = 1;
		out[1] = 1;
		out[2] = 1;
		return out;
	}

	get x(): number { return this[0]; }
	set x(v: number) { this[0] = v; }

	get y(): number { return this[1]; }
	set y(v: number) { this[1] = v; }

	get z(): number { return this[2]; }
	set z(v: number) { this[2] = v; }

	get r(): number { return this[0]; }
	set r(v: number) { this[0] = v; }

	get g(): number { return this[1]; }
	set g(v: number) { this[1] = v; }

	get b(): number { return this[2]; }
	set b(v: number) { this[2] = v; }

	/** Sets the vector components in-place. */
	setComponents(x: number, y: number, z: number): this {
		this[0] = x;
		this[1] = y;
		this[2] = z;
		return this;
	}

	/** Sets all 3 components to the same scalar value. */
	setScalar(s: number): this {
		this[0] = s;
		this[1] = s;
		this[2] = s;
		return this;
	}

	/** Copies values from another 3-component array-like object. */
	copy(v: ArrayLike<number>): this {
		this[0] = v[0];
		this[1] = v[1];
		this[2] = v[2];
		return this;
	}

	/** Creates a new Vec3 initialized with this vector's components. */
	clone(): Vec3 {
		return new Vec3(this[0], this[1], this[2]);
	}

	/** Resets all components to zero. */
	zero(): this {
		this[0] = 0;
		this[1] = 0;
		this[2] = 0;
		return this;
	}

	/** Adds vector b to this vector. */
	add(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.add(this, b, out);
	}

	/** Subtracts vector b from this vector. */
	sub(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.sub(this, b, out);
	}

	/** Multiplies this vector component-wise by vector b. */
	mul(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.mul(this, b, out);
	}

	/** Divides this vector component-wise by vector b. */
	div(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.div(this, b, out);
	}

	/** Multiplies this vector by scalar s. */
	scale(s: number, out: Vec3 = this): Vec3 {
		return Vec3.scale(this, s, out);
	}

	/** Adds vector b scaled by s to this vector. */
	addScaled(b: ArrayLike<number>, s: number, out: Vec3 = this): Vec3 {
		return Vec3.addScaled(this, b, s, out);
	}

	/** Negates all components of this vector. */
	negate(out: Vec3 = this): Vec3 {
		return Vec3.negate(this, out);
	}

	/** Computes component-wise reciprocal (1 / x, 1 / y, 1 / z). */
	inverse(out: Vec3 = this): Vec3 {
		return Vec3.inverse(this, out);
	}

	/** Computes component-wise absolute value. */
	abs(out: Vec3 = this): Vec3 {
		return Vec3.abs(this, out);
	}

	/** Computes component-wise floor. */
	floor(out: Vec3 = this): Vec3 {
		return Vec3.floor(this, out);
	}

	/** Computes component-wise ceiling. */
	ceil(out: Vec3 = this): Vec3 {
		return Vec3.ceil(this, out);
	}

	/** Computes component-wise rounding to nearest integer. */
	round(out: Vec3 = this): Vec3 {
		return Vec3.round(this, out);
	}

	/** Computes component-wise minimum with vector b. */
	min(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.min(this, b, out);
	}

	/** Computes component-wise maximum with vector b. */
	max(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.max(this, b, out);
	}

	/** Clamps components between minVec and maxVec. */
	clamp(minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.clamp(this, minVec, maxVec, out);
	}

	/** Clamps vector magnitude between minLen and maxLen. */
	clampLength(minLen: number, maxLen: number, out: Vec3 = this): Vec3 {
		const x = this[0], y = this[1], z = this[2];
		const sqLen = x * x + y * y + z * z;
		if (sqLen > EPSILON_SQ) {
			const len = Math.sqrt(sqLen);
			const factor = Math.max(minLen, Math.min(maxLen, len)) / len;
			out[0] = x * factor;
			out[1] = y * factor;
			out[2] = z * factor;
		} else {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
		}
		return out;
	}

	/** Computes dot product with vector b. */
	dot(b: ArrayLike<number>): number {
		return Vec3.dot(this, b);
	}

	/** Computes 3D cross product (this x b). */
	cross(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.cross(this, b, out);
	}

	/** Computes Euclidean magnitude of this vector. */
	len(): number {
		return Vec3.len(this);
	}

	/** Computes Euclidean magnitude of this vector. */
	magnitude(): number {
		return Vec3.len(this);
	}

	/** Computes squared Euclidean magnitude of this vector. */
	lengthSq(): number {
		return Vec3.lengthSq(this);
	}

	/** Computes Euclidean distance to vector b. */
	distance(b: ArrayLike<number>): number {
		return Vec3.distance(this, b);
	}

	/** Computes squared Euclidean distance to vector b. */
	distanceSq(b: ArrayLike<number>): number {
		return Vec3.distanceSq(this, b);
	}

	/** Normalizes this vector to unit length. Zero vectors remain [0, 0, 0]. */
	normalize(out: Vec3 = this): Vec3 {
		return Vec3.normalize(this, out);
	}

	/** Linearly interpolates between this vector and b by factor t. */
	lerp(b: ArrayLike<number>, t: number, out: Vec3 = this): Vec3 {
		return Vec3.lerp(this, b, t, out);
	}

	/** Spherically interpolates between this vector and b by factor t. */
	slerp(b: ArrayLike<number>, t: number, out: Vec3 = this): Vec3 {
		return Vec3.slerp(this, b, t, out);
	}

	/** Projects this vector onto target vector b. */
	projectOnVector(b: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.projectOnVector(this, b, out);
	}

	/** Projects this vector onto a plane defined by its normal. */
	projectOnPlane(planeNormal: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.projectOnPlane(this, planeNormal, out);
	}

	/** Reflects this incident vector across a unit normal vector. */
	reflect(normal: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.reflect(this, normal, out);
	}

	/** Computes unsigned angle in radians between this vector and b. */
	angleTo(b: ArrayLike<number>): number {
		return Vec3.angle(this, b);
	}

	/** Rotates this vector around the X-axis relative to origin by rad radians. */
	rotateX(rad: number, origin: ArrayLike<number> = Vec3.ZERO, out: Vec3 = this): Vec3 {
		return Vec3.rotateX(this, origin, rad, out);
	}

	/** Rotates this vector around the Y-axis relative to origin by rad radians. */
	rotateY(rad: number, origin: ArrayLike<number> = Vec3.ZERO, out: Vec3 = this): Vec3 {
		return Vec3.rotateY(this, origin, rad, out);
	}

	/** Rotates this vector around the Z-axis relative to origin by rad radians. */
	rotateZ(rad: number, origin: ArrayLike<number> = Vec3.ZERO, out: Vec3 = this): Vec3 {
		return Vec3.rotateZ(this, origin, rad, out);
	}

	/** Transforms this vector by a column-major 3x3 matrix. */
	transformMat3(m: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.transformMat3(this, m, out);
	}

	/** Transforms this 3D point by a column-major 4x4 matrix with perspective divide (implicitly w = 1). */
	transformMat4(m: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.transformMat4(this, m, out);
	}

	/** Transforms this 3D direction vector by the upper-left 3x3 of a column-major 4x4 matrix (implicitly w = 0). */
	transformMat4Normal(m: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.transformMat4Normal(this, m, out);
	}

	/** Rotates this vector by unit quaternion q [x, y, z, w]. */
	transformQuat(q: ArrayLike<number>, out: Vec3 = this): Vec3 {
		return Vec3.transformQuat(this, q, out);
	}

	/** Checks approximate equality with vector b within tolerance eps. */
	equals(b: ArrayLike<number>, eps = EPSILON): boolean {
		return Vec3.equals(this, b, eps);
	}

	/** Checks strict component equality with vector b. */
	exactEquals(b: ArrayLike<number>): boolean {
		return Vec3.exactEquals(this, b);
	}

	/** Returns true if all components are finite numbers. */
	isFinite(): boolean {
		return Number.isFinite(this[0]) && Number.isFinite(this[1]) && Number.isFinite(this[2]);
	}

	/** Copies components from array starting at offset. */
	fromArray(arr: ArrayLike<number>, offset = 0): this {
		this[0] = arr[offset];
		this[1] = arr[offset + 1];
		this[2] = arr[offset + 2];
		return this;
	}

	/** Writes components into target array starting at offset. */
	toArray<T extends number[] | Float32Array = number[]>(out: T = [] as unknown as T, offset = 0): T {
		out[offset] = this[0];
		out[offset + 1] = this[1];
		out[offset + 2] = this[2];
		return out;
	}

	override toString(): string {
		return `Vec3(${this[0].toFixed(4)}, ${this[1].toFixed(4)}, ${this[2].toFixed(4)})`;
	}

	static add(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax + bx;
		out[1] = ay + by;
		out[2] = az + bz;
		return out;
	}

	static sub(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax - bx;
		out[1] = ay - by;
		out[2] = az - bz;
		return out;
	}

	static mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax * bx;
		out[1] = ay * by;
		out[2] = az * bz;
		return out;
	}

	static div(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax / bx;
		out[1] = ay / by;
		out[2] = az / bz;
		return out;
	}

	static scale(a: ArrayLike<number>, s: number, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = ax * s;
		out[1] = ay * s;
		out[2] = az * s;
		return out;
	}

	static addScaled(a: ArrayLike<number>, b: ArrayLike<number>, s: number, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax + bx * s;
		out[1] = ay + by * s;
		out[2] = az + bz * s;
		return out;
	}

	static negate(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = -ax;
		out[1] = -ay;
		out[2] = -az;
		return out;
	}

	static inverse(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = 1.0 / ax;
		out[1] = 1.0 / ay;
		out[2] = 1.0 / az;
		return out;
	}

	static abs(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = Math.abs(ax);
		out[1] = Math.abs(ay);
		out[2] = Math.abs(az);
		return out;
	}

	static floor(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = Math.floor(ax);
		out[1] = Math.floor(ay);
		out[2] = Math.floor(az);
		return out;
	}

	static ceil(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = Math.ceil(ax);
		out[1] = Math.ceil(ay);
		out[2] = Math.ceil(az);
		return out;
	}

	static round(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		out[0] = Math.round(ax);
		out[1] = Math.round(ay);
		out[2] = Math.round(az);
		return out;
	}

	static min(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = Math.min(ax, bx);
		out[1] = Math.min(ay, by);
		out[2] = Math.min(az, bz);
		return out;
	}

	static max(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = Math.max(ax, bx);
		out[1] = Math.max(ay, by);
		out[2] = Math.max(az, bz);
		return out;
	}

	static clamp(a: ArrayLike<number>, minVec: ArrayLike<number>, maxVec: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const minX = minVec[0], minY = minVec[1], minZ = minVec[2];
		const maxX = maxVec[0], maxY = maxVec[1], maxZ = maxVec[2];
		out[0] = Math.max(minX, Math.min(maxX, ax));
		out[1] = Math.max(minY, Math.min(maxY, ay));
		out[2] = Math.max(minZ, Math.min(maxZ, az));
		return out;
	}

	static dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	}

	static cross(a: ArrayLike<number>, b: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ay * bz - az * by;
		out[1] = az * bx - ax * bz;
		out[2] = ax * by - ay * bx;
		return out;
	}

	static len(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1], a[2]);
	}

	static magnitude(a: ArrayLike<number>): number {
		return Math.hypot(a[0], a[1], a[2]);
	}

	static lengthSq(a: ArrayLike<number>): number {
		return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
	}

	static distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
		return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	}

	static distanceSq(a: ArrayLike<number>, b: ArrayLike<number>): number {
		const dx = a[0] - b[0];
		const dy = a[1] - b[1];
		const dz = a[2] - b[2];
		return dx * dx + dy * dy + dz * dz;
	}

	static normalize(a: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const x = a[0], y = a[1], z = a[2];
		const sqLen = x * x + y * y + z * z;
		if (sqLen > EPSILON_SQ) {
			const invLen = 1.0 / Math.sqrt(sqLen);
			out[0] = x * invLen;
			out[1] = y * invLen;
			out[2] = z * invLen;
		} else {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
		}
		return out;
	}

	static lerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec3 = new Vec3()): Vec3 {
		const ax = a[0], ay = a[1], az = a[2];
		const bx = b[0], by = b[1], bz = b[2];
		out[0] = ax + t * (bx - ax);
		out[1] = ay + t * (by - ay);
		out[2] = az + t * (bz - az);
		return out;
	}

	/**
	 * Spherical linear interpolation between unit-direction vectors `a` and `b`.
	 * When `a` and `b` are exact antipodes (`dot(a, b) === -1`), rotates by `PI` in the plane
	 * spanned by `a` and the coordinate axis least aligned with `a` (ties broken in X, Y, Z order).
	 */
	static slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec3 = new Vec3()): Vec3 {
		let ax = a[0], ay = a[1], az = a[2];
		let bx = b[0], by = b[1], bz = b[2];

		if (t === 0) {
			out[0] = ax;
			out[1] = ay;
			out[2] = az;
			return out;
		}
		if (t === 1) {
			out[0] = bx;
			out[1] = by;
			out[2] = bz;
			return out;
		}

		// Remove Float32 length error before projecting nearly opposite directions.
		const aLen = Math.hypot(ax, ay, az);
		const bLen = Math.hypot(bx, by, bz);
		if (aLen === 0 || bLen === 0) throw new RangeError("Vec3.slerp requires nonzero directions.");
		ax /= aLen;
		ay /= aLen;
		az /= aLen;
		bx /= bLen;
		by /= bLen;
		bz /= bLen;
		const d = Math.max(-1.0, Math.min(1.0, ax * bx + ay * by + az * bz));
		if (d > 0.9995) {
			out[0] = ax + t * (bx - ax);
			out[1] = ay + t * (by - ay);
			out[2] = az + t * (bz - az);
			return Vec3.normalize(out, out);
		}

		let px = bx - d * ax;
		let py = by - d * ay;
		let pz = bz - d * az;
		let pLen = Math.hypot(px, py, pz);
		let angle: number;

		if (pLen > 1e-6) {
			angle = Math.atan2(pLen, d);
		} else {
			// Exact or near-exact antipode: project the coordinate axis least aligned with `a`
			// onto the plane perpendicular to `a` (tie-breaking in X, Y, Z order).
			const absX = Math.abs(ax);
			const absY = Math.abs(ay);
			const absZ = Math.abs(az);
			if (absX <= absY && absX <= absZ) {
				px = 1 - ax * ax;
				py = -ax * ay;
				pz = -ax * az;
			} else if (absY <= absZ) {
				px = -ay * ax;
				py = 1 - ay * ay;
				pz = -ay * az;
			} else {
				px = -az * ax;
				py = -az * ay;
				pz = 1 - az * az;
			}
			pLen = Math.hypot(px, py, pz) || 1;
			angle = Math.PI;
		}

		const invPLen = 1.0 / pLen;
		const ux = px * invPLen;
		const uy = py * invPLen;
		const uz = pz * invPLen;

		const theta = t * angle;
		const ca = Math.cos(theta);
		const sa = Math.sin(theta);

		out[0] = ax * ca + ux * sa;
		out[1] = ay * ca + uy * sa;
		out[2] = az * ca + uz * sa;
		return out;
	}

	static hermite(
		p0: ArrayLike<number>,
		m0: ArrayLike<number>,
		p1: ArrayLike<number>,
		m1: ArrayLike<number>,
		t: number,
		out: Vec3 = new Vec3()
	): Vec3 {
		const t2 = t * t;
		const t3 = t2 * t;
		const h00 = 2 * t3 - 3 * t2 + 1;
		const h10 = t3 - 2 * t2 + t;
		const h01 = -2 * t3 + 3 * t2;
		const h11 = t3 - t2;

		const rx = h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0];
		const ry = h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1];
		const rz = h00 * p0[2] + h10 * m0[2] + h01 * p1[2] + h11 * m1[2];
		out[0] = rx;
		out[1] = ry;
		out[2] = rz;
		return out;
	}

	static bezier(
		p0: ArrayLike<number>,
		p1: ArrayLike<number>,
		p2: ArrayLike<number>,
		p3: ArrayLike<number>,
		t: number,
		out: Vec3 = new Vec3()
	): Vec3 {
		const invT = 1 - t;
		const invT2 = invT * invT;
		const t2 = t * t;
		const b0 = invT2 * invT;
		const b1 = 3 * t * invT2;
		const b2 = 3 * t2 * invT;
		const b3 = t2 * t;

		const rx = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
		const ry = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
		const rz = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2];
		out[0] = rx;
		out[1] = ry;
		out[2] = rz;
		return out;
	}

	static projectOnVector(v: ArrayLike<number>, target: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const vx = v[0], vy = v[1], vz = v[2];
		const tx = target[0], ty = target[1], tz = target[2];
		const sqLen = tx * tx + ty * ty + tz * tz;
		if (sqLen < EPSILON_SQ) {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			return out;
		}
		const s = (vx * tx + vy * ty + vz * tz) / sqLen;
		out[0] = tx * s;
		out[1] = ty * s;
		out[2] = tz * s;
		return out;
	}

	static projectOnPlane(v: ArrayLike<number>, planeNormal: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const vx = v[0], vy = v[1], vz = v[2];
		const nx = planeNormal[0], ny = planeNormal[1], nz = planeNormal[2];
		const sqLen = nx * nx + ny * ny + nz * nz;
		if (sqLen < EPSILON_SQ) {
			out[0] = vx;
			out[1] = vy;
			out[2] = vz;
			return out;
		}
		const s = (vx * nx + vy * ny + vz * nz) / sqLen;
		out[0] = vx - nx * s;
		out[1] = vy - ny * s;
		out[2] = vz - nz * s;
		return out;
	}

	static reflect(v: ArrayLike<number>, normal: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const vx = v[0], vy = v[1], vz = v[2];
		const nx = normal[0], ny = normal[1], nz = normal[2];
		const d = 2 * (vx * nx + vy * ny + vz * nz);
		out[0] = vx - d * nx;
		out[1] = vy - d * ny;
		out[2] = vz - d * nz;
		return out;
	}

	static angle(a: ArrayLike<number>, b: ArrayLike<number>): number {
		const denom = Math.sqrt(Vec3.lengthSq(a) * Vec3.lengthSq(b));
		if (denom < EPSILON) return 0;
		const cosTheta = Math.max(-1.0, Math.min(1.0, Vec3.dot(a, b) / denom));
		return Math.acos(cosTheta);
	}

	static rotateX(a: ArrayLike<number>, origin: ArrayLike<number>, rad: number, out: Vec3 = new Vec3()): Vec3 {
		const ox = origin[0], oy = origin[1], oz = origin[2];
		const px = a[0] - ox;
		const py = a[1] - oy;
		const pz = a[2] - oz;
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		out[0] = px + ox;
		out[1] = py * c - pz * s + oy;
		out[2] = py * s + pz * c + oz;
		return out;
	}

	static rotateY(a: ArrayLike<number>, origin: ArrayLike<number>, rad: number, out: Vec3 = new Vec3()): Vec3 {
		const ox = origin[0], oy = origin[1], oz = origin[2];
		const px = a[0] - ox;
		const py = a[1] - oy;
		const pz = a[2] - oz;
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		out[0] = pz * s + px * c + ox;
		out[1] = py + oy;
		out[2] = pz * c - px * s + oz;
		return out;
	}

	static rotateZ(a: ArrayLike<number>, origin: ArrayLike<number>, rad: number, out: Vec3 = new Vec3()): Vec3 {
		const ox = origin[0], oy = origin[1], oz = origin[2];
		const px = a[0] - ox;
		const py = a[1] - oy;
		const pz = a[2] - oz;
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		out[0] = px * c - py * s + ox;
		out[1] = px * s + py * c + oy;
		out[2] = pz + oz;
		return out;
	}

	static transformMat3(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const x = a[0], y = a[1], z = a[2];
		const m0 = m[0], m1 = m[1], m2 = m[2];
		const m3 = m[3], m4 = m[4], m5 = m[5];
		const m6 = m[6], m7 = m[7], m8 = m[8];
		out[0] = x * m0 + y * m3 + z * m6;
		out[1] = x * m1 + y * m4 + z * m7;
		out[2] = x * m2 + y * m5 + z * m8;
		return out;
	}

	static transformMat4(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const x = a[0], y = a[1], z = a[2];
		const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
		const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
		const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
		const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
		const w = m3 * x + m7 * y + m11 * z + m15;
		const invW = Math.abs(w) > EPSILON ? 1.0 / w : 1.0;
		out[0] = (m0 * x + m4 * y + m8 * z + m12) * invW;
		out[1] = (m1 * x + m5 * y + m9 * z + m13) * invW;
		out[2] = (m2 * x + m6 * y + m10 * z + m14) * invW;
		return out;
	}

	static transformMat4Normal(a: ArrayLike<number>, m: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const x = a[0], y = a[1], z = a[2];
		const m0 = m[0], m1 = m[1], m2 = m[2];
		const m4 = m[4], m5 = m[5], m6 = m[6];
		const m8 = m[8], m9 = m[9], m10 = m[10];
		out[0] = m0 * x + m4 * y + m8 * z;
		out[1] = m1 * x + m5 * y + m9 * z;
		out[2] = m2 * x + m6 * y + m10 * z;
		return out;
	}

	static transformQuat(a: ArrayLike<number>, q: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const vx = a[0], vy = a[1], vz = a[2];
		const qx = q[0], qy = q[1], qz = q[2], qw = q[3];

		const tx = 2.0 * (qy * vz - qz * vy);
		const ty = 2.0 * (qz * vx - qx * vz);
		const tz = 2.0 * (qx * vy - qy * vx);

		out[0] = vx + qw * tx + (qy * tz - qz * ty);
		out[1] = vy + qw * ty + (qz * tx - qx * tz);
		out[2] = vz + qw * tz + (qx * ty - qy * tx);
		return out;
	}

	static equals(a: ArrayLike<number>, b: ArrayLike<number>, eps = EPSILON): boolean {
		return (
			Math.abs(a[0] - b[0]) <= eps &&
			Math.abs(a[1] - b[1]) <= eps &&
			Math.abs(a[2] - b[2]) <= eps
		);
	}

	static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
	}
}
