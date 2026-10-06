import { type Curve } from "../curve.js";

/**
 * Staircase quantization curve mapping [0, 1] into discrete steps.
 * Expects step count in data bag (defaults to 4 if omitted).
 */
export const step: Curve<number> = (t: number, steps = 4): number => {
	const s = Math.max(1, Math.floor(steps));
	const clamped = Math.max(0, Math.min(1, t));
	return Math.floor(clamped * s) / s;
};

export type HoldSnapData =
	| [holdFraction?: number, overshoot?: number]
	| { holdFraction?: number; overshoot?: number };

/**
 * Hold threshold and snap curve.
 * Threshold and overshoot values provided via data bag. Defaults to [0.5, 1.1] when omitted.
 */
export const holdSnap: Curve<HoldSnapData> = (t: number, data?: HoldSnapData): number => {
	let holdFraction = 0.5;
	let over = 1.1;

	if (Array.isArray(data)) {
		if (data[0] !== undefined) holdFraction = data[0];
		if (data[1] !== undefined) over = data[1];
	} else if (data && typeof data === "object") {
		if (data.holdFraction !== undefined) holdFraction = data.holdFraction;
		if (data.overshoot !== undefined) over = data.overshoot;
	}

	const c = Math.max(0, Math.min(1, t));
	if (c < holdFraction) return 0;
	const norm = (c - holdFraction) / (1 - holdFraction);
	if (norm < 0.25) return over;
	return 1.0;
};
