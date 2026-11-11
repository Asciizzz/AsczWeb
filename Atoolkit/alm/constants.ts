export const EPSILON = 0.000001;
export const EPSILON_SQ = EPSILON * EPSILON;
export const DEG2RAD = Math.PI / 180.0;
export const RAD2DEG = 180.0 / Math.PI;
export const TAU = Math.PI * 2.0;
export const PI_HALF = Math.PI * 0.5;
export const PI_QUARTER = Math.PI * 0.25;
export const PI_THIRD = Math.PI / 3.0;

export type EulerOrder = "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY";

export function clamp(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + t * (b - a);
}

export function approxEquals(a: number, b: number, epsilon = EPSILON): boolean {
	return Math.abs(a - b) <= epsilon;
}
