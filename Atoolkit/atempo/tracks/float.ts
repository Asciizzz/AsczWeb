import { Track, type TrackOptions } from "../track.js";

/**
 * Scalar floating-point sequence track.
 */
export class FloatTrack extends Track<number, number> {
	constructor(options?: TrackOptions | number) {
		super(options);
	}

	override blend(a: number, b: number, alpha: number): number {
		return a + (b - a) * alpha;
	}

	protected override defaultValue(): number {
		return 0;
	}
}

export { FloatTrack as ScalarTrack };
