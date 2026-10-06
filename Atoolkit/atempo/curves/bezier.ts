import { type Curve } from "../curve.js";

export type BezierData = [x1: number, y1: number, x2: number, y2: number] | ArrayLike<number>;

/**
 * Evaluates cubic Bezier curve from control points (x1, y1) and (x2, y2).
 * Solves parametric polynomial via Newton-Raphson with bisection fallback.
 * Reads control points from data bag [x1, y1, x2, y2]. Defaults to linear when data is omitted.
 */
export const bezier: Curve<BezierData> = (t: number, data?: BezierData): number => {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	if (!data) return t;

	const x1 = data[0];
	const y1 = data[1];
	const x2 = data[2];
	const y2 = data[3];

	const cx1 = Math.max(0, Math.min(1, x1));
	const cx2 = Math.max(0, Math.min(1, x2));

	const ax = 1 - 3 * cx2 + 3 * cx1;
	const bx = 3 * cx2 - 6 * cx1;
	const cx = 3 * cx1;

	const ay = 1 - 3 * y2 + 3 * y1;
	const by = 3 * y2 - 6 * y1;
	const cy = 3 * y1;

	let u = t;
	for (let i = 0; i < 8; i++) {
		const currentX = ((ax * u + bx) * u + cx) * u - t;
		if (Math.abs(currentX) < 1e-6) break;
		const dX = (3 * ax * u + 2 * bx) * u + cx;
		if (Math.abs(dX) < 1e-6) break;
		u -= currentX / dX;
	}

	if (u < 0 || u > 1) {
		let low = 0;
		let high = 1;
		u = t;
		while (low < high) {
			const currentX = ((ax * u + bx) * u + cx) * u;
			if (Math.abs(currentX - t) < 1e-6) break;
			if (t > currentX) {
				low = u;
			} else {
				high = u;
			}
			u = (high + low) * 0.5;
		}
	}

	return ((ay * u + by) * u + cy) * u;
};
