/**
 * Curve presets catalog.
 */

export {
	linear,
	quadIn,
	quadOut,
	quadInOut,
	cubicIn,
	cubicOut,
	cubicInOut,
	expoIn,
	expoOut,
	expoInOut,
} from "./standard.js";

export { overshoot, bounce, elastic } from "./physics.js";

export { step, holdSnap, type HoldSnapData } from "./discrete.js";

export { bezier, type BezierData } from "./bezier.js";

import {
	linear,
	quadIn,
	quadOut,
	quadInOut,
	cubicIn,
	cubicOut,
	cubicInOut,
	expoIn,
	expoOut,
	expoInOut,
} from "./standard.js";
import { overshoot, bounce, elastic } from "./physics.js";
import { step, holdSnap } from "./discrete.js";
import { bezier } from "./bezier.js";

/**
 * Unified curve presets dictionary for autocomplete discovery.
 */
export const Curves = {
	linear,
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
	step,
	holdSnap,
	bezier,
} as const;
