import type { Track } from "./track.js";

/**
 * Named timeline event marker at a timestamp in seconds.
 */
export interface Marker {
	readonly name: string;
	readonly label: string;
	readonly time: number;
	readonly data?: unknown;
}

export type ClipMarker = Marker;

/**
 * Multi-track timeline container with sorted event markers.
 *
 * Marker crossing rules:
 * - Forward playback (`currentTime > previousTime`) emits markers in the half-open interval
 *   `(previousTime, currentTime]` in ascending timestamp order.
 * - Reverse playback (`currentTime < previousTime`) emits markers in the half-open interval
 *   `[currentTime, previousTime)` in descending timestamp order.
 * - Equal timestamps (`currentTime === previousTime`) emit no markers.
 * - Multiple markers sharing the exact same timestamp preserve their insertion order.
 */
export class Clip {
	readonly name: string;
	#explicitDuration: number | null;
	readonly #tracks = new Map<string, Track<any, any>>();
	readonly #markers: Marker[] = [];

	constructor(name = "Clip", explicitDuration: number | null = null) {
		if (explicitDuration !== null && (!Number.isFinite(explicitDuration) || explicitDuration < 0)) {
			throw new RangeError(
				`Clip: explicitDuration must be null or a finite non-negative number, got ${explicitDuration}.`
			);
		}
		this.name = name;
		this.#explicitDuration = explicitDuration;
	}

	/** Earliest start timestamp across all registered tracks (or 0 if empty). */
	get startTime(): number {
		if (this.#tracks.size === 0) return 0;
		let min = Infinity;
		for (const track of this.#tracks.values()) {
			if (track.startTime < min) {
				min = track.startTime;
			}
		}
		return Number.isFinite(min) ? min : 0;
	}

	/** Latest end timestamp across all registered tracks and markers (or 0 if empty). */
	get endTime(): number {
		let max = 0;
		for (const track of this.#tracks.values()) {
			if (track.endTime > max) {
				max = track.endTime;
			}
		}
		if (this.#markers.length > 0) {
			const lastMarkerTime = this.#markers[this.#markers.length - 1].time;
			if (lastMarkerTime > max) {
				max = lastMarkerTime;
			}
		}
		return max;
	}

	/**
	 * Total clip duration in seconds.
	 * Returns the explicit duration if set, or `endTime - Math.min(0, startTime)`.
	 */
	get duration(): number {
		if (this.#explicitDuration !== null) {
			return this.#explicitDuration;
		}
		return this.endTime - Math.min(0, this.startTime);
	}

	set duration(value: number | null) {
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			throw new RangeError(`Clip.duration must be null or a finite non-negative number, got ${value}.`);
		}
		this.#explicitDuration = value;
	}

	/** Registers a named track on this clip. */
	addTrack<TTrack extends Track<any, any>>(id: string, track: TTrack): TTrack {
		this.#tracks.set(id, track);
		return track;
	}

	/** Retrieves a registered track by ID. */
	getTrack<TTrack extends Track<any, any> = Track<any, any>>(id: string): TTrack | undefined {
		return this.#tracks.get(id) as TTrack | undefined;
	}

	/** Removes a registered track by ID. */
	removeTrack(id: string): boolean {
		return this.#tracks.delete(id);
	}

	/** Read-only view of all registered tracks. */
	get tracks(): ReadonlyMap<string, Track<any, any>> {
		return this.#tracks;
	}

	/**
	 * Evaluates all registered tracks at `time` (in seconds), writing results into `target[name]`.
	 */
	sample<TTarget extends Record<string, any> = Record<string, any>>(
		time: number,
		target: TTarget = {} as TTarget
	): TTarget {
		if (!Number.isFinite(time)) {
			throw new RangeError(`Clip.sample: time must be a finite number, got ${time}.`);
		}
		for (const [id, track] of this.#tracks.entries()) {
			const existing = target[id];
			const out =
				existing instanceof Float32Array ? existing : undefined;
			(target as Record<string, any>)[id] = track.sample(time, out);
		}
		return target;
	}

	/**
	 * Evaluates all registered tracks at a normalized progression ratio in `[0, 1]`.
	 */
	sampleRatio<TTarget extends Record<string, any> = Record<string, any>>(
		ratio: number,
		target: TTarget = {} as TTarget
	): TTarget {
		if (!Number.isFinite(ratio)) {
			throw new RangeError(`Clip.sampleRatio: ratio must be a finite number, got ${ratio}.`);
		}
		const clamped = Math.max(0, Math.min(1, ratio));
		const tStart = this.startTime;
		const span = this.endTime - tStart;
		return this.sample(tStart + clamped * span, target);
	}

	/**
	 * Inserts a marker at `time` (in seconds), maintaining ascending timestamp order
	 * and preserving insertion order among markers sharing an identical timestamp.
	 * Accepts either `(time, label, data?)` or `(name, time, data?)`.
	 */
	addMarker(time: number, label: string, data?: unknown): this;
	addMarker(name: string, time: number, data?: unknown): this;
	addMarker(arg0: number | string, arg1: string | number, data?: unknown): this {
		let time: number;
		let name: string;
		if (typeof arg0 === "number") {
			time = arg0;
			name = String(arg1);
		} else {
			name = arg0;
			time = Number(arg1);
		}
		if (!Number.isFinite(time)) {
			throw new RangeError(`Clip.addMarker: time must be a finite number, got ${time}.`);
		}
		const marker: Marker = Object.freeze({ name, label: name, time, data });
		let low = 0;
		let high = this.#markers.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (this.#markers[mid].time <= time) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		this.#markers.splice(low, 0, marker);
		return this;
	}

	/** Removes all markers matching the given name/label. */
	removeMarkersByName(name: string): number {
		let removed = 0;
		for (let i = this.#markers.length - 1; i >= 0; i--) {
			if (this.#markers[i].name === name) {
				this.#markers.splice(i, 1);
				removed++;
			}
		}
		return removed;
	}

	/** Read-only snapshot of all markers sorted by timestamp. */
	get markers(): ReadonlyArray<Marker> {
		return [...this.#markers];
	}

	/**
	 * Returns all markers within the closed interval `[start, end]` in ascending timestamp order.
	 */
	getMarkersInRange(start: number, end: number, out: Marker[] = []): Marker[] {
		out.length = 0;
		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			return out;
		}
		const lo = Math.min(start, end);
		const hi = Math.max(start, end);
		for (let i = 0; i < this.#markers.length; i++) {
			const m = this.#markers[i];
			if (m.time >= lo && m.time <= hi) {
				out.push(m);
			} else if (m.time > hi) {
				break;
			}
		}
		return out;
	}

	/**
	 * Collects markers crossed between `previousTime` and `currentTime` into `out`.
	 * - Forward (`currentTime > previousTime`): interval `(previousTime, currentTime]` in ascending timestamp order.
	 * - Backward (`currentTime < previousTime`): interval `[currentTime, previousTime)` in descending timestamp order
	 *   (with markers sharing an identical timestamp emitted in insertion order).
	 * - Equal (`currentTime === previousTime`): emits no markers.
	 */
	sampleCrossedMarkers(previousTime: number, currentTime: number, out: Marker[] = []): Marker[] {
		out.length = 0;
		const len = this.#markers.length;
		if (len === 0 || previousTime === currentTime) {
			return out;
		}
		if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
			return out;
		}

		if (currentTime > previousTime) {
			for (let i = 0; i < len; i++) {
				const m = this.#markers[i];
				if (m.time > previousTime && m.time <= currentTime) {
					out.push(m);
				} else if (m.time > currentTime) {
					break;
				}
			}
		} else {
			let i = len - 1;
			while (i >= 0) {
				const m = this.#markers[i];
				if (m.time >= previousTime) {
					i--;
					continue;
				}
				if (m.time < currentTime) {
					break;
				}
				const t = m.time;
				let groupStart = i;
				while (groupStart > 0 && this.#markers[groupStart - 1].time === t) {
					groupStart--;
				}
				for (let j = groupStart; j <= i; j++) {
					out.push(this.#markers[j]);
				}
				i = groupStart - 1;
			}
		}

		return out;
	}

	/**
	 * Collects markers crossed between normalized progression ratios `previousRatio` and `currentRatio`.
	 */
	sampleCrossedMarkersRatio(
		previousRatio: number,
		currentRatio: number,
		out: Marker[] = []
	): Marker[] {
		const tStart = this.startTime;
		const span = this.endTime - tStart;
		return this.sampleCrossedMarkers(
			tStart + previousRatio * span,
			tStart + currentRatio * span,
			out
		);
	}
}
