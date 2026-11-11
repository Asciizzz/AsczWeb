# Atempo

Temporal orchestration, cadence quantization, and keyframe sequence evaluation primitives. Decouples interval time-shaping functions from concrete data interpolation.

---

## Architecture Overview

Atempo structures temporal operations across seven primitives:

1. `Track<T, TOut>`: Sequence interpolation base class with contiguous timestamp indexing, parameter bags, and O(1) cached interval lookup.
2. `Curve<TData>`: Progress transfer function `(t: number, data?: TData, ctx?: InterpolationContext) => number` shaping interval progress.
3. `Clip`: Multi-track timeline container evaluating heterogeneous tracks simultaneously at common timestamp.
4. `Cadence`: Exponential half-life decays, critically damped followers, and discrete frame quantizers.
5. `FixedCadence`: Deterministic simulation timestep accumulator decoupling render frames from discrete ticks.
6. `Spring`: Closed-form analytical 2nd-order damped harmonic oscillator.
7. `Phase` & `Metronome`: Periodic phase coordinate arithmetic, cyclic waveforms, and beat boundary trackers.

---

## 1. Sequence Interpolation Base Class

`Track<T, TOut = T>` manages chronological keyframe sequences, locates active interval spans, and shapes interval progress before calling data interpolation.

```typescript
import { Track } from "@asciiz/atoolkit/atempo";

export class CustomFloatTrack extends Track<number, number> {
	blend(a: number, b: number, alpha: number): number {
		return a + (b - a) * alpha;
	}

	protected defaultValue(): number {
		return 0;
	}
}
```

- Keyframe & timeline properties:
  - `startTime`: Timestamp of the first keyframe, or `0` if empty.
  - `endTime`: Timestamp of the last keyframe, or `0` if empty.
  - `duration`: Total keyframe span (`endTime - startTime`), or `0` when the track has `0` or `1` keyframe.
- `addKey(time, value, curve?, curveData?, fps?)`: Validates that `time` is finite (`RangeError` otherwise). Replaces the existing keyframe in place if `time` matches an existing keyframe timestamp, appends in O(1) when `time` exceeds the tail, or inserts in sorted order via binary search in O(N).
- `setCurve(index, curve?, curveData?, fps?)`: Updates curve evaluator and parameters on existing keyframe in O(1).
- `removeKeyAt(index)` / `removeKeyAtTime(time)`: Removes a keyframe by index or timestamp.
- `sample(time, out?)`: Evaluates active interval span, quantizes normalized progress `tau` when interval or track FPS is configured, calls `curve(tau, curveData, ctx)`, and invokes `blend(a, b, alpha, out)`.
- `sampleRatio(ratio, out?)`: Evaluates track value at normalized progression ratio in `[0.0, 1.0]`. Maps ratio across the track's own keyframe span: `startTime + ratio * duration`.
- `getKey(index)`: Returns keyframe snapshot at index, or `undefined` if out of bounds.
- `extrapolation`: Configures boundary handling:
  - `Extrapolation.Clamp`: Holds boundary value when time is before start or after end.
  - `Extrapolation.Loop`: Wraps evaluation time into `[startTime, endTime)` range via modulo arithmetic over `duration`.
  - `Extrapolation.PingPong`: Reflects evaluation time back and forth across `duration`.
- Memory & caching:
  - Caches last sampled interval index for O(1) sequential playback lookup.
  - Falls back to O(log N) binary search on random seek or playback reversal.
  - Reuses caller-provided `out` buffer in vector, quaternion, and color subclasses to maintain zero allocations during playback.

---

## 2. Track Presets

### 2.1 FloatTrack

Evaluates scalar floating-point sequences.

```typescript
import { FloatTrack } from "@asciiz/atoolkit/atempo";

const track = new FloatTrack();
track.addKey(0.0, 0.0);
track.addKey(1.0, 100.0);

const val = track.sample(0.5); // 50.0
void val;
```

- `blend(a, b, alpha)`: Evaluates linear interpolation `a + (b - a) * alpha`. Returns primitive number with zero heap allocation.
- `defaultValue()`: Returns `0`.

### 2.2 VecTrack

Evaluates N-dimensional vector sequences (`VecTrack`, `Vec2Track`, `Vec3Track`, `Vec4Track`).

```typescript
import { VecTrack } from "@asciiz/atoolkit/atempo";

const posTrack = new VecTrack(3);
posTrack.addKey(0.0, new Float32Array([0, 10, 20]));
posTrack.addKey(2.0, new Float32Array([100, 110, 120]));

const out = new Float32Array(3);
posTrack.sample(1.0, out); // out is [50, 60, 70]
```

- Storage & configuration:
  - `dimension: number`: Component count per keyframe (e.g. 2 for Vec2, 3 for Vec3, 4 for Vec4).
- `addKey`: Clones the input vector so subsequent caller mutations do not alter stored keyframes.
- `blend(a, b, alpha, out)`: Linearly interpolates each vector component across dimension: `out[i] = a[i] * (1 - alpha) + b[i] * alpha` into the caller-supplied `out` buffer.

### 2.3 QuatTrack

Evaluates 4D quaternion orientations via spherical linear interpolation.

```typescript
import { QuatTrack } from "@asciiz/atoolkit/atempo";

const rotTrack = new QuatTrack();
rotTrack.addAxisAngleKey(0.0, [0, 1, 0], 0.0);
rotTrack.addAxisAngleKey(2.0, [0, 1, 0], Math.PI);

const outQuat = new Float32Array(4);
rotTrack.sample(1.0, outQuat);
```

- `blend(a, b, alpha, out)`: Evaluates spherical linear interpolation (SLERP) into `out`.
  - Normalizes endpoint quaternions and computes `dot = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w`.
  - Antipodal check: When `dot < 0`, negates quaternion `b` and sets `dot = -dot` to enforce acute shortest-path rotation (arc <= 180 degrees).
  - Singularity threshold: When `dot > 0.9995`, falls back to normalized linear interpolation to avoid division by zero in `sin(theta)`.
  - Renormalization: Normalizes output vector to ensure unit quaternion length.
- `addAxisAngleKey(time, axis, rad, curve?)`: Normalizes `axis` (throwing `RangeError` if zero-length), converts axis-angle rotation into quaternion `[x*s, y*s, z*s, cos(rad/2)]`, and appends keyframe.

### 2.4 ColorTrack

Evaluates RGB or RGBA color channels with approximate gamma-2 or linear blending.

```typescript
import { ColorTrack, ColorSpace } from "@asciiz/atoolkit/atempo";

const colorTrack = new ColorTrack({ dimension: 4, colorSpace: ColorSpace.ApproxGamma2 });
colorTrack.addKey(0.0, new Float32Array([1, 0, 0, 1]));
colorTrack.addKey(1.0, new Float32Array([0, 1, 0, 1]));

const outCol = new Float32Array(4);
colorTrack.sample(0.5, outCol); // Midpoint red/green evaluate to ~0.7071
```

- Storage & configuration:
  - `dimension: 3 | 4`: Channel count (`3` for RGB, `4` for RGBA).
  - `colorSpace: ColorSpace`: `ColorSpace.ApproxGamma2` or `ColorSpace.Linear`.
- `blend(a, b, alpha, out)`:
  - Under `ColorSpace.ApproxGamma2`: Clamps negative RGB inputs to `0` before blending in squared space `sqrt((1 - alpha) * a^2 + alpha * b^2)` to preserve luminance energy and avoid `NaN`. Interpolates alpha channel linearly.
  - Under `ColorSpace.Linear`: Evaluates standard linear interpolation across all channels.

---

## 3. Transfer Curves

A curve is a scalar progress shaping function mapping normalized interval progress `t` in `[0, 1]` to shaped evaluation alpha. Evaluator functions are stateless singletons that accept optional parameter data bags and interval context:

```typescript
export interface InterpolationContext {
	readonly dt: number;
	readonly k0Time: number;
	readonly k1Time: number;
}

export type Curve<TData = any> = (
	t: number,
	data?: TData,
	ctx?: InterpolationContext
) => number;
```

Curves are exported directly from `@asciiz/atoolkit/atempo`:

```typescript
import { FloatTrack, quadInOut, step, bezier } from "@asciiz/atoolkit/atempo";

const track = new FloatTrack();

// Direct stateless function preset
track.addKey(0.0, 0.0, quadInOut);

// Parameterized evaluator with data bag
track.addKey(1.0, 50.0, step, 8);
track.addKey(2.0, 100.0, bezier, [0.25, 0.1, 0.25, 1.0]);

// With discrete frame rate lock (posterize time / 12 fps)
track.addKey(3.0, 150.0, bezier, [0.25, 0.1, 0.25, 1.0], 12);

// Inline stateless function
track.addKey(4.0, 200.0, (t) => t * t * t);
```

### Curve Presets Catalog

| Curve | File | Signature | Transfer Formula |
| :--- | :--- | :--- | :--- |
| `linear` | `curves/standard.ts` | `Curve` | $f(t) = t$ |
| `quadIn` | `curves/standard.ts` | `Curve` | $f(t) = t^2$ |
| `quadOut` | `curves/standard.ts` | `Curve` | $f(t) = t(2 - t)$ |
| `quadInOut` | `curves/standard.ts` | `Curve` | $t < 0.5 ? 2t^2 : -1 + (4 - 2t)t$ |
| `cubicIn` | `curves/standard.ts` | `Curve` | $f(t) = t^3$ |
| `cubicOut` | `curves/standard.ts` | `Curve` | $f(t) = (t - 1)^3 + 1$ |
| `cubicInOut` | `curves/standard.ts` | `Curve` | $t < 0.5 ? 4t^3 : (t - 1)(2t - 2)^2 + 1$ |
| `expoIn` | `curves/standard.ts` | `Curve` | $f(t) = 2^{10(t - 1)}$ |
| `expoOut` | `curves/standard.ts` | `Curve` | $f(t) = 1 - 2^{-10t}$ |
| `expoInOut` | `curves/standard.ts` | `Curve` | Piecewise base-2 exponential |
| `overshoot` | `curves/physics.ts` | `Curve<number>` | Back polynomial with tension $s = \text{amount} \cdot 1.70158$, tension in data bag (default 1.15) |
| `bounce` | `curves/physics.ts` | `Curve` | 4-stage piecewise bounce polynomial |
| `elastic` | `curves/physics.ts` | `Curve` | Exponentially decaying sine oscillation |
| `step` | `curves/discrete.ts` | `Curve<number>` | $f(t) = \lfloor t \cdot s \rfloor / s$, with step count in data bag (default 4) |
| `holdSnap` | `curves/discrete.ts` | `Curve<HoldSnapData>` | Binary step with overshoot plateau, threshold/overshoot in data bag |
| `bezier` | `curves/bezier.ts` | `Curve<BezierData>` | Parametric cubic Bezier via Newton-Raphson, control points `[x1, y1, x2, y2]` in data bag |

- `bezier` solves cubic parametric polynomial $X(u) = t$ using 8-iteration Newton-Raphson root finding, falling back to bisection if divergence occurs, then evaluates $Y(u)$. Reads control points from `data` without allocating closure instances.

---

## 4. Multi-Track Timeline Composition

`Clip` manages multiple named `Track` instances on a shared timeline, evaluating all tracks simultaneously into a target dictionary (`clip.ts`).

```typescript
import { Clip, FloatTrack, VecTrack } from "@asciiz/atoolkit/atempo";

const clip = new Clip("CharacterIntro");
clip.addTrack("intensity", new FloatTrack());
clip.addTrack("position", new VecTrack(3));

clip.addMarker(0.5, "FlashTrigger");
clip.addMarker(1.2, "CameraCut");

const state = {
	position: new Float32Array(3),
	intensity: 0,
};

function onUpdate(timeSec: number, prevTimeSec: number) {
	clip.sample(timeSec, state);
	const crossed = clip.sampleCrossedMarkers(prevTimeSec, timeSec);
	void crossed;
}
void onUpdate;
```

- `addTrack(name, track)`: Registers named track in clip, returning the `Clip` for chaining.
- `getTrack(name)`: Retrieves track by name, or `undefined` if not registered.
- `sample(time, target?)`: Evaluates all registered tracks at `time`, writing results into `target[name]`.
- `sampleRatio(ratio, target?)`: Evaluates all registered tracks at normalized progression ratio in `[0.0, 1.0]` across the clip timeline span `startTime + ratio * duration`.
- `addMarker(time, name, payload?)`: Inserts a timeline marker in ascending timestamp order (preserving insertion order for ties).
- `getMarkersInRange(startTime, endTime)`: Returns markers located within `[startTime, endTime]`.
- `sampleCrossedMarkers(prevTime, currTime)`: Returns markers crossed across the half-open interval `(prevTime, currTime]` during forward playback or `[currTime, prevTime)` in descending timestamp order during reverse playback. Returns `[]` when `prevTime === currTime`.
- `startTime` & `endTime`: Bounding time limits across non-empty tracks (`startTime = min(0, minTrackStart)`, `endTime = maxTrackEnd`).
- `duration`: Clip timeline span `maxTrackEnd - min(0, minTrackStart)` across non-empty tracks (distinct from an individual `Track.duration`, which is `track.endTime - track.startTime`).

---

## 5. Rate Stepping and Cadence Decay

`Cadence` provides frame-rate independent decays, critically damped followers, and discrete time quantizers (`cadence.ts`).

```typescript
import { Cadence, FixedCadence } from "@asciiz/atoolkit/atempo";

const current = 0.0;
const target = 10.0;
const deltaSec = 1 / 60;

// Frame-rate independent exponential decay
const smoothed = Cadence.expDecay(current, target, 8.0, deltaSec);

// Deterministic 60 Hz physics accumulator
const sim = new FixedCadence(1 / 60, 5, "drop");
const res = sim.update(deltaSec, (fixedDt) => {
	void fixedDt;
});
void smoothed;
void res;
```

- `Cadence.expDecay(current, target, decay, dt)`: Computes $target + (current - target) \cdot e^{-decay \cdot dt}$. Throws `RangeError` if `dt < 0` or non-finite; returns `current` when `dt === 0`.
- `Cadence.damp(current, target, smoothTime, maxSpeed, dt, velocityRef, velocityIndex?)`: Evaluates critically damped spring-damper follower. Mutates velocity in-place at `velocityRef[velocityIndex ?? 0]`. Throws `RangeError` if `dt < 0` or non-finite.
- `Cadence.quantizeTime(time, targetFps)`: Snaps continuous timestamp to stepped frame interval $\lfloor t \cdot fps \rfloor / fps$ (e.g. 12 FPS or 24 FPS stepping).
- `Cadence.hysteresis(current, target, threshold)`: Rejects delta updates smaller than threshold to prevent value chatter.
- `Cadence.debounce(time, lastTriggerTime, cooldown)`: Returns `true` only when elapsed time since last trigger exceeds cooldown.
- `FixedCadence`: Accumulates elapsed delta time, executing step callback for each fixed tick `fixedDt`. Clamps accumulated steps to `maxSubSteps`, handles overflow via `"drop"` or `"retain"` mode, and exposes `alpha` in `[0, 1)` for visual interpolation between simulation ticks.

---

## 6. Analytical Harmonic Spring Dynamics

`Spring` implements closed-form analytical solutions for 2nd-order harmonic oscillators across undamped, under-damped, critically damped, and over-damped regimes (`spring.ts`).

```typescript
import { Spring } from "@asciiz/atoolkit/atempo";

const spring = new Spring(3.0, 0.7);
const state: [number, number] = [0.0, 0.0]; // [position, velocity]
const targetPosition = 5.0;
const deltaSec = 1 / 60;

spring.updateScalar(state[0], state[1], targetPosition, deltaSec, state);
```

- Mathematical formulation: Solves 2nd-order differential equation $\ddot{x} + 2 \zeta \omega \dot{x} + \omega^2 (x - x_{\text{target}}) = 0$.
- Configuration:
  - `frequency: number`: Natural oscillation frequency in Hz ($\omega = 2 \pi f$).
  - `damping: number`: Damping ratio $\zeta \ge 0$.
    - $\zeta = 0$: Undamped simple harmonic oscillation with exact energy conservation.
    - $0 < \zeta < 1.0$: Under-damped oscillation with damped frequency $\omega_d = \omega \sqrt{1 - \zeta^2}$.
    - $\zeta = 1.0$: Critically damped motion with fastest non-oscillatory convergence.
    - $\zeta > 1.0$: Over-damped non-oscillatory two-root exponential decay.
- `updateScalar(position, velocity, target, dt, out)`: Evaluates exact analytical position and velocity for `dt`, writing `[newPosition, newVelocity]` into `out`. Throws `RangeError` if `dt < 0` or non-finite.
- `updateArray(positions, velocities, targets, dt)`: Evaluates multiple spring channels in-place across typed arrays.

---

## 7. Periodic Harmonics and Metronome Tracking

`Phase` and `Metronome` evaluate cyclic phase coordinates, analytic waveforms, and beat boundary triggers (`phase.ts`).

```typescript
import { Phase, Metronome } from "@asciiz/atoolkit/atempo";

// 120 BPM cyclic metronome
const metro = new Metronome(120);
const state = metro.sample(0.5);
const wave = Phase.sine(state.phase);
void wave;
```

- `Phase.cycle(timeSec, frequencyHz, phaseOffset)`: Converts continuous time to normalized cyclic phase in `[0.0, 1.0)`.
- Analytic waveforms:
  - `Phase.sine(phase)`: Sine wave mapped to `[-1.0, 1.0]`.
  - `Phase.cosine(phase)`: Cosine wave mapped to `[-1.0, 1.0]`.
  - `Phase.triangle(phase)`: Symmetric linear triangle wave mapped to `[-1.0, 1.0]`.
  - `Phase.saw(phase)`: Linear ramp sawtooth wave mapped to `[-1.0, 1.0]`.
  - `Phase.square(phase, dutyCycle)`: Discrete square pulse wave evaluating to `1.0` or `-1.0`.
  - `Phase.impulse(phase, sharpness)`: Exponential decay pulse $e^{-\text{sharpness} \cdot p}$ peaking at 1.0 on cycle start.
  - `Phase.wrap(value, min, max)`: Wraps scalar coordinate into `[min, max)` range.
- `Metronome`:
  - `setBpm(bpm)` & `setFrequency(hz)`: Updates internal frequency.
  - `sample(timeSec)`: Evaluates total cycles, fractional phase in `[0, 1)`, 4-beat bar index, boundary crossing flag `justTriggered`, and exponential decay kick impulse.
