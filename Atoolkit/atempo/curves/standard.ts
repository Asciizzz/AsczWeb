import { type Curve } from "../curve.js";

/**
 * Identity linear progress curve.
 */
export const linear: Curve = (t: number): number => t;

/**
 * Quadratic ease-in curve.
 */
export const quadIn: Curve = (t: number): number => t * t;

/**
 * Quadratic ease-out curve.
 */
export const quadOut: Curve = (t: number): number => t * (2 - t);

/**
 * Quadratic ease-in-out curve.
 */
export const quadInOut: Curve = (t: number): number =>
	t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/**
 * Cubic ease-in curve.
 */
export const cubicIn: Curve = (t: number): number => t * t * t;

/**
 * Cubic ease-out curve.
 */
export const cubicOut: Curve = (t: number): number => {
	const p = t - 1;
	return p * p * p + 1;
};

/**
 * Cubic ease-in-out curve.
 */
export const cubicInOut: Curve = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

/**
 * Exponential ease-in curve.
 */
export const expoIn: Curve = (t: number): number =>
	t <= 0 ? 0 : Math.pow(2, 10 * (t - 1));

/**
 * Exponential ease-out curve.
 */
export const expoOut: Curve = (t: number): number =>
	t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);

/**
 * Exponential ease-in-out curve.
 */
export const expoInOut: Curve = (t: number): number => {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	if (t < 0.5) return Math.pow(2, 20 * t - 10) * 0.5;
	return (2 - Math.pow(2, -20 * t + 10)) * 0.5;
};
