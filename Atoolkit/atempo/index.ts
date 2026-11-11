export { Cadence, FixedCadence, type FixedCadenceOverflowPolicy } from "./cadence.js";
export { WrapMode, Phase, Metronome, type MetronomeState } from "./phase.js";
export { Spring } from "./spring.js";

export {
	evaluateCurve,
	type Curve,
	type CurveFunction,
	type CurveObject,
	type InterpolationContext,
	type CurveContext,
} from "./curve.js";
export { BezierCurve, evaluateCubicBezier, bezier, type BezierData } from "./curves/bezier.js";
export * from "./curves/index.js";

export {
	Track,
	Extrapolation,
	type Keyframe,
	type TrackOptions,
} from "./track.js";
export * from "./tracks/index.js";

export { Clip, type Marker, type ClipMarker } from "./clip.js";
