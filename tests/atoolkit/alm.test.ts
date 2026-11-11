import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	EPSILON,
	Vec2,
	Vec3,
	Vec4,
	Quat,
	Mat3,
	Mat4,
	Ray,
	Plane,
	Sphere,
	AABB
} from "../../Atoolkit/alm/index.ts";

function assertArrayClose(
	actual: ArrayLike<number>,
	expected: ArrayLike<number>,
	tol = 1e-4,
	msg = ""
): void {
	assert.equal(actual.length, expected.length, `${msg} length mismatch`);
	for (let i = 0; i < expected.length; i++) {
		const diff = Math.abs(actual[i]! - expected[i]!);
		assert.ok(
			diff <= tol,
			`${msg} index ${i}: expected ${expected[i]}, got ${actual[i]} (diff=${diff} > ${tol})`
		);
	}
}

describe("alm - Constructors, Float32Array inheritance, and frozen constants", () => {
	it("constructs Vec2, Vec3, Vec4, Quat, Mat3, Mat4 via new and static create() with intact length", () => {
		const v2 = new Vec2(3, 4);
		assert.ok(v2 instanceof Float32Array);
		assert.ok(v2 instanceof Vec2);
		assert.equal(v2.length, 2);
		assert.equal(v2.len(), 5);
		assert.equal(v2.magnitude(), 5);

		const v3 = Vec3.create(1, 2, 2);
		assert.ok(v3 instanceof Float32Array);
		assert.ok(v3 instanceof Vec3);
		assert.equal(v3.length, 3);
		assert.equal(v3.len(), 3);
		assert.equal(v3.magnitude(), 3);

		const v4 = Vec4.create(2, 0, 0, 0);
		assert.ok(v4 instanceof Float32Array);
		assert.ok(v4 instanceof Vec4);
		assert.equal(v4.length, 4);
		assert.equal(v4.len(), 2);

		const q = Quat.create();
		assert.ok(q instanceof Float32Array);
		assert.ok(q instanceof Quat);
		assert.equal(q.length, 4);
		assertArrayClose(q, [0, 0, 0, 1]);
		assert.equal(q.len(), 1);

		const m3 = Mat3.create();
		assert.ok(m3 instanceof Float32Array);
		assert.ok(m3 instanceof Mat3);
		assert.equal(m3.length, 9);
		assertArrayClose(m3, [1, 0, 0, 0, 1, 0, 0, 0, 1]);

		const m4 = Mat4.create();
		assert.ok(m4 instanceof Float32Array);
		assert.ok(m4 instanceof Mat4);
		assert.equal(m4.length, 16);
		assertArrayClose(m4, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	});

	it("freezes shared constants so they cannot be mutated", () => {
		assert.ok(Object.isFrozen(Vec2.ZERO));
		assert.ok(Object.isFrozen(Vec3.ZERO));
		assert.ok(Object.isFrozen(Vec3.UP));
		assert.ok(Object.isFrozen(Vec4.ZERO));
		assert.ok(Object.isFrozen(Quat.IDENTITY));
		assert.ok(Object.isFrozen(Mat3.IDENTITY));
		assert.ok(Object.isFrozen(Mat4.IDENTITY));

		assert.throws(() => {
			(Vec3.UP as unknown as number[])[1] = 999;
		});
		assert.equal(Vec3.UP[1], 1);
	});
});

describe("alm - In-place aliasing safety", () => {
	it("handles Vec3.min, max, cross, projectOnPlane, transformMat4, transformQuat when out === a or out === b", () => {
		const a = new Vec3(5, -2, 10);
		const b = new Vec3(1, 4, 3);
		a.min(b);
		assertArrayClose(a, [1, -2, 3]);

		const c = new Vec3(5, -2, 10);
		c.max(b);
		assertArrayClose(c, [5, 4, 10]);

		const u = new Vec3(1, 0, 0);
		const v = new Vec3(0, 1, 0);
		Vec3.cross(u, v, u);
		assertArrayClose(u, [0, 0, 1]);

		const p = new Vec3(3, 4, 5);
		const n = new Vec3(0, 1, 0);
		Vec3.projectOnPlane(p, n, p);
		assertArrayClose(p, [3, 0, 5]);

		const p2 = new Vec3(3, 4, 5);
		const n2 = new Vec3(0, 1, 0);
		Vec3.projectOnPlane(p2, n2, n2);
		assertArrayClose(n2, [3, 0, 5]);
	});

	it("handles Mat3.transpose, mul, rotate2D, scale2D, translate2D for aliased and non-aliased outputs", () => {
		const m = new Mat3([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		Mat3.transpose(m, m);
		assertArrayClose(m, [1, 4, 7, 2, 5, 8, 3, 6, 9]);

		const dirtyOut = new Mat3([9, 9, 9, 9, 9, 9, 9, 9, 9]);
		const id = new Mat3();
		Mat3.translate2D(id, [10, 20], dirtyOut);
		assertArrayClose(dirtyOut, [1, 0, 0, 0, 1, 0, 10, 20, 1]);

		dirtyOut.fill(9);
		Mat3.scale2D(id, [2, 3], dirtyOut);
		assertArrayClose(dirtyOut, [2, 0, 0, 0, 3, 0, 0, 0, 1]);

		dirtyOut.fill(9);
		Mat3.rotate2D(id, Math.PI * 0.5, dirtyOut);
		assertArrayClose(dirtyOut, [0, 1, 0, -1, 0, 0, 0, 0, 1]);
	});
});

describe("alm - Normal matrix and singular inverse handling", () => {
	it("computes true inverse-transpose normalMatrix for non-uniform scaling and strips translation", () => {
		const q = Quat.fromAxisAngle([0, 0, 1], Math.PI / 4);
		const model = Mat4.fromTRS([10, -20, 30], q, [2, 0.5, 4]);

		const nm3 = new Mat3();
		const res3 = Mat3.normalMatrix(model, nm3);
		assert.equal(res3, nm3);

		const nm4 = new Mat4();
		const res4 = Mat4.normalMatrix(model, nm4);
		assert.equal(res4, nm4);

		// Verify 4th row and column of Mat4.normalMatrix are identity (no translation leak)
		assert.equal(nm4[3], 0);
		assert.equal(nm4[7], 0);
		assert.equal(nm4[11], 0);
		assert.equal(nm4[12], 0);
		assert.equal(nm4[13], 0);
		assert.equal(nm4[14], 0);
		assert.equal(nm4[15], 1);

		// Verify normal transformation preserves perpendicularity to tangent vectors under non-uniform scale
		const localTangent = new Vec3(1, 1, 0).normalize();
		const localNormal = new Vec3(-1, 1, 0).normalize();
		assert.ok(Math.abs(Vec3.dot(localTangent, localNormal)) < 1e-6);

		const worldTangent = Vec3.transformMat4Normal(localTangent, model, new Vec3());
		const worldNormal = Vec3.transformMat3(localNormal, nm3, new Vec3()).normalize();
		assert.ok(
			Math.abs(Vec3.dot(worldTangent, worldNormal)) < 1e-5,
			`Expected perpendicular world tangent and transformed normal, got dot=${Vec3.dot(worldTangent, worldNormal)}`
		);
	});

	it("returns null and leaves out untouched when inverting or computing normalMatrix of singular matrices", () => {
		const singular4 = new Mat4([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const out4 = new Mat4();
		const sentinel4 = Array.from(out4);

		assert.equal(Mat4.invert(singular4, out4), null);
		assertArrayClose(out4, sentinel4);

		assert.equal(Mat4.normalMatrix(singular4, out4), null);
		assertArrayClose(out4, sentinel4);

		const singular3 = new Mat3([1, 0, 0, 0, 0, 0, 0, 0, 1]);
		const out3 = new Mat3();
		const sentinel3 = Array.from(out3);

		assert.equal(Mat3.invert(singular3, out3), null);
		assertArrayClose(out3, sentinel3);

		assert.equal(Mat3.normalMatrix(singular4, out3), null);
		assertArrayClose(out3, sentinel3);
	});
});

describe("alm - Quaternion rotation round-trips and TRS decomposition", () => {
	it("round-trips 128 unit quaternions through Mat3, Mat4, getRotation, and decompose", () => {
		let seed = 0x12345678;
		const nextRand = (): number => {
			seed = (seed * 1664525 + 1013904223) | 0;
			return ((seed >>> 0) / 0xffffffff) * 2 - 1;
		};

		const m3 = new Mat3();
		const m4 = new Mat4();
		const qFromM3 = new Quat();
		const qFromM4 = new Quat();
		const qGetRot = new Quat();
		const decPos = new Vec3();
		const decQuat = new Quat();
		const decScale = new Vec3();

		for (let i = 0; i < 128; i++) {
			const axis = new Vec3(nextRand(), nextRand(), nextRand());
			if (axis.lengthSq() < 1e-4) axis.setComponents(0, 1, 0);
			axis.normalize();
			const angle = nextRand() * Math.PI;

			const q = Quat.fromAxisAngle(axis, angle);
			Mat3.fromQuat(q, m3);
			Quat.fromMat3(m3, qFromM3);
			assert.ok(
				Quat.rotationEquals(q, qFromM3, 1e-4),
				`Mat3 round-trip failed at iteration ${i}`
			);

			const pos = new Vec3(nextRand() * 50, nextRand() * 50, nextRand() * 50);
			const scale = new Vec3(
				0.2 + Math.abs(nextRand()) * 3,
				0.2 + Math.abs(nextRand()) * 3,
				0.2 + Math.abs(nextRand()) * 3
			);

			Mat4.fromTRS(pos, q, scale, m4);
			Mat4.getRotation(m4, qGetRot);
			assert.ok(
				Quat.rotationEquals(q, qGetRot, 1e-4),
				`Mat4.getRotation failed at iteration ${i}`
			);

			const ok = Mat4.decompose(m4, decPos, decQuat, decScale);
			assert.equal(ok, true);
			assertArrayClose(decPos, pos, 1e-4);
			assertArrayClose(decScale, scale, 1e-4);
			assert.ok(
				Quat.rotationEquals(q, decQuat, 1e-4),
				`Mat4.decompose rotation failed at iteration ${i}`
			);

			Mat4.fromQuat(q, m4);
			Quat.fromMat4(m4, qFromM4);
			assert.ok(
				Quat.rotationEquals(q, qFromM4, 1e-4),
				`Mat4.fromQuat -> Quat.fromMat4 failed at iteration ${i}`
			);
		}
	});
});

describe("alm - Projection depth conventions and spatial intersection invariants", () => {
	it("maps near and far clip planes accurately for ZO, NO, and ReversedZ projections", () => {
		const near = 0.5;
		const far = 100.0;
		const fovy = Math.PI / 3;
		const aspect = 16 / 9;

		const pZO = Mat4.perspectiveZO(fovy, aspect, near, far);
		const nearZO = Vec3.transformMat4([0, 0, -near], pZO);
		const farZO = Vec3.transformMat4([0, 0, -far], pZO);
		assert.ok(Math.abs(nearZO[2]! - 0.0) < 1e-5);
		assert.ok(Math.abs(farZO[2]! - 1.0) < 1e-5);

		const pNO = Mat4.perspectiveNO(fovy, aspect, near, far);
		const nearNO = Vec3.transformMat4([0, 0, -near], pNO);
		const farNO = Vec3.transformMat4([0, 0, -far], pNO);
		assert.ok(Math.abs(nearNO[2]! - -1.0) < 1e-5);
		assert.ok(Math.abs(farNO[2]! - 1.0) < 1e-5);

		const pRev = Mat4.perspectiveReversedZ(fovy, aspect, near, far);
		const nearRev = Vec3.transformMat4([0, 0, -near], pRev);
		const farRev = Vec3.transformMat4([0, 0, -far], pRev);
		assert.ok(Math.abs(nearRev[2]! - 1.0) < 1e-5);
		assert.ok(Math.abs(farRev[2]! - 0.0) < 1e-5);
	});

	it("handles boundary-parallel rays on AABB without NaN and inside-volume rays", () => {
		const box = new AABB(new Vec3(-1, -1, -1), new Vec3(1, 1, 1));

		// Ray lying directly on the x = 1 slab boundary and parallel to the YZ plane
		const boundaryRay = new Ray(new Vec3(1, 0, -5), new Vec3(0, 0, 1));
		const hitBoundary = boundaryRay.intersectAABB(box);
		assert.notEqual(hitBoundary, null);
		assertArrayClose(hitBoundary!, [1, 0, -1]);

		// Parallel ray outside slab x = 2 must miss cleanly (null, never NaN)
		const outsideParallelRay = new Ray(new Vec3(2, 0, -5), new Vec3(0, 0, 1));
		assert.equal(outsideParallelRay.intersectAABB(box), null);

		// Ray originating inside AABB and Sphere returns forward exit point (t >= 0)
		const insideRay = new Ray(new Vec3(0, 0, 0), new Vec3(0, 0, 1));
		const hitBoxInside = insideRay.intersectAABB(box);
		assert.notEqual(hitBoxInside, null);
		assertArrayClose(hitBoxInside!, [0, 0, 1]);

		const sphere = new Sphere(new Vec3(0, 0, 0), 2);
		const hitSphereInside = insideRay.intersectSphere(sphere);
		assert.notEqual(hitSphereInside, null);
		assertArrayClose(hitSphereInside!, [0, 0, 2]);

		// Ray.set normalizes non-unit direction
		const nonUnitRay = new Ray();
		nonUnitRay.set(new Vec3(0, 0, -10), new Vec3(0, 0, 5));
		assert.ok(Math.abs(nonUnitRay.direction.len() - 1) < EPSILON);
		const hitSphereEntry = nonUnitRay.intersectSphere(sphere);
		assert.notEqual(hitSphereEntry, null);
		assertArrayClose(hitSphereEntry!, [0, 0, -2]);

		// Collinear Plane.fromPoints returns null
		const plane = new Plane();
		assert.equal(
			Plane.fromPoints([0, 0, 0], [1, 1, 1], [2, 2, 2], plane),
			null
		);
	});
});

describe("alm - Vec3.slerp antipodal, near-antipodal, near-parallel, and aliased unit-vector interpolation", () => {
	it("produces unit-length finite vectors with exact angular progress across antipodal and general pairs", () => {
		const pairs: Array<[Vec3, Vec3]> = [
			[new Vec3(1, 0, 0), new Vec3(-1, 0, 0)],
			[new Vec3(0, 1, 0), new Vec3(0, -1, 0)],
			[new Vec3(0, 0, 1), new Vec3(0, 0, -1)],
			[
				new Vec3(1, 2, -3).normalize(),
				new Vec3(-1, -2, 3).normalize()
			]
		];

		// Perturbed near-antipodes at dot = -0.9994, -0.9999, -0.9999999
		for (const targetDot of [-0.9994, -0.9999, -0.9999999]) {
			const sinVal = Math.sqrt(Math.max(0, 1 - targetDot * targetDot));
			pairs.push([
				new Vec3(1, 0, 0),
				new Vec3(targetDot, sinVal, 0).normalize()
			]);
		}

		// Near-parallel pair (dot > 0.9995) and general 90-degree pair
		pairs.push([
			new Vec3(1, 0, 0),
			new Vec3(0.9998, Math.sqrt(1 - 0.9998 * 0.9998), 0).normalize()
		]);
		pairs.push([new Vec3(1, 0, 0), new Vec3(0, 1, 0)]);

		for (const [a, b] of pairs) {
			const d = Math.max(-1, Math.min(1, Vec3.dot(a, b)));
			const totalAngle = Math.acos(d);

			// Endpoints t = 0 and t = 1
			assertArrayClose(Vec3.slerp(a, b, 0), a, 1e-6);
			assertArrayClose(Vec3.slerp(a, b, 1), b, 1e-6);

			for (const t of [0.25, 0.5, 0.75]) {
				const p = Vec3.slerp(a, b, t);
				const pRepeat = Vec3.slerp(a, b, t);
				assertArrayClose(p, pRepeat, 0);
				assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]));
				assert.ok(
					Math.abs(p.len() - 1) <= 1e-5,
					`Expected unit length at t=${t}, got ${p.len()}`
				);

				const actualDot = Vec3.dot(a, p);
				const expectedDot = Math.cos(t * totalAngle);
				assert.ok(
					Math.abs(actualDot - expectedDot) <= 1e-4,
					`Angular progress mismatch at t=${t}: expected cos=${expectedDot}, got ${actualDot}`
				);
			}

			// Exact antipode midpoint perpendicularity
			if (Math.abs(d + 1) < 1e-7) {
				const mid = Vec3.slerp(a, b, 0.5);
				assert.ok(Math.abs(Vec3.dot(a, mid)) <= 1e-5);
			}

			// Aliased out === a and out === b
			const expectedMid = Vec3.slerp(a, b, 0.5);
			const aliasA = a.clone();
			Vec3.slerp(aliasA, b, 0.5, aliasA);
			assertArrayClose(aliasA, expectedMid, 1e-6);

			const aliasB = b.clone();
			Vec3.slerp(a, aliasB, 0.5, aliasB);
			assertArrayClose(aliasB, expectedMid, 1e-6);
		}
	});
});

it("follows the short arc for oblique near-antipodes stored as Float32", () => {
	const a = Vec3.normalize([3, 2, 3]);
	const b = Vec3.normalize([-a[0], -a[1] + 1.2e-6, -a[2]]);
	const midpoint = Vec3.slerp(a, b, 0.5);
	assert.ok(Math.abs(Vec3.dot(a, midpoint)) < 1e-5);
	assert.ok(midpoint[1] > 0);
	assert.ok(Math.abs(Math.hypot(...midpoint) - 1) < 1e-6);
});
