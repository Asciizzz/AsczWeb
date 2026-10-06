import { type Curve } from "../curve.js";

/**
 * Back overshoot curve expanding past 1.0 by specified amount before settling.
 * Expects overshoot tension amount in data bag (defaults to 1.15 if omitted).
 */
export const overshoot: Curve<number> = (t: number, amount = 1.15): number => {
	const c = Math.max(0, Math.min(1, t));
	if (c <= 0) return 0;
	if (c >= 1) return 1;
	const s = amount * 1.70158;
	const p = c - 1;
	return p * p * ((s + 1) * p + s) + 1;
};

/**
 * Multi-stage ground bounce curve.
 */
export const bounce: Curve = (t: number): number => {
	const c = Math.max(0, Math.min(1, t));
	const n1 = 7.5625;
	const d1 = 2.75;

	if (c < 1 / d1) {
		return n1 * c * c;
	}
	if (c < 2 / d1) {
		const p = c - 1.5 / d1;
		return n1 * p * p + 0.75;
	}
	if (c < 2.5 / d1) {
		const p = c - 2.25 / d1;
		return n1 * p * p + 0.9375;
	}
	const p = c - 2.625 / d1;
	return n1 * p * p + 0.984375;
};

/**
 * Exponentially decaying elastic oscillation curve.
 */
export const elastic: Curve = (t: number): number => {
	const c = Math.max(0, Math.min(1, t));
	if (c <= 0) return 0;
	if (c >= 1) return 1;
	return Math.pow(2, -10 * c) * Math.sin((c * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
