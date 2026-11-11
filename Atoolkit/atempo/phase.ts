/**
 * Cyclic and bounded playback wrap modes.
 */
export enum WrapMode {
	Once = "once",
	Loop = "loop",
	PingPong = "ping-pong",
	Clamp = "clamp",
}

export interface MetronomeState {
	cycle: number;
	phase: number;
	bar: number;
	beatInBar: number;
	justTriggered: boolean;
	impulse: number;
}

/**
 * Stateless timeline phase mapping and periodic waveform utilities.
 */
export class Phase {
	/**
	 * Maps an unbounded time value (in seconds) into `[0, duration]` according to `mode`
	 * (or wraps `value` into `[min, max)` when called with two numeric bounds and no `WrapMode`).
	 */
	static wrap(time: number, duration: number, mode?: WrapMode): number;
	static wrap(value: number, min: number, max: number): number;
	static wrap(a: number, b: number, c?: WrapMode | number): number {
		if (typeof c === "number") {
			if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
				throw new RangeError("Phase.wrap: value, min, and max must be finite numbers.");
			}
			const span = c - b;
			if (span <= 0) return b;
			const rem = (a - b) % span;
			return b + (rem < 0 ? rem + span : rem);
		}

		const time = a;
		const duration = b;
		const mode = c ?? WrapMode.Once;
		if (!Number.isFinite(time) || !Number.isFinite(duration)) {
			throw new RangeError(
				`Phase.wrap: time and duration must be finite numbers, got time=${time}, duration=${duration}.`
			);
		}
		if (duration <= 0) return 0;

		switch (mode) {
			case WrapMode.Once:
			case WrapMode.Clamp:
				return Math.max(0, Math.min(duration, time));

			case WrapMode.Loop: {
				const rem = time % duration;
				return rem < 0 ? rem + duration : rem;
			}

			case WrapMode.PingPong: {
				const cycle = duration * 2;
				let rem = time % cycle;
				if (rem < 0) rem += cycle;
				return rem <= duration ? rem : cycle - rem;
			}
		}
	}

	/**
	 * Normalizes time into `[0, 1]` relative to `duration` after applying `mode`.
	 */
	static normalize(time: number, duration: number, mode: WrapMode = WrapMode.Once): number {
		if (!Number.isFinite(time) || !Number.isFinite(duration)) {
			throw new RangeError("Phase.normalize: time and duration must be finite numbers.");
		}
		if (duration <= 0) return 0;
		return Phase.wrap(time, duration, mode) / duration;
	}

	/**
	 * Computes the integer cycle index (`floor(time / duration)`).
	 */
	static cycleCount(time: number, duration: number): number {
		if (!Number.isFinite(time) || !Number.isFinite(duration)) {
			throw new RangeError("Phase.cycleCount: time and duration must be finite numbers.");
		}
		if (duration <= 0) return 0;
		return Math.floor(time / duration);
	}

	/**
	 * Converts continuous time `timeSec` into a normalized cyclic phase in `[0, 1)`.
	 */
	static cycle(timeSec: number, frequencyHz = 1.0, phaseOffset = 0.0): number {
		if (!Number.isFinite(timeSec) || !Number.isFinite(frequencyHz) || !Number.isFinite(phaseOffset)) {
			throw new RangeError("Phase.cycle: arguments must be finite numbers.");
		}
		const raw = timeSec * frequencyHz + phaseOffset;
		return raw - Math.floor(raw);
	}

	/** Sine wave mapped to `[-1, 1]` over normalized phase in `[0, 1)`. */
	static sine(phase: number): number {
		return Math.sin(phase * Math.PI * 2.0);
	}

	/** Cosine wave mapped to `[-1, 1]` over normalized phase in `[0, 1)`. */
	static cosine(phase: number): number {
		return Math.cos(phase * Math.PI * 2.0);
	}

	/** Symmetric triangle wave mapped to `[-1, 1]` over normalized phase in `[0, 1)`. */
	static triangle(phase: number): number {
		const p = phase - Math.floor(phase);
		return 1.0 - 4.0 * Math.abs(p - 0.5);
	}

	/** Sawtooth ramp wave mapped to `[-1, 1]` over normalized phase in `[0, 1)`. */
	static saw(phase: number): number {
		const p = phase - Math.floor(phase);
		return 2.0 * p - 1.0;
	}

	/** Square pulse wave evaluating to `1` when `phase < dutyCycle` and `-1` otherwise. */
	static square(phase: number, dutyCycle = 0.5): number {
		const p = phase - Math.floor(phase);
		return p < dutyCycle ? 1.0 : -1.0;
	}

	/** Exponentially decaying impulse `exp(-sharpness * phase)` peaking at `1` at `phase = 0`. */
	static impulse(phase: number, sharpness = 8.0): number {
		const p = phase - Math.floor(phase);
		return Math.exp(-sharpness * p);
	}
}

/**
 * Periodic beat and bar boundary tracker.
 */
export class Metronome {
	#frequencyHz: number;
	#lastCycle = -1;
	readonly #state: MetronomeState = {
		cycle: 0,
		phase: 0,
		bar: 0,
		beatInBar: 0,
		justTriggered: false,
		impulse: 0,
	};

	constructor(bpm = 120) {
		if (!Number.isFinite(bpm) || bpm <= 0) {
			throw new RangeError(`Metronome: bpm must be a finite positive number, got ${bpm}.`);
		}
		this.#frequencyHz = bpm / 60.0;
	}

	setBpm(bpm: number): this {
		if (!Number.isFinite(bpm) || bpm <= 0) {
			throw new RangeError(`Metronome.setBpm: bpm must be a finite positive number, got ${bpm}.`);
		}
		this.#frequencyHz = bpm / 60.0;
		return this;
	}

	setFrequency(hz: number): this {
		if (!Number.isFinite(hz) || hz <= 0) {
			throw new RangeError(`Metronome.setFrequency: hz must be a finite positive number, got ${hz}.`);
		}
		this.#frequencyHz = hz;
		return this;
	}

	get frequencyHz(): number {
		return this.#frequencyHz;
	}

	get bpm(): number {
		return this.#frequencyHz * 60.0;
	}

	reset(): void {
		this.#lastCycle = -1;
	}

	sample(timeSec: number, impulseSharpness = 8.0): MetronomeState {
		if (!Number.isFinite(timeSec)) {
			throw new RangeError(`Metronome.sample: timeSec must be a finite number, got ${timeSec}.`);
		}
		const totalBeats = timeSec * this.#frequencyHz;
		const cycle = Math.floor(totalBeats);
		const phase = totalBeats - cycle;

		const justTriggered = cycle !== this.#lastCycle;
		this.#lastCycle = cycle;

		this.#state.cycle = cycle;
		this.#state.phase = phase;
		this.#state.bar = Math.floor(cycle / 4);
		this.#state.beatInBar = ((cycle % 4) + 4) % 4;
		this.#state.justTriggered = justTriggered;
		this.#state.impulse = Math.exp(-impulseSharpness * phase);
		return this.#state;
	}
}
