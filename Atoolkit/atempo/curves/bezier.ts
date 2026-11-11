import type { CurveFunction, CurveObject } from "../curve.js";

export type BezierData =
	| readonly [x1: number, y1: number, x2: number, y2: number]
	| { x1: number; y1: number; x2: number; y2: number };

function sampleBezierAxis(c1: number, c2: number, t: number): number {
	const c = 3.0 * c1;
	const b = 3.0 * (c2 - c1) - c;
	const a = 1.0 - c - b;
	return ((a * t + b) * t + c) * t;
}

function sampleBezierDerivative(c1: number, c2: number, t: number): number {
	const c = 3.0 * c1;
	const b = 3.0 * (c2 - c1) - c;
	const a = 1.0 - c - b;
	return (3.0 * a * t + 2.0 * b) * t + c;
}

/**
 * Solves 1D cubic Bezier easing Y(X^-1(u)) with endpoints (0, 0) and (1, 1).
 * Uses Newton-Raphson iteration with bounded 20-step bisection fallback whenever
 * Newton leaves [0, 1], encounters a near-zero derivative, or finishes with residual > 1e-5.
 */
export function evaluateCubicBezier(
	u: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number
): number {
	if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
		throw new RangeError("Bezier control points must be finite numbers.");
	}
	if (u <= 0) return 0;
	if (u >= 1) return 1;

	const cx1 = Math.max(0, Math.min(1, x1));
	const cx2 = Math.max(0, Math.min(1, x2));
	if (cx1 === y1 && cx2 === y2) return u;

	let t = u;
	for (let i = 0; i < 6; i++) {
		const err = sampleBezierAxis(cx1, cx2, t) - u;
		if (Math.abs(err) <= 1e-6) {
			return sampleBezierAxis(y1, y2, t);
		}
		const slope = sampleBezierDerivative(cx1, cx2, t);
		if (Math.abs(slope) <= 1e-6) {
			break;
		}
		t -= err / slope;
		if (t < 0.0 || t > 1.0) {
			break;
		}
	}

	if (t < 0.0 || t > 1.0 || Math.abs(sampleBezierAxis(cx1, cx2, t) - u) > 1e-5) {
		let t0 = 0.0;
		let t1 = 1.0;
		t = u;
		for (let i = 0; i < 20; i++) {
			const err = sampleBezierAxis(cx1, cx2, t) - u;
			if (Math.abs(err) <= 1e-6) {
				break;
			}
			if (err < 0.0) {
				t0 = t;
			} else {
				t1 = t;
			}
			t = 0.5 * (t0 + t1);
		}
	}

	return sampleBezierAxis(y1, y2, t);
}

/**
 * Stateless cubic Bezier curve evaluator accepting control points in `data`
 * (defaults to `[0.25, 0.1, 0.25, 1.0]` when omitted).
 */
export const bezier: CurveFunction<BezierData> = (t: number, data?: BezierData): number => {
	let x1 = 0.25;
	let y1 = 0.1;
	let x2 = 0.25;
	let y2 = 1.0;

	if (Array.isArray(data)) {
		x1 = data[0];
		y1 = data[1];
		x2 = data[2];
		y2 = data[3];
	} else if (data && typeof data === "object") {
		const obj = data as { x1: number; y1: number; x2: number; y2: number };
		x1 = obj.x1;
		y1 = obj.y1;
		x2 = obj.x2;
		y2 = obj.y2;
	}

	return evaluateCubicBezier(t, x1, y1, x2, y2);
};

/**
 * 1D Cubic Bezier easing curve defined by control points P1(x1, y1) and P2(x2, y2),
 * with fixed endpoints P0(0, 0) and P3(1, 1).
 */
export class BezierCurve implements CurveObject {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;

	constructor(x1: number, y1: number, x2: number, y2: number) {
		if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
			throw new RangeError("BezierCurve control points must be finite numbers.");
		}
		this.x1 = Math.max(0, Math.min(1, x1));
		this.y1 = y1;
		this.x2 = Math.max(0, Math.min(1, x2));
		this.y2 = y2;
	}

	evaluate(u: number): number {
		return evaluateCubicBezier(u, this.x1, this.y1, this.x2, this.y2);
	}

	static readonly Ease = new BezierCurve(0.25, 0.1, 0.25, 1.0);
	static readonly EaseIn = new BezierCurve(0.42, 0.0, 1.0, 1.0);
	static readonly EaseOut = new BezierCurve(0.0, 0.0, 0.58, 1.0);
	static readonly EaseInOut = new BezierCurve(0.42, 0.0, 0.58, 1.0);
}
