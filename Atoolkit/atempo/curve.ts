/**
 * Temporal evaluation context for active keyframe interval.
 */
export interface InterpolationContext {
	readonly dt: number;
	readonly k0Time: number;
	readonly k1Time: number;
}

/**
 * Progress shaping function.
 * Maps normalized interval progress t in [0, 1] to shaped evaluation alpha.
 * Accepts optional parameter data bag and interval context.
 */
export type Curve<TData = any> = (
	t: number,
	data?: TData,
	ctx?: InterpolationContext
) => number;
