/**
 * Temporal evaluation context for an active keyframe interval.
 */
export interface InterpolationContext {
	dt: number;
	k0Time: number;
	k1Time: number;
}

export type CurveContext = InterpolationContext;

export type CurveFunction<TData = any> = (
	t: number,
	data?: TData,
	ctx?: InterpolationContext
) => number;

export interface CurveObject {
	evaluate(t: number, ctx?: InterpolationContext): number;
}

/**
 * Progress shaping evaluator.
 * Accepts either a stateless function `(t, data?, ctx?) => alpha` or an object with `.evaluate(t, ctx?)`.
 */
export type Curve<TData = any> = CurveFunction<TData> | CurveObject;

export function evaluateCurve<TData = any>(
	curve: Curve<TData>,
	t: number,
	data?: TData,
	ctx?: InterpolationContext
): number {
	if (typeof curve === "function") {
		return curve(t, data, ctx);
	}
	return curve.evaluate(t, ctx);
}
