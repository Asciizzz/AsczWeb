/**
 * Overflow handling policy for `FixedCadence` when frame delta exceeds `maxStepsPerFrame * fixedStepSec`.
 * - `"drop"`: Discards excess accumulated time beyond `maxStepsPerFrame` steps to prevent catch-up spirals.
 * - `"retain"`: Retains excess accumulated time for subsequent `update()` calls.
 */
export type FixedCadenceOverflowPolicy = "drop" | "retain";

const LN2 = Math.LN2;

/**
 * Stateless frame-rate independent exponential decay, critically damped smoothing, and quantization utilities.
 */
export class Cadence {
	/**
	 * Frame-rate independent exponential decay towards a target value using decay rate `decay` (`>= 0`).
	 * Formula: `target + (current - target) * exp(-decay * deltaSec)`
	 */
	static expDecay(current: number, target: number, decay: number, deltaSec: number): number {
		if (!Number.isFinite(deltaSec) || deltaSec < 0) {
			throw new RangeError(
				`Cadence.expDecay: deltaSec must be a finite non-negative number, got ${deltaSec}.`
			);
		}
		if (!Number.isFinite(decay) || decay < 0) {
			throw new RangeError(
				`Cadence.expDecay: decay must be a finite non-negative number, got ${decay}.`
			);
		}
		if (deltaSec === 0 || decay === 0) {
			return current;
		}
		return target + (current - target) * Math.exp(-decay * deltaSec);
	}

	/**
	 * Half-life exponential decay closing half the remaining gap every `halfLife` seconds (`> 0`).
	 */
	static decay(current: number, target: number, halfLife: number, deltaSec: number): number {
		if (!Number.isFinite(deltaSec) || deltaSec < 0) {
			throw new RangeError(
				`Cadence.decay: deltaSec must be a finite non-negative number, got ${deltaSec}.`
			);
		}
		if (!Number.isFinite(halfLife) || halfLife <= 0) {
			throw new RangeError(
				`Cadence.decay: halfLife must be a finite positive number, got ${halfLife}.`
			);
		}
		if (deltaSec === 0) {
			return current;
		}
		const factor = Math.exp((-LN2 * deltaSec) / halfLife);
		return target + (current - target) * factor;
	}

	/**
	 * Frame-rate independent exponential decay for vector/array types.
	 */
	static expDecayVector<T extends number[] | Float32Array>(
		current: ArrayLike<number>,
		target: ArrayLike<number>,
		decay: number,
		deltaSec: number,
		out: T
	): T {
		if (!Number.isFinite(deltaSec) || deltaSec < 0) {
			throw new RangeError(
				`Cadence.expDecayVector: deltaSec must be a finite non-negative number, got ${deltaSec}.`
			);
		}
		if (!Number.isFinite(decay) || decay < 0) {
			throw new RangeError(
				`Cadence.expDecayVector: decay must be a finite non-negative number, got ${decay}.`
			);
		}
		const len = Math.min(current.length, target.length, out.length);
		if (deltaSec === 0 || decay === 0) {
			for (let i = 0; i < len; i++) {
				out[i] = current[i];
			}
			return out;
		}
		const factor = Math.exp(-decay * deltaSec);
		for (let i = 0; i < len; i++) {
			const c = current[i];
			const t = target[i];
			out[i] = t + (c - t) * factor;
		}
		return out;
	}

	/**
	 * Critically damped spring-damper smoothing (Game Programming Gems 4, Chapter 1.10).
	 * When `deltaSec` is 0, returns `current` and leaves `velocityRef[0]` unchanged.
	 * Throws a `RangeError` if `deltaSec` is negative or non-finite.
	 */
	static damp(
		current: number,
		target: number,
		smoothTime: number,
		maxSpeed = Infinity,
		deltaSec: number,
		velocityRef: [number] | Float32Array
	): number {
		if (!Number.isFinite(deltaSec) || deltaSec < 0) {
			throw new RangeError(
				`Cadence.damp: deltaSec must be a finite non-negative number, got ${deltaSec}.`
			);
		}
		if (deltaSec === 0) {
			return current;
		}

		const st = Math.max(0.0001, smoothTime);
		const omega = 2.0 / st;

		const x = omega * deltaSec;
		const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x);

		let change = current - target;
		const originalTo = target;

		const maxChange = maxSpeed * st;
		change = Math.max(-maxChange, Math.min(maxChange, change));
		const clampedTarget = current - change;

		const temp = (velocityRef[0] + omega * change) * deltaSec;
		velocityRef[0] = (velocityRef[0] - omega * temp) * exp;
		let output = clampedTarget + (change + temp) * exp;

		if (originalTo - current > 0.0 === output > originalTo) {
			output = originalTo;
			velocityRef[0] = (output - originalTo) / deltaSec;
		}

		return output;
	}

	/**
	 * Snaps continuous timestamp `time` to stepped frame interval `floor(time * targetFps) / targetFps`.
	 */
	static quantizeTime(time: number, targetFps: number): number {
		if (!Number.isFinite(time) || !Number.isFinite(targetFps) || targetFps <= 0) {
			throw new RangeError(
				`Cadence.quantizeTime: time must be finite and targetFps must be > 0, got time=${time}, targetFps=${targetFps}.`
			);
		}
		return Math.floor(time * targetFps) / targetFps;
	}

	/**
	 * Returns `target` only when `|target - current| >= threshold`, otherwise preserves `current`.
	 */
	static hysteresis(current: number, target: number, threshold: number): number {
		return Math.abs(target - current) >= threshold ? target : current;
	}

	/**
	 * Returns `true` when `time - lastTriggerTime >= cooldown`.
	 */
	static debounce(time: number, lastTriggerTime: number, cooldown: number): boolean {
		return time - lastTriggerTime >= cooldown;
	}
}

/**
 * Deterministic fixed-timestep accumulator.
 *
 * Accumulates variable frame deltas and dispatches fixed-duration steps up to `maxStepsPerFrame`.
 */
export class FixedCadence {
	readonly fixedStepSec: number;
	readonly maxStepsPerFrame: number;
	readonly overflowPolicy: FixedCadenceOverflowPolicy;
	#accumulator = 0;
	#simulationTime = 0;

	constructor(
		fixedStepSec = 1 / 60,
		maxStepsPerFrame = 8,
		overflowPolicy: FixedCadenceOverflowPolicy = "drop"
	) {
		if (!Number.isFinite(fixedStepSec) || fixedStepSec <= 0) {
			throw new RangeError(
				`FixedCadence: fixedStepSec must be a finite positive number, got ${fixedStepSec}.`
			);
		}
		if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
			throw new RangeError(
				`FixedCadence: maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}.`
			);
		}
		this.fixedStepSec = fixedStepSec;
		this.maxStepsPerFrame = maxStepsPerFrame;
		this.overflowPolicy = overflowPolicy;
	}

	/**
	 * Advances the accumulator by `deltaSec` and invokes `stepFn(fixedStepSec, simulationTime)` for each full step.
	 * Returns `{ stepsTaken, alpha }` where `alpha` is the residual interpolation factor in `[0, 1)`.
	 */
	update(
		deltaSec: number,
		stepFn: (fixedDt: number, simTime: number) => void
	): { stepsTaken: number; alpha: number } {
		if (!Number.isFinite(deltaSec) || deltaSec < 0) {
			throw new RangeError(
				`FixedCadence.update: deltaSec must be a finite non-negative number, got ${deltaSec}.`
			);
		}
		if (deltaSec === 0) {
			return {
				stepsTaken: 0,
				alpha: Math.min(1, this.#accumulator / this.fixedStepSec),
			};
		}

		this.#accumulator += deltaSec;

		let stepsTaken = 0;
		while (this.#accumulator >= this.fixedStepSec && stepsTaken < this.maxStepsPerFrame) {
			this.#simulationTime += this.fixedStepSec;
			stepFn(this.fixedStepSec, this.#simulationTime);
			this.#accumulator -= this.fixedStepSec;
			stepsTaken++;
		}

		if (this.#accumulator >= this.fixedStepSec && this.overflowPolicy === "drop") {
			this.#accumulator = 0;
		}

		const alpha =
			this.overflowPolicy === "drop"
				? this.#accumulator / this.fixedStepSec
				: Math.min(1, this.#accumulator / this.fixedStepSec);
		return { stepsTaken, alpha };
	}

	/** Current residual time in seconds stored in the accumulator. */
	get accumulator(): number {
		return this.#accumulator;
	}

	/** Total simulated time in seconds across all executed fixed steps. */
	get simulationTime(): number {
		return this.#simulationTime;
	}

	/** Resets accumulated and simulated time to zero. */
	reset(): void {
		this.#accumulator = 0;
		this.#simulationTime = 0;
	}
}
