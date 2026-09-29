# Atempo

Temporal orchestration, cadence quantization, and keyframe sequence evaluation primitives. Decouples interval time-shaping functions from concrete data interpolation.

---

## Architecture Overview

Atempo structures temporal operations across seven primitives:

1. `Track<T, TOut>`: Sequence interpolation base class with contiguous timestamp indexing and O(1) cached interval lookup.
2. `Curve`: Unary scalar transfer function `(t: number) => number` shaping interval progress.
3. `Clip`: Multi-track timeline container evaluating heterogeneous tracks simultaneously at common timestamp.
4. `Cadence`: Exponential half-life decays, critically damped followers, and discrete frame quantizers.
5. `FixedCadence`: Deterministic simulation timestep accumulator decoupling render frames from discrete ticks.
6. `Spring`: Closed-form analytical 2nd-order damped harmonic oscillator.
7. `Phase` & `Metronome`: Periodic phase coordinate arithmetic, cyclic waveforms, and beat boundary trackers.

---

## 1. Sequence Interpolation Base Class

`Track<T, TOut = T>` manages chronological keyframe sequences, locates active interval spans, and shapes interval progress before calling data interpolation.

```typescript
import { Track } from "./track.js";
import { type Curve } from "./curve.js";

export class FloatTrack extends Track<number, number> {
    blend(a: number, b: number, alpha: number): number {
        return a + (b - a) * alpha;
    }

    protected defaultValue(): number {
        return 0;
    }
}
```

- Storage layout:
  - `_times: Float64Array`: Resizable contiguous array of double-precision timestamps maintaining ascending chronological order.
  - `_values: T[]`: Ordered array storing keyframe values corresponding to each timestamp.
  - `_curves: (Curve | undefined)[]`: Ordered array storing interval transfer functions applied across span `[i, i + 1]`.
- `addKey(time, value, curve)`: Inserts keyframe. Appends in O(1) when timestamp exceeds tail; executes binary search insertion sort in O(N) when inserting out-of-order.
- `removeKey(index)`: Shifts timestamp array via `copyWithin` and splices value arrays in O(N).
- `sample(time, out)`: Evaluates active interval span, computes normalized alpha `(time - t0) / (t1 - t0)`, evaluates interval curve `curve(tau)`, and calls `blend(a, b, alpha, out)`.
- `getKey(index)`: Returns keyframe object `{ time, value, curve }` at index, or `undefined` if out of bounds.
- `extrapolation`: Configures boundary handling:
  - `Extrapolation.Clamp`: Holds boundary value when time is before start or after end.
  - `Extrapolation.Loop`: Wraps evaluation time into `[startTime, endTime)` range via modulo arithmetic.
  - `Extrapolation.PingPong`: Reflects evaluation time back and forth across track duration.
- Operational invariants:
  - Caches last sampled interval index `_cachedIndex` for O(1) sequential playback lookup.
  - Falls back to O(log N) binary search on random seek or playback reversal.
  - Reuses provided `out` buffer in subclasses to maintain zero allocations during playback.

---

## 2. Track Presets

Concrete track implementations reside in `tracks/` folder to allow modular imports without unused data math.

### 2.1 FloatTrack

Evaluates scalar floating-point sequences (`tracks/float.ts`).

```typescript
import { FloatTrack } from "./tracks/float.js";

const track = new FloatTrack();
track.addKey(0.0, 0.0);
track.addKey(1.0, 100.0);

const val = track.sample(0.5); // 50.0
```

- `blend(a, b, alpha)`: Evaluates linear interpolation `a + (b - a) * alpha`. Returns primitive number with zero heap allocation.
- `defaultValue()`: Returns `0`.

### 2.2 VecTrack

Evaluates N-dimensional vector sequences (`tracks/vec.ts`).

```typescript
import { VecTrack } from "./tracks/vec.js";

const posTrack = new VecTrack(3);
posTrack.addKey(0.0, [0, 10, 20]);
posTrack.addKey(2.0, [100, 110, 120]);

const out = new Float32Array(3);
posTrack.sample(1.0, out); // out is [50, 60, 70]
```

- Storage & configuration:
  - `dimension: number`: Component count per keyframe (e.g. 2 for Vec2, 3 for Vec3, 4 for Vec4).
- `blend(a, b, alpha, out)`: Linearly interpolates each vector component across dimension: `out[i] = a[i] * (1 - alpha) + b[i] * alpha`.
- Operational invariant: Allocates `Float32Array(dimension)` only when `out` parameter is omitted. Mutates caller-provided `out` buffer in-place without heap allocations.

### 2.3 QuatTrack

Evaluates 4D quaternion orientations via spherical linear interpolation (`tracks/quat.ts`).

```typescript
import { QuatTrack } from "./tracks/quat.js";

const rotTrack = new QuatTrack();
rotTrack.addAxisAngleKey(0.0, [0, 1, 0], 0.0);
rotTrack.addAxisAngleKey(2.0, [0, 1, 0], Math.PI);

const outQuat = new Float32Array(4);
rotTrack.sample(1.0, outQuat);
```

- `blend(a, b, alpha, out)`: Evaluates spherical linear interpolation (SLERP).
  - Dot product evaluation: Computes `dot = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w`.
  - Antipodal check: When `dot < 0`, negates quaternion `b` and sets `dot = -dot` to enforce acute shortest-path rotation (arc <= 180 degrees).
  - Singularity threshold: When `dot > 0.9995`, falls back to normalized linear interpolation to avoid division by zero in `sin(theta)`.
  - Renormalization: Normalizes output vector to ensure unit quaternion length.
- `addAxisAngleKey(time, axis, rad, curve)`: Converts axis-angle rotation into quaternion `[x*s, y*s, z*s, cos(rad/2)]` and appends keyframe.
- Operational invariant: Mutates caller-provided `Float32Array(4)` in-place.

### 2.4 ColorTrack

Evaluates RGB or RGBA color channels with perceptual gamma or linear blending (`tracks/color.ts`).

```typescript
import { ColorTrack, ColorSpace } from "./tracks/color.js";

const colorTrack = new ColorTrack(4, ColorSpace.PerceptualGamma);
colorTrack.addKey(0.0, [1, 0, 0, 1]);
colorTrack.addKey(1.0, [0, 1, 0, 1]);

const outCol = new Float32Array(4);
colorTrack.sample(0.5, outCol); // Midpoint red/green evaluate to ~0.7071
```

- Storage & configuration:
  - `dimension: number`: Channel count (3 for RGB, 4 for RGBA).
  - `colorSpace: ColorSpace`: `ColorSpace.PerceptualGamma` or `ColorSpace.Linear`.
- `blend(a, b, alpha, out)`:
  - Under `ColorSpace.PerceptualGamma`: Blends RGB channels in squared space `sqrt((1 - alpha) * a^2 + alpha * b^2)` to preserve luminance energy and eliminate dark midpoint dips. Interpolates alpha channel linearly.
  - Under `ColorSpace.Linear`: Evaluates standard linear interpolation across all channels.
- Operational invariant: Mutates caller-provided `Float32Array` in-place.

---

## 3. Transfer Curves

A curve is a unary scalar function mapping normalized interval progress `t` in `[0, 1]` to shaped evaluation alpha:

```typescript
export type Curve = (t: number) => number;
```

Curves reside in `curves/` as stateless functions or parameter factories:

```typescript
import { FloatTrack } from "./tracks/float.js";
import { quadInOut } from "./curves/quad.js";
import { step } from "./curves/step.js";
import { bezier } from "./curves/bezier.js";

const track = new FloatTrack();

// Direct function preset
track.addKey(0.0, 0.0, quadInOut);

// Parameterized factory closure
track.addKey(1.0, 50.0, step(8));
track.addKey(2.0, 100.0, bezier(0.25, 0.1, 0.25, 1.0));

// Inline closure
track.addKey(3.0, 200.0, (t) => t * t * t);
```

### Curve Presets Catalog

| Curve | File | Signature | Transfer Formula |
| :--- | :--- | :--- | :--- |
| `linear` | `curves/linear.ts` | `Curve` | $f(t) = t$ |
| `quadIn` | `curves/quad.ts` | `Curve` | $f(t) = t^2$ |
| `quadOut` | `curves/quad.ts` | `Curve` | $f(t) = t(2 - t)$ |
| `quadInOut` | `curves/quad.ts` | `Curve` | $t < 0.5 ? 2t^2 : -1 + (4 - 2t)t$ |
| `cubicIn` | `curves/cubic.ts` | `Curve` | $f(t) = t^3$ |
| `cubicOut` | `curves/cubic.ts` | `Curve` | $f(t) = (t - 1)^3 + 1$ |
| `cubicInOut` | `curves/cubic.ts` | `Curve` | $t < 0.5 ? 4t^3 : (t - 1)(2t - 2)^2 + 1$ |
| `expoIn` | `curves/expo.ts` | `Curve` | $f(t) = 2^{10(t - 1)}$ |
| `expoOut` | `curves/expo.ts` | `Curve` | $f(t) = 1 - 2^{-10t}$ |
| `expoInOut` | `curves/expo.ts` | `Curve` | Piecewise base-2 exponential |
| `step(steps)` | `curves/step.ts` | `(steps?: number) => Curve` | $f(t) = \lfloor t \cdot s \rfloor / s$ |
| `overshoot(amount)` | `curves/overshoot.ts` | `(amount?: number) => Curve` | Back polynomial with tension $s = \text{amount} \cdot 1.70158$ |
| `bounce` | `curves/bounce.ts` | `Curve` | 4-stage piecewise bounce polynomial |
| `elastic` | `curves/elastic.ts` | `Curve` | Exponentially decaying sine oscillation |
| `holdSnap(frac, over)` | `curves/holdSnap.ts` | `(...) => Curve` | Binary step with overshoot plateau |
| `bezier(x1, y1, x2, y2)` | `curves/bezier.ts` | `(...) => Curve` | Parametric cubic Bezier via Newton-Raphson |

- `bezier(x1, y1, x2, y2)` solves cubic parametric polynomial $X(u) = t$ using 8-iteration Newton-Raphson root finding, falling back to bisection if divergence occurs, then evaluates $Y(u)$.

---

## 4. Multi-Track Timeline Composition

`Clip` manages multiple named `Track` instances on a shared timeline, evaluating all tracks simultaneously into a target dictionary (`clip.ts`).

```typescript
import { Clip } from "./clip.js";
import { FloatTrack } from "./tracks/float.js";
import { VecTrack } from "./tracks/vec.js";

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
}
```

- Storage layout:
  - `_tracks: Map<string, Track<any, any>>`: Map storing registered tracks by string name.
  - `_markers: ClipMarker[]`: Array of timeline cue markers sorted chronologically by time.
- `addTrack(name, track)`: Registers named track in clip, returning track instance.
- `getTrack(name)`: Retrieves track by name, or `undefined` if not registered.
- `sample(time, target)`: Evaluates all registered tracks at timestamp, writing results into `target[name]`. Reuses existing typed arrays in `target` to maintain zero heap allocations.
- `addMarker(time, label, data)`: Inserts timeline marker and sorts marker array by time.
- `getMarkersInRange(start, end, out?)`: Returns markers located within interval `[start, end]`. Writes into optional `out` array for zero heap allocations.
- `sampleCrossedMarkers(previousTime, currentTime, out?)`: Returns markers crossed within time window. Writes into optional `out` array for zero heap allocations. Evaluates ascending order during forward playback; descending order during reverse playback.
- `duration`: Returns maximum duration among registered tracks.
- `startTime` & `endTime`: Returns bounding time limits across active tracks.

---

## 5. Rate Stepping and Cadence Decay

`Cadence` provides frame-rate independent decays, critically damped followers, and discrete time quantizers (`cadence.ts`).

```typescript
import { Cadence, FixedCadence } from "./cadence.js";

// Frame-rate independent decay: closes half the remaining gap every 0.15 seconds
const smoothed = Cadence.decay(current, target, 0.15, deltaSec);

// Deterministic 60 Hz physics accumulator
const sim = new FixedCadence(60, 5);
const alpha = sim.update(deltaSec, (fixedDt, simTime) => {
    physicsWorld.step(fixedDt);
});
```

- `Cadence.decay(current, target, halfLife, deltaSec)`: Computes factor $e^{-\frac{\ln(2) \cdot \Delta t}{\text{halfLife}}}$ and returns `target + (current - target) * factor`. Guarantees identical convergence over real-world seconds regardless of frame rate.
- `Cadence.damp(current, target, velocityRef, smoothTime, deltaSec, maxSpeed)`: Evaluates critically damped spring-damper follower. Mutates velocity in-place at `velocityRef[0]`. Clamps maximum speed and prevents target overshoot.
- `Cadence.quantizeTime(time, targetFps)`: Snaps continuous timestamp to stepped frame interval $\lfloor t \cdot fps \rfloor / fps$ (e.g. 12 FPS or 24 FPS stepping).
- `Cadence.hysteresis(current, target, threshold)`: Rejects delta updates smaller than threshold to prevent value chatter.
- `Cadence.debounce(time, lastTriggerTime, cooldown)`: Returns `true` only when elapsed time since last trigger exceeds cooldown.
- `FixedCadence`: Accumulates elapsed delta time, executing step callback for each fixed tick `fixedDelta = 1 / targetHz`. Drops residual time if steps exceed `maxSubSteps` to avoid execution stalls. Returns fractional interpolation alpha in `[0, 1)` for visual rendering between simulation ticks.

---

## 6. Analytical Harmonic Spring Dynamics

`Spring` implements closed-form analytical solutions for damped harmonic oscillators, maintaining numerical stability across variable delta times (`spring.ts`).

```typescript
import { Spring } from "./spring.js";

const spring = new Spring(3.0, 0.7);
const state = new Float32Array([0.0, 0.0]); // [position, velocity]

spring.update(state, targetPosition, deltaSec);
```

- Mathematical formulation: Solves 2nd-order differential equation $m \ddot{x} + c \dot{x} + k(x - x_{\text{target}}) = 0$.
- Configuration:
  - `frequency: number`: Natural oscillation frequency in Hz. Angular frequency $\omega = 2 \pi f$.
  - `damping: number`: Damping ratio $\zeta$.
    - $\zeta < 1.0$: Under-damped oscillation with characteristic frequency $\omega_d = \omega \sqrt{1 - \zeta^2}$.
    - $\zeta = 1.0$: Critically damped motion with fastest settling time and zero overshoot.
    - $\zeta > 1.0$: Over-damped non-oscillatory exponential decay.
- `update(posVel, target, deltaSec)`: Evaluates exact analytical position and velocity for elapsed deltaSec. Mutates `posVel[0]` (position) and `posVel[1]` (velocity) in-place without heap allocations.
- `updateVector(posArray, velArray, targetArray, dimension, deltaSec, ...)`: Evaluates multiple spring channels across contiguous arrays using index offsets.

---

## 7. Periodic Harmonics and Metronome Tracking

`Phase` and `Metronome` evaluate cyclic phase coordinates, analytic waveforms, and beat boundary triggers (`phase.ts`).

```typescript
import { Phase, Metronome } from "./phase.js";

// 120 BPM cyclic metronome
const metro = new Metronome(120);
const state = metro.sample(timeSec);
// state.cycle: Total integer cycles elapsed
// state.phase: Normalized cyclic progress in [0.0, 1.0)
// state.justTriggered: True on frame crossing cycle boundary
// state.impulse: Exponential decay kick pulse from 1.0
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
