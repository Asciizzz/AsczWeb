import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	Cadence,
	FixedCadence,
	Spring,
	Clip,
	FloatTrack,
	QuatTrack,
	ColorTrack,
	ColorSpace,
	BezierCurve,
	bezier,
	step,
} from "../../Atoolkit/atempo/index.ts";

describe("atempo - Cadence, FixedCadence, and Spring time-step guards", () => {
	it("rejects negative or non-finite dt and treats dt = 0 as a deterministic no-op", () => {
		const vel: [number] = [12.5];
		assert.equal(Cadence.damp(10, 20, 0.2, Infinity, 0, vel), 10);
		assert.equal(vel[0], 12.5);

		assert.throws(() => Cadence.damp(10, 20, 0.2, Infinity, -0.016, vel), RangeError);
		assert.throws(() => Cadence.damp(10, 20, 0.2, Infinity, Number.NaN, vel), RangeError);
		assert.throws(() => Cadence.expDecay(10, 20, 5, -1), RangeError);

		const spring = new Spring(10, 0.8);
		const state: [number, number] = [5, -3];
		spring.updateScalar(5, -3, 10, 0, state);
		assert.deepEqual(state, [5, -3]);
		assert.throws(() => spring.updateScalar(0, 0, 1, -0.1), RangeError);
		assert.throws(() => spring.updateScalar(0, 0, 1, Number.POSITIVE_INFINITY), RangeError);

		const fixedDrop = new FixedCadence(0.1, 2, "drop");
		assert.throws(() => fixedDrop.update(-0.1, () => {}), RangeError);
		const rDrop = fixedDrop.update(0.35, () => {});
		assert.equal(rDrop.stepsTaken, 2);
		assert.equal(fixedDrop.accumulator, 0);

		const fixedRetain = new FixedCadence(0.1, 2, "retain");
		const rRetain = fixedRetain.update(0.35, () => {});
		assert.equal(rRetain.stepsTaken, 2);
		assert.ok(Math.abs(fixedRetain.accumulator - 0.15) < 1e-6);
	});
});

describe("atempo - Clip marker crossing semantics", () => {
	it("emits half-open intervals without double-firing on boundaries or reversed playback", () => {
		const clip = new Clip("TestClip");
		clip.addMarker(0.0, "start");
		clip.addMarker(0.5, "midA");
		clip.addMarker(0.5, "midB");
		clip.addMarker(1.0, "end");

		// Zero delta emits nothing
		assert.deepEqual(
			clip.sampleCrossedMarkers(0.5, 0.5).map((m) => m.name),
			[]
		);

		// Forward [0 -> 0.5] and [0.5 -> 1.0]: (prev, curr]
		const fwd1 = clip.sampleCrossedMarkers(0.0, 0.5).map((m) => m.name);
		const fwd2 = clip.sampleCrossedMarkers(0.5, 1.0).map((m) => m.name);
		assert.deepEqual(fwd1, ["midA", "midB"]);
		assert.deepEqual(fwd2, ["end"]);

		// Reverse [1.0 -> 0.5] and [0.5 -> 0.0]: [curr, prev) in descending timestamp order,
		// preserving insertion order for identical timestamps
		const rev1 = clip.sampleCrossedMarkers(1.0, 0.5).map((m) => m.name);
		const rev2 = clip.sampleCrossedMarkers(0.5, 0.0).map((m) => m.name);
		assert.deepEqual(rev1, ["midA", "midB"]);
		assert.deepEqual(rev2, ["start"]);
	});
});

describe("atempo - Track keyframe replacement, boundary consistency, and Bezier fallback", () => {
	it("replaces duplicate timestamps in-place and matches cached vs binary-searched intervals", () => {
		const track = new FloatTrack();
		track.addKey(0, 0, step, 1);
		track.addKey(1, 10, step, 1);
		track.addKey(1, 20, step, 1); // Replaces value at t = 1
		track.addKey(2, 30, step, 1);

		assert.equal(track.keyCount, 3);
		assert.equal(track.sample(1.0), 20);

		// Prime cache to interval [0, 1), then sample at exact boundary t = 1.0
		track.sample(0.25);
		const fromCached = track.sample(1.0);
		// Jump to t = 2.0 then binary search back to t = 1.0
		track.sample(2.0);
		const fromBinarySearch = track.sample(1.0);
		assert.equal(fromCached, 20);
		assert.equal(fromBinarySearch, 20);
	});

	it("converges monotonically on steep and flat-tangent cubic Bezier curves via bisection fallback", () => {
		const steepCurve = new BezierCurve(0.99, 0.0, 1.0, 0.01);
		const flatStartEnd = new BezierCurve(0.0, 0.99, 1.0, 0.01);

		let prev1 = 0;
		let prev2 = 0;
		for (let i = 0; i <= 100; i++) {
			const u = i / 100;
			const y1 = steepCurve.evaluate(u);
			const y2 = flatStartEnd.evaluate(u);
			const y3 = bezier(u, [0.99, 0.0, 1.0, 0.01]);

			assert.ok(Number.isFinite(y1) && y1 >= -1e-6 && y1 <= 1 + 1e-6);
			assert.ok(Number.isFinite(y2) && y2 >= -1e-6 && y2 <= 1 + 1e-6);
			assert.ok(Math.abs(y1 - y3) < 1e-6);
			assert.ok(y1 >= prev1 - 1e-5, `Non-monotonic at u=${u}: ${y1} < ${prev1}`);
			assert.ok(y2 >= prev2 - 1e-5, `Non-monotonic at u=${u}: ${y2} < ${prev2}`);
			prev1 = y1;
			prev2 = y2;
		}
	});

	it("interpolates QuatTrack along shortest arc and ColorTrack with ApproxGamma2", () => {
		const qt = new QuatTrack();
		qt.addKey(0, [0, 0, 0, 1]);
		qt.addKey(1, [0, 0, 0, -1]); // Antipodal representation of identity rotation
		const midQ = qt.sample(0.5);
		assert.ok(Math.abs(Math.hypot(midQ[0], midQ[1], midQ[2], midQ[3]) - 1) < 1e-5);

		const ct = new ColorTrack({ dimension: 4, colorSpace: ColorSpace.ApproxGamma2 });
		ct.addKey(0, [1, 0, 0, 0]);
		ct.addKey(1, [0, 1, 0, 1]);
		const midCol = ct.sample(0.5);
		assert.ok(Math.abs(midCol[0] - Math.SQRT1_2) < 1e-5);
		assert.ok(Math.abs(midCol[1] - Math.SQRT1_2) < 1e-5);
		assert.ok(Math.abs(midCol[3] - 0.5) < 1e-5);
	});

	it("computes Track.duration as endTime - startTime, aligns sampleRatio with [startTime, endTime], and preserves Clip.duration policy", () => {
		const cases: Array<{ times: number[]; expectedDuration: number }> = [
			{ times: [], expectedDuration: 0 },
			{ times: [5], expectedDuration: 0 },
			{ times: [3, 5], expectedDuration: 2 },
			{ times: [-5, -3], expectedDuration: 2 },
			{ times: [-3, 5], expectedDuration: 8 },
			{ times: [0, 5], expectedDuration: 5 }
		];

		for (const c of cases) {
			const t = new FloatTrack();
			for (let i = 0; i < c.times.length; i++) {
				t.addKey(c.times[i]!, i * 10);
			}
			assert.equal(t.duration, c.expectedDuration, `Failed for times [${c.times.join(", ")}]`);
		}

		// sampleRatio on [3, 5] maps 0 -> t=3, 0.5 -> t=4, 1 -> t=5
		const delayedTrack = new FloatTrack();
		delayedTrack.addKey(3, 10);
		delayedTrack.addKey(5, 20);
		assert.equal(delayedTrack.startTime, 3);
		assert.equal(delayedTrack.endTime, 5);
		assert.equal(delayedTrack.duration, 2);
		assert.ok(Math.abs(delayedTrack.sampleRatio(0) - 10) < 1e-6);
		assert.ok(Math.abs(delayedTrack.sampleRatio(0.5) - 15) < 1e-6);
		assert.ok(Math.abs(delayedTrack.sampleRatio(1) - 20) < 1e-6);

		// Key removal updates duration to the remaining span
		delayedTrack.addKey(9, 40);
		assert.equal(delayedTrack.duration, 6);
		delayedTrack.removeKeyAt(2);
		assert.equal(delayedTrack.duration, 2);
		delayedTrack.removeKeyAt(1);
		assert.equal(delayedTrack.duration, 0);
		delayedTrack.removeKeyAt(0);
		assert.equal(delayedTrack.duration, 0);

		// Clip.duration continues to reflect clip timeline policy: max(endTime) - min(0, min(startTime))
		const clipPositive = new Clip("DelayedClip");
		const trPos = new FloatTrack();
		trPos.addKey(3, 10);
		trPos.addKey(5, 20);
		clipPositive.addTrack("delayed", trPos);
		assert.equal(trPos.duration, 2);
		assert.equal(clipPositive.duration, 5);

		const clipNegative = new Clip("NegativeStartClip");
		const trNeg = new FloatTrack();
		trNeg.addKey(-3, 0);
		trNeg.addKey(5, 10);
		clipNegative.addTrack("neg", trNeg);
		assert.equal(trNeg.duration, 8);
		assert.equal(clipNegative.duration, 8);
	});
});
