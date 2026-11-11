import { EPSILON, EPSILON_SQ } from "./constants.js";
import { Vec3 } from "./vec3.js";
import type { Mat4 } from "./mat4.js";

const _v1 = new Vec3();
const _v2 = new Vec3();
const _v3 = new Vec3();

export type ClipDepthRange = "zero-to-one" | "minus-one-to-one";

/**
 * 3D Ray defined by an origin point and a normalized direction vector.
 * Both constructor and set() normalize the direction vector; a zero-length direction remains [0, 0, 0].
 */
export class Ray {
	readonly origin: Vec3;
	readonly direction: Vec3;

	constructor(origin: ArrayLike<number> = Vec3.ZERO, direction: ArrayLike<number> = Vec3.FORWARD) {
		this.origin = new Vec3(origin);
		this.direction = new Vec3(direction).normalize();
	}

	/** Sets ray origin and direction, normalizing direction in-place. */
	set(origin: ArrayLike<number>, direction: ArrayLike<number>): this {
		this.origin.copy(origin);
		this.direction.copy(direction).normalize();
		return this;
	}

	copy(r: Ray): this {
		this.origin.copy(r.origin);
		this.direction.copy(r.direction);
		return this;
	}

	clone(): Ray {
		return new Ray(this.origin, this.direction);
	}

	/** Evaluates P(t) = origin + t * direction. */
	at(t: number, out: Vec3 = new Vec3()): Vec3 {
		out[0] = this.origin[0] + this.direction[0] * t;
		out[1] = this.origin[1] + this.direction[1] * t;
		out[2] = this.origin[2] + this.direction[2] * t;
		return out;
	}

	/**
	 * Intersects this ray with a plane (dot(n, x) + constant = 0).
	 * Returns the non-negative parametric distance t, or null if no forward intersection exists.
	 */
	intersectPlaneDistance(plane: Plane): number | null {
		const dirLenSq = this.direction.lengthSq();
		if (dirLenSq <= EPSILON_SQ || !plane.isValid()) return null;

		const denominator = plane.normal.dot(this.direction);
		if (Math.abs(denominator) <= EPSILON) {
			if (Math.abs(plane.distanceToPoint(this.origin)) <= EPSILON) {
				return 0;
			}
			return null;
		}
		const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
		return t >= 0 ? t : null;
	}

	/** Intersects this ray with a plane and writes the hit point into out. */
	intersectPlane(plane: Plane, out: Vec3 = new Vec3()): Vec3 | null {
		const t = this.intersectPlaneDistance(plane);
		if (t === null) return null;
		return this.at(t, out);
	}

	/**
	 * Intersects this ray with a sphere.
	 * When the ray origin is outside the sphere, returns the entry surface point (t >= 0).
	 * When the ray origin is inside the sphere, returns the forward exit surface point (t >= 0).
	 * Returns null if the ray misses the sphere or has zero direction.
	 */
	intersectSphere(sphere: Sphere, out: Vec3 = new Vec3()): Vec3 | null {
		const a = this.direction.lengthSq();
		if (a <= EPSILON_SQ || sphere.radius < 0) return null;

		const ox = this.origin[0] - sphere.center[0];
		const oy = this.origin[1] - sphere.center[1];
		const oz = this.origin[2] - sphere.center[2];

		const halfB = ox * this.direction[0] + oy * this.direction[1] + oz * this.direction[2];
		const c = ox * ox + oy * oy + oz * oz - sphere.radius * sphere.radius;
		const disc = halfB * halfB - a * c;
		if (disc < 0) return null;

		const sqrtDisc = Math.sqrt(disc);
		let t = (-halfB - sqrtDisc) / a;
		if (t < 0) {
			t = (-halfB + sqrtDisc) / a;
			if (t < 0) return null;
		}
		return this.at(t, out);
	}

	/**
	 * Intersects this ray with an axis-aligned bounding box (Slab method).
	 * When the ray origin is outside the box, returns the entry point (t >= 0).
	 * When the ray origin is inside the box, returns the forward exit point (t >= 0).
	 * Returns null if the box is empty, the ray direction is zero, or no forward hit exists.
	 */
	intersectAABB(aabb: AABB, out: Vec3 = new Vec3()): Vec3 | null {
		if (this.direction.lengthSq() <= EPSILON_SQ || aabb.isEmpty()) return null;

		let tmin = -Infinity;
		let tmax = Infinity;

		for (let i = 0; i < 3; i++) {
			const orig = this.origin[i];
			const dir = this.direction[i];
			const minVal = aabb.min[i];
			const maxVal = aabb.max[i];

			if (Math.abs(dir) <= EPSILON) {
				if (orig < minVal || orig > maxVal) {
					return null;
				}
			} else {
				const invDir = 1.0 / dir;
				let t1 = (minVal - orig) * invDir;
				let t2 = (maxVal - orig) * invDir;
				if (t1 > t2) {
					const tmp = t1;
					t1 = t2;
					t2 = tmp;
				}
				if (t1 > tmin) tmin = t1;
				if (t2 < tmax) tmax = t2;
				if (tmin > tmax) return null;
			}
		}

		if (tmax < 0) return null;
		const t = tmin >= 0 ? tmin : tmax;
		return this.at(t, out);
	}

	/** Transforms this ray by a 4x4 matrix and normalizes the resulting direction. */
	transformMat4(m: ArrayLike<number>): this {
		this.origin.transformMat4(m);
		this.direction.transformMat4Normal(m).normalize();
		return this;
	}
}

/**
 * 3D Plane represented in general form: dot(normal, x) + constant = 0.
 */
export class Plane {
	readonly normal: Vec3;
	constant: number;

	constructor(normal: ArrayLike<number> = Vec3.UP, constant = 0) {
		this.normal = new Vec3(normal);
		this.constant = constant;
	}

	set(normal: ArrayLike<number>, constant: number): this {
		this.normal.copy(normal);
		this.constant = constant;
		return this;
	}

	setComponents(x: number, y: number, z: number, w: number): this {
		this.normal.setComponents(x, y, z);
		this.constant = w;
		return this;
	}

	setFromNormalAndCoplanarPoint(normal: ArrayLike<number>, point: ArrayLike<number>): this {
		this.normal.copy(normal).normalize();
		this.constant = -this.normal.dot(point);
		return this;
	}

	copy(p: Plane): this {
		this.normal.copy(p.normal);
		this.constant = p.constant;
		return this;
	}

	clone(): Plane {
		return new Plane(this.normal, this.constant);
	}

	/** Returns true if the plane normal is non-zero and finite. */
	isValid(): boolean {
		const sq = this.normal.lengthSq();
		return Number.isFinite(sq) && sq > EPSILON_SQ && Number.isFinite(this.constant);
	}

	/** Normalizes the plane normal and scales constant accordingly. Degenerate planes are left unchanged. */
	normalize(): this {
		const len = this.normal.len();
		if (len > EPSILON) {
			const invLen = 1.0 / len;
			this.normal.scale(invLen);
			this.constant *= invLen;
		}
		return this;
	}

	/** Signed distance from point to plane (positive on the side of the normal). */
	distanceToPoint(point: ArrayLike<number>): number {
		return this.normal.dot(point) + this.constant;
	}

	/** Projects point orthogonally onto the plane. */
	projectPoint(point: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		const dist = this.distanceToPoint(point);
		out[0] = point[0] - this.normal[0] * dist;
		out[1] = point[1] - this.normal[1] * dist;
		out[2] = point[2] - this.normal[2] * dist;
		return out;
	}

	/**
	 * Constructs a plane from 3 counter-clockwise points.
	 * Returns null and leaves out unchanged if the points are collinear.
	 */
	static fromPoints(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, out: Plane = new Plane()): Plane | null {
		Vec3.sub(b, a, _v1);
		Vec3.sub(c, a, _v2);
		Vec3.cross(_v1, _v2, _v3);
		const sqLen = _v3.lengthSq();
		if (sqLen <= EPSILON_SQ) {
			return null;
		}
		const invLen = 1.0 / Math.sqrt(sqLen);
		out.normal[0] = _v3[0] * invLen;
		out.normal[1] = _v3[1] * invLen;
		out.normal[2] = _v3[2] * invLen;
		out.constant = -out.normal.dot(a);
		return out;
	}
}

/**
 * 3D Bounding Sphere defined by center and radius.
 */
export class Sphere {
	readonly center: Vec3;
	radius: number;

	constructor(center: ArrayLike<number> = Vec3.ZERO, radius = 0) {
		this.center = new Vec3(center);
		this.radius = radius;
	}

	set(center: ArrayLike<number>, radius: number): this {
		this.center.copy(center);
		this.radius = radius;
		return this;
	}

	copy(s: Sphere): this {
		this.center.copy(s.center);
		this.radius = s.radius;
		return this;
	}

	clone(): Sphere {
		return new Sphere(this.center, this.radius);
	}

	containsPoint(point: ArrayLike<number>): boolean {
		return this.center.distanceSq(point) <= this.radius * this.radius;
	}

	intersectsSphere(s: Sphere): boolean {
		const rSum = this.radius + s.radius;
		return this.center.distanceSq(s.center) <= rSum * rSum;
	}

	intersectsAABB(aabb: AABB): boolean {
		return aabb.intersectsSphere(this);
	}

	/** Transforms this bounding sphere by a 4x4 matrix, scaling radius by maximum axis scale. */
	transform(m: ArrayLike<number>): this {
		this.center.transformMat4(m);
		const sx = Math.hypot(m[0], m[1], m[2]);
		const sy = Math.hypot(m[4], m[5], m[6]);
		const sz = Math.hypot(m[8], m[9], m[10]);
		this.radius *= Math.max(sx, sy, sz);
		return this;
	}
}

/**
 * 3D Axis-Aligned Bounding Box (AABB).
 */
export class AABB {
	readonly min: Vec3;
	readonly max: Vec3;

	constructor(
		min: ArrayLike<number> = [Infinity, Infinity, Infinity],
		max: ArrayLike<number> = [-Infinity, -Infinity, -Infinity]
	) {
		this.min = new Vec3(min);
		this.max = new Vec3(max);
	}

	set(min: ArrayLike<number>, max: ArrayLike<number>): this {
		this.min.copy(min);
		this.max.copy(max);
		return this;
	}

	makeEmpty(): this {
		this.min.setComponents(Infinity, Infinity, Infinity);
		this.max.setComponents(-Infinity, -Infinity, -Infinity);
		return this;
	}

	isEmpty(): boolean {
		return this.max[0] < this.min[0] || this.max[1] < this.min[1] || this.max[2] < this.min[2];
	}

	copy(box: AABB): this {
		this.min.copy(box.min);
		this.max.copy(box.max);
		return this;
	}

	clone(): AABB {
		return new AABB(this.min, this.max);
	}

	expandByPoint(p: ArrayLike<number>): this {
		this.min.min(p);
		this.max.max(p);
		return this;
	}

	expandByScalar(s: number): this {
		this.min[0] -= s; this.min[1] -= s; this.min[2] -= s;
		this.max[0] += s; this.max[1] += s; this.max[2] += s;
		return this;
	}

	union(box: AABB): this {
		if (box.isEmpty()) return this;
		if (this.isEmpty()) return this.copy(box);
		this.min.min(box.min);
		this.max.max(box.max);
		return this;
	}

	getCenter(out: Vec3 = new Vec3()): Vec3 {
		if (this.isEmpty()) return out.zero();
		out[0] = (this.min[0] + this.max[0]) * 0.5;
		out[1] = (this.min[1] + this.max[1]) * 0.5;
		out[2] = (this.min[2] + this.max[2]) * 0.5;
		return out;
	}

	getSize(out: Vec3 = new Vec3()): Vec3 {
		if (this.isEmpty()) return out.zero();
		out[0] = this.max[0] - this.min[0];
		out[1] = this.max[1] - this.min[1];
		out[2] = this.max[2] - this.min[2];
		return out;
	}

	getExtents(out: Vec3 = new Vec3()): Vec3 {
		if (this.isEmpty()) return out.zero();
		out[0] = (this.max[0] - this.min[0]) * 0.5;
		out[1] = (this.max[1] - this.min[1]) * 0.5;
		out[2] = (this.max[2] - this.min[2]) * 0.5;
		return out;
	}

	clampPoint(point: ArrayLike<number>, out: Vec3 = new Vec3()): Vec3 {
		return Vec3.clamp(point, this.min, this.max, out);
	}

	containsPoint(p: ArrayLike<number>): boolean {
		return (
			p[0] >= this.min[0] && p[0] <= this.max[0] &&
			p[1] >= this.min[1] && p[1] <= this.max[1] &&
			p[2] >= this.min[2] && p[2] <= this.max[2]
		);
	}

	containsAABB(box: AABB): boolean {
		return (
			this.min[0] <= box.min[0] && box.max[0] <= this.max[0] &&
			this.min[1] <= box.min[1] && box.max[1] <= this.max[1] &&
			this.min[2] <= box.min[2] && box.max[2] <= this.max[2]
		);
	}

	intersectsAABB(box: AABB): boolean {
		return (
			box.max[0] >= this.min[0] && box.min[0] <= this.max[0] &&
			box.max[1] >= this.min[1] && box.min[1] <= this.max[1] &&
			box.max[2] >= this.min[2] && box.min[2] <= this.max[2]
		);
	}

	intersectsSphere(s: Sphere): boolean {
		if (this.isEmpty()) return false;
		this.clampPoint(s.center, _v1);
		return _v1.distanceSq(s.center) <= s.radius * s.radius;
	}

	/**
	 * Transforms this AABB by a 4x4 affine or projective matrix without heap allocations.
	 */
	transform(m: ArrayLike<number>): this {
		if (this.isEmpty()) return this;

		const minX = this.min[0], minY = this.min[1], minZ = this.min[2];
		const maxX = this.max[0], maxY = this.max[1], maxZ = this.max[2];

		this.makeEmpty();
		for (let i = 0; i < 8; i++) {
			_v1[0] = (i & 1) ? maxX : minX;
			_v1[1] = (i & 2) ? maxY : minY;
			_v1[2] = (i & 4) ? maxZ : minZ;
			_v1.transformMat4(m);
			this.expandByPoint(_v1);
		}
		return this;
	}

	static fromPoints(points: ArrayLike<number>, stride = 3, out: AABB = new AABB()): AABB {
		out.makeEmpty();
		for (let i = 0; i + 2 < points.length; i += stride) {
			_v1[0] = points[i];
			_v1[1] = points[i + 1];
			_v1[2] = points[i + 2];
			out.expandByPoint(_v1);
		}
		return out;
	}
}

/**
 * 6-plane View Frustum with inward-pointing plane normals.
 * Plane order: [Left, Right, Bottom, Top, Near, Far].
 */
export class Frustum {
	readonly planes: [Plane, Plane, Plane, Plane, Plane, Plane];

	constructor() {
		this.planes = [
			new Plane(),
			new Plane(),
			new Plane(),
			new Plane(),
			new Plane(),
			new Plane(),
		];
	}

	/**
	 * Extracts the 6 inward-pointing frustum planes from a view-projection matrix (Gribb-Hartmann method).
	 * @param m Column-major view-projection matrix.
	 * @param depthRange Clip-space Z range: "zero-to-one" for [0, 1] or reversed-Z [1, 0], or "minus-one-to-one" for [-1, 1].
	 */
	fromViewProjection(m: Mat4 | ArrayLike<number>, depthRange: ClipDepthRange = "zero-to-one"): this {
		const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
		const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
		const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
		const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];

		// Left: x >= -w  <=>  x + w >= 0
		this.planes[0].setComponents(m3 + m0, m7 + m4, m11 + m8, m15 + m12).normalize();
		// Right: x <= w  <=>  w - x >= 0
		this.planes[1].setComponents(m3 - m0, m7 - m4, m11 - m8, m15 - m12).normalize();
		// Bottom: y >= -w  <=>  y + w >= 0
		this.planes[2].setComponents(m3 + m1, m7 + m5, m11 + m9, m15 + m13).normalize();
		// Top: y <= w  <=>  w - y >= 0
		this.planes[3].setComponents(m3 - m1, m7 - m5, m11 - m9, m15 - m13).normalize();

		if (depthRange === "minus-one-to-one") {
			// Near: z >= -w  <=>  z + w >= 0
			this.planes[4].setComponents(m3 + m2, m7 + m6, m11 + m10, m15 + m14).normalize();
		} else {
			// Near/Min-Z: z >= 0
			this.planes[4].setComponents(m2, m6, m10, m14).normalize();
		}
		// Far/Max-Z: z <= w  <=>  w - z >= 0
		this.planes[5].setComponents(m3 - m2, m7 - m6, m11 - m10, m15 - m14).normalize();

		return this;
	}

	containsPoint(point: ArrayLike<number>): boolean {
		for (let i = 0; i < 6; i++) {
			if (this.planes[i].distanceToPoint(point) < 0) return false;
		}
		return true;
	}

	intersectsSphere(sphere: Sphere): boolean {
		const negRadius = -sphere.radius;
		for (let i = 0; i < 6; i++) {
			if (this.planes[i].distanceToPoint(sphere.center) < negRadius) {
				return false;
			}
		}
		return true;
	}

	intersectsAABB(aabb: AABB): boolean {
		if (aabb.isEmpty()) return false;
		for (let i = 0; i < 6; i++) {
			const plane = this.planes[i];
			_v1[0] = plane.normal[0] > 0 ? aabb.max[0] : aabb.min[0];
			_v1[1] = plane.normal[1] > 0 ? aabb.max[1] : aabb.min[1];
			_v1[2] = plane.normal[2] > 0 ? aabb.max[2] : aabb.min[2];

			if (plane.distanceToPoint(_v1) < 0) {
				return false;
			}
		}
		return true;
	}
}
