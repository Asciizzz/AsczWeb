import { Track } from "../track.js";

/**
 * Scalar floating-point sequence track.
 * You will prolly be using this 99% of the time.
 */
export class FloatTrack extends Track<number, number> {
    blend(a: number, b: number, alpha: number): number {
        return a + (b - a) * alpha;
    }

    protected defaultValue(): number {
        return 0;
    }
}
