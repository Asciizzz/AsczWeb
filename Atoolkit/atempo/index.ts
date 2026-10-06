/**
 * Atempo: Temporal orchestration and cadence evaluation primitives.
 */

export { Cadence, FixedCadence } from "./cadence.js";
export { Phase, Metronome, type MetronomeState } from "./phase.js";
export { Spring } from "./spring.js";
export { type Curve, type InterpolationContext } from "./curve.js";
export { Track, Extrapolation, type Keyframe } from "./track.js";
export { Clip, type ClipMarker } from "./clip.js";

export * as curves from "./curves/index.js";
export * as tracks from "./tracks/index.js";

// Direct track presets
export { FloatTrack } from "./tracks/float.js";
export { VecTrack } from "./tracks/vec.js";
export { QuatTrack } from "./tracks/quat.js";
export { ColorTrack, ColorSpace } from "./tracks/color.js";

// Direct curve presets
export {
	Curves,
	linear,
	step,
	quadIn,
	quadOut,
	quadInOut,
	cubicIn,
	cubicOut,
	cubicInOut,
	expoIn,
	expoOut,
	expoInOut,
	overshoot,
	bounce,
	elastic,
	holdSnap,
	type HoldSnapData,
	bezier,
	type BezierData,
} from "./curves/index.js";
