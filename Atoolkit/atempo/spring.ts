const _springScratch: [number, number] = [0, 0];

/**
 * Analytic second-order harmonic oscillator (spring-damper) solver.
 *
 * Evaluates closed-form differential equation solutions across under-damped (`zeta < 1`),
 * critically-damped (`zeta == 1`), and over-damped (`zeta > 1`) regimes.
 */
export class Spring {
	/** Angular frequency in radians per second (`omega >= 0`). */
	frequency: number;
	/** Damping ratio (`zeta >= 0`: `< 1` under-damped, `1` critically-damped, `> 1` over-damped). */
	damping: number;

	constructor(frequency = 4.0 * Math.PI, damping = 1.0) {
		if (!Number.isFinite(frequency) || frequency < 0) {
			throw new RangeError(`Spring: frequency must be a finite non-negative number, got ${frequency}.`);
		}
		if (!Number.isFinite(damping) || damping < 0) {
			throw new RangeError(`Spring: damping must be a finite non-negative number, got ${damping}.`);
		}
		this.frequency = frequency;
		this.damping = damping;
	}

	/**
	 * Advances a 2-element `[position, velocity]` state tuple or `Float32Array` in-place by `dt` seconds.
	 */
	update(
		posVel: [number, number] | Float32Array,
		target: number,
		dt: number
	): [number, number] | Float32Array {
		return this.updateScalar(posVel[0], posVel[1], target, dt, posVel);
	}

	/**
	 * Advances a 1D scalar spring state by `dt` seconds and writes `[newPosition, newVelocity]` into `out`.
	 * When `dt` is 0 or `frequency` is 0, preserves `[position, velocity]`.
	 * Throws a `RangeError` if `dt` is negative or non-finite.
	 */
	updateScalar(
		position: number,
		velocity: number,
		target: number,
		dt: number,
		out: [number, number] | Float32Array = [0, 0]
	): [number, number] | Float32Array {
		if (!Number.isFinite(dt) || dt < 0) {
			throw new RangeError(`Spring.updateScalar: dt must be a finite non-negative number, got ${dt}.`);
		}
		const omega = this.frequency;
		const zeta = this.damping;

		if (!Number.isFinite(omega) || omega < 0 || !Number.isFinite(zeta) || zeta < 0) {
			throw new RangeError("Spring parameters (frequency, damping) must be finite non-negative numbers.");
		}

		if (dt === 0.0 || omega === 0.0) {
			out[0] = position;
			out[1] = velocity;
			return out;
		}

		const x0 = position - target;
		const v0 = velocity;

		if (Math.abs(zeta - 1.0) <= 1e-5) {
			// Critically damped (zeta == 1)
			const exp = Math.exp(-omega * dt);
			const c1 = x0;
			const c2 = v0 + omega * x0;
			out[0] = target + (c1 + c2 * dt) * exp;
			out[1] = (c2 - omega * (c1 + c2 * dt)) * exp;
		} else if (zeta < 1.0) {
			// Under-damped (0 <= zeta < 1)
			const omegaD = omega * Math.sqrt(1.0 - zeta * zeta);
			const exp = Math.exp(-zeta * omega * dt);
			const cos = Math.cos(omegaD * dt);
			const sin = Math.sin(omegaD * dt);

			const c1 = x0;
			const c2 = (v0 + zeta * omega * x0) / omegaD;

			out[0] = target + exp * (c1 * cos + c2 * sin);
			out[1] =
				exp *
				((c2 * omegaD - c1 * zeta * omega) * cos -
					(c1 * omegaD + c2 * zeta * omega) * sin);
		} else {
			// Over-damped (zeta > 1)
			const alpha = omega * Math.sqrt(zeta * zeta - 1.0);
			const r1 = -omega * zeta + alpha;
			const r2 = -omega * zeta - alpha;

			const c2 = (v0 - r1 * x0) / (r2 - r1);
			const c1 = x0 - c2;

			const e1 = Math.exp(r1 * dt);
			const e2 = Math.exp(r2 * dt);

			out[0] = target + c1 * e1 + c2 * e2;
			out[1] = c1 * r1 * e1 + c2 * r2 * e2;
		}

		return out;
	}

	/**
	 * Advances an N-dimensional vector spring state in-place within `positions` and `velocities`.
	 */
	updateVector(
		positions: number[] | Float32Array,
		velocities: number[] | Float32Array,
		targets: ArrayLike<number>,
		dt: number,
		scratch: [number, number] | Float32Array = _springScratch
	): void {
		if (!Number.isFinite(dt) || dt < 0) {
			throw new RangeError(`Spring.updateVector: dt must be a finite non-negative number, got ${dt}.`);
		}
		if (dt === 0) {
			return;
		}
		const len = Math.min(positions.length, velocities.length, targets.length);
		for (let i = 0; i < len; i++) {
			this.updateScalar(positions[i], velocities[i], targets[i], dt, scratch);
			positions[i] = scratch[0];
			velocities[i] = scratch[1];
		}
	}
}
