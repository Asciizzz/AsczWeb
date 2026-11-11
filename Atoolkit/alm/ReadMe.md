# Alm (3D Linear Algebra & Spatial Math)

High-performance, zero-allocation 3D linear algebra and spatial mathematics library for WebGPU and high-framerate rendering pipelines. All vector, quaternion, and matrix types extend native `Float32Array` directly, providing dual ergonomics: named component accessors (`.x`, `.y`, `.z`, `.w`), fluent zero-allocation in-place operations, static procedural procedures with `out` destination buffers, and direct typed-array interoperability.

---

## Architecture & Memory Layout

Every mathematical entity in `alm` subclasses `Float32Array` at a fixed component stride, guaranteeing zero serialization cost when writing directly into WebGPU buffers (`device.queue.writeBuffer`) or passing to WebGL uniforms.

| Type | Dimensions | Backing Storage | Memory Size | Memory Layout |
| :--- | :--- | :--- | :--- | :--- |
| `Vec2` | 2D Vector | `Float32Array(2)` | 8 bytes | `[x, y]` |
| `Vec3` | 3D Vector | `Float32Array(3)` | 12 bytes | `[x, y, z]` |
| `Vec4` | 4D Vector | `Float32Array(4)` | 16 bytes | `[x, y, z, w]` |
| `Quat` | Quaternion | `Float32Array(4)` | 16 bytes | `[x, y, z, w]` (Hamiltonian, identity `w = 1`) |
| `Mat3` | 3x3 Matrix | `Float32Array(9)` | 36 bytes | Column-major 3x3 layout |
| `Mat4` | 4x4 Matrix | `Float32Array(16)` | 64 bytes | Column-major 4x4 layout |
| `Ray` | Ray Primitive | Object composite | 24 bytes | Origin `Vec3`, Direction `Vec3` |
| `Plane` | 3D Plane | Object composite | 16 bytes | Normal `Vec3`, Constant `number` |
| `AABB` | Bounding Box | Object composite | 24 bytes | Min `Vec3`, Max `Vec3` |
| `Sphere` | Bounding Sphere | Object composite | 16 bytes | Center `Vec3`, Radius `number` |
| `Frustum` | Camera Frustum | Object composite | 96 bytes | 6 clipping `Plane` instances |

---

## 1. Dual Ergonomics: Fluent In-Place vs. Static Zero-Allocation

`alm` supports two complementary execution paradigms without runtime overhead:
1. **Fluent Instance Methods**: Methods such as `v.add(b)` or `v.scale(s)` mutate the instance in place and return `this`, enabling expressive chaining without heap allocations. When an `out` parameter is explicitly provided (`v.add(b, out)`), results are written directly to `out`.
2. **Static Procedural Methods**: Methods such as `Vec3.add(a, b, out)` accept arbitrary `ArrayLike<number>` inputs and write directly into a destination buffer `out`. If `out` is omitted, a new instance is allocated.
3. **Standard Class & Factory Construction**: Primitives are constructed via `new Vec3(x, y, z)` or static factories such as `Vec3.create(x, y, z)` and preserve `Float32Array` prototype inheritance. Shared static constants (`Vec3.ZERO`, `Vec3.UP`, `Quat.IDENTITY`, `Mat4.IDENTITY`, etc.) are frozen via `Object.freeze`.

```typescript
import { Vec3 } from "@asciiz/atoolkit/alm";

// Fluent in-place mutation (0 heap allocations)
const velocity = new Vec3(1, 0, 0);
const acceleration = new Vec3(0, 9.8, 0);
velocity.addScaled(acceleration, 0.016).normalize();

// Static procedural form with preallocated destination (0 heap allocations)
const posA = new Vec3(10, 20, 30);
const posB = new Vec3(5, 5, 5);
const outPos = new Vec3();
Vec3.sub(posA, posB, outPos);

// Packed Float32Array read/write at arbitrary float offset
const packed = new Float32Array(16);
outPos.toArray(packed, 3);
const readBack = new Vec3().fromArray(packed, 3);
void readBack;
```

### Technical Breakdown
- `Vec3.prototype.addScaled(b, s, out = this)`: Scales vector `b` by scalar `s`, adds to current instance, writes to `out`, and returns `out`. Defaults to mutating `this`.
- `Vec3.prototype.normalize(out = this)`: Evaluates Euclidean magnitude with an epsilon threshold (`EPSILON = 1e-6`) to prevent division by zero, writes unit vector to `out`, and returns `out`.
- `Vec3.sub(a, b, out)`: Subtracts vector `b` from vector `a`, writes result to `out`, and returns `out`.
- `Vec3.prototype.fromArray(arr, offset)` / `toArray(out, offset)`: Reads or writes components directly at a float offset inside a packed array or `Float32Array`.

---

## 2. Vectors (`Vec2`, `Vec3`, `Vec4`)

Vector classes provide named getters and setters (`.x`, `.y`, `.z`, `.w`), color aliases (`.r`, `.g`, `.b`, `.a`), texture coordinate aliases (`.u`, `.v`), and complete geometric routines.

```typescript
import { Vec2, Vec3, Vec4 } from "@asciiz/atoolkit/alm";

// Vec2: Texture coordinates and 2D bounds
const uv = new Vec2(0.5, 0.5);
uv.u += 0.1;
uv.v *= 2.0;

// Vec3: 3D vector arithmetic and geometry
const eye = new Vec3(0, 5, 10);
const target = new Vec3(0, 0, 0);
const forward = target.clone().sub(eye).normalize();
const right = Vec3.cross(forward, Vec3.UP);
const distance = eye.distance(target);
void right;
void distance;

// Vec4: Homogeneous coordinates and RGBA colors
const color = new Vec4(1, 0.5, 0.2, 1.0);
color.r = Math.min(1.0, color.r * 1.2);
```

### Technical Breakdown
- `Vec2.prototype.u` / `v` / `width` / `height`: Explicit coordinate aliases referencing backing float elements index 0 and 1.
- `Vec3.UP`, `DOWN`, `RIGHT`, `LEFT`, `FORWARD`, `BACK`, `ZERO`, `ONE`: Static standard axis tuples.
- `Vec3.cross(a, b, out)`: Computes 3D cross product `a x b`. Evaluates vector perpendicular to the plane spanned by `a` and `b`.
- `Vec3.slerp(a, b, t, out)`: Spherical linear interpolation between unit-direction vectors `a` and `b`. Falls back to normalized linear interpolation when `dot(a, b) > 0.9995`, uses the normalized perpendicular residual `(b - dot(a, b) * a)` for general and near-antipodal angles, and when `a` and `b` are exact antipodes (`dot(a, b) === -1`), rotates by `PI` in the plane spanned by `a` and the coordinate axis least aligned with `a` (ties broken deterministically in `X`, `Y`, `Z` order).
- `Vec3.prototype.distance(b)`: Computes Euclidean distance between this vector and `b` via `Math.hypot`.
- `Vec4.prototype.r` / `g` / `b` / `a`: Component aliases mapped to index positions 0, 1, 2, and 3.

---

## 3. Quaternions (`Quat`)

`Quat` implements Hamiltonian quaternion algebra stored in `[x, y, z, w]` order (with scalar real component at index 3). Quaternions prevent gimbal lock and provide smooth spherical linear interpolation (`slerp`).

```typescript
import { Quat, Vec3 } from "@asciiz/atoolkit/alm";

// Axis-angle rotation
const qRot = Quat.fromAxisAngle(Vec3.UP, Math.PI * 0.5);

// Euler rotation (XYZ radians)
const qEuler = Quat.fromEuler(0, Math.PI * 0.25, 0);

// Combine rotations via Hamiltonian multiplication: combined = qRot * qEuler
const qCombined = Quat.mul(qRot, qEuler);

// Rotate vector directly via quaternion without constructing a matrix
const forwardDir = new Vec3(0, 0, -1);
const rotatedDir = Vec3.transformQuat(forwardDir, qCombined);
void rotatedDir;

// Spherical linear interpolation between orientations
const qTarget = Quat.fromAxisAngle(Vec3.RIGHT, Math.PI * 0.5);
const qBlended = Quat.slerp(qRot, qTarget, 0.5);
void qBlended;
```

### Technical Breakdown
- `Quat.IDENTITY`: Constant unit quaternion tuple `[0, 0, 0, 1]`.
- `Quat.fromAxisAngle(axis, rad, out)`: Constructs unit quaternion representing rotation of `rad` radians around normalized `axis`.
- `Quat.fromEuler(x, y, z, order, out)`: Constructs unit quaternion from Euler angles in the specified rotation sequence (default `"XYZ"`).
- `Quat.mul(a, b, out)`: Evaluates Hamilton product of quaternions `a` and `b`.
- `Vec3.transformQuat(v, q, out)` / `Vec3.prototype.transformQuat(q, out)`: Rotates 3D vector `v` directly using Rodriguez quaternion conjugation `v' = v + 2*r x (r x v + w*v)` with 0 matrix allocations.
- `Quat.slerp(a, b, t, out)`: Performs spherical linear interpolation along the shortest geodesic arc on the 4D hypersphere with fallback to linear interpolation when orientations are near-parallel.

---

## 4. Matrices (`Mat3`, `Mat4`)

`Mat3` and `Mat4` represent column-major transformation matrices. `Mat4` supports TRS composition, direct axis rotations, general inversion, normal matrix calculation, and multiple clip-space projection modes.

```typescript
import { Mat4, Vec3, Quat, DEG2RAD } from "@asciiz/atoolkit/alm";

// Model matrix construction from Position, Rotation, Scale
const position = new Vec3(0, 2, -5);
const rotation = Quat.fromAxisAngle(Vec3.UP, 45 * DEG2RAD);
const scale = new Vec3(1, 1, 1);
const model = Mat4.fromTRS(position, rotation, scale);

// In-place rotation around specific axes
model.rotateY(15 * DEG2RAD);

// General 4x4 matrix inversion (returns null if singular)
const view = Mat4.invert(model, new Mat4())!;

// WebGPU zero-to-one [0, 1] perspective projection
const projWebGPU = Mat4.perspectiveZO(60 * DEG2RAD, 16 / 9, 0.1, 1000.0);

// WebGL negative-one-to-one [-1, 1] perspective projection
const projWebGL = Mat4.perspectiveNO(60 * DEG2RAD, 16 / 9, 0.1, 1000.0);

// Reversed-Z [1, 0] perspective projection
const projRevZ = Mat4.perspectiveReversedZ(60 * DEG2RAD, 16 / 9, 0.1, 1000.0);
void projWebGL;
void projRevZ;

// Compute combined View-Projection matrix
const viewProj = Mat4.mul(projWebGPU, view);
void viewProj;
```

### Technical Breakdown
- `Mat4.fromTRS(pos, rotQ, scale, out)`: Synthesizes complete 4x4 affine model matrix directly from translation vector, quaternion rotation, and scale vector into column-major order.
- `Mat4.prototype.rotateX(rad, out)` / `rotateY` / `rotateZ`: In-place rotations modifying matrix column vectors directly through trigonometric additions, avoiding temporary matrix allocation.
- `Mat4.invert(m, out, minAbsDet)`: Full general 4x4 matrix inverse using cofactor expansion. Returns `null` and leaves `out` unmodified if `|det| <= minAbsDet`.
- `Mat4.normalMatrix(m, out, minAbsDet)`: Computes the inverse-transpose of the upper-left 3x3 submatrix of `m` for transforming surface normals under non-uniform scaling. Returns `null` and leaves `out` unmodified if the upper-left 3x3 submatrix is singular.
- `Mat4.perspectiveZO(fovy, aspect, near, far, out)` / `Mat4.orthoZO(...)`: Projection matrices mapping depth into $[0, 1]$ clip space (WebGPU default).
- `Mat4.perspectiveNO(fovy, aspect, near, far, out)` / `Mat4.orthoNO(...)`: Projection matrices mapping depth into $[-1, 1]$ clip space (OpenGL/WebGL).
- `Mat4.perspectiveReversedZ(fovy, aspect, near, far, out)` / `Mat4.orthoReversedZ(...)`: Projection matrices mapping near plane to $z_{ndc} = 1$ and far plane to $z_{ndc} = 0$.

---

## 5. Point & Normal Transformations

`Vec3` provides zero-allocation point, normal, and quaternion transformations with `fromArray` / `toArray` helpers for processing packed vertex buffers without intermediate allocations.

```typescript
import { Mat4, Vec3 } from "@asciiz/atoolkit/alm";

const vertexCount = 4;
const sourcePositions = new Float32Array(vertexCount * 3);
const transformedPositions = new Float32Array(vertexCount * 3);

const transformMatrix = Mat4.fromTranslation([10, 20, 30]);
const scratch = new Vec3();

for (let i = 0; i < vertexCount; i++) {
	const offset = i * 3;
	scratch.fromArray(sourcePositions, offset).transformMat4(transformMatrix).toArray(transformedPositions, offset);
}
```

### Technical Breakdown
- `Vec3.transformMat4(a, m, out)`: Transforms a 3D point by a 4x4 matrix with perspective division ($w \neq 1$).
- `Vec3.transformMat4Normal(a, m, out)`: Transforms a 3D directional vector (normal, tangent) using the upper-left 3x3 basis of `m` without translation ($w = 0$).
- `Vec3.transformMat3(a, m, out)`: Transforms a 3D vector by a 3x3 matrix.

---

## 6. Spatial Primitives & Camera Culling (`Ray`, `Plane`, `AABB`, `Sphere`, `Frustum`)

`alm` provides geometric primitives designed specifically for raycasting, bounding volume hierarchies (BVH), and camera view frustum culling in 3D scenes.

```typescript
import { Ray, Sphere, AABB, Frustum, Mat4, Vec3 } from "@asciiz/atoolkit/alm";

// Raycasting against AABB and Sphere
const ray = new Ray(new Vec3(0, 0, -10), new Vec3(0, 0, 1));
const box = new AABB(new Vec3(-1, -1, -1), new Vec3(1, 1, 1));
const hitPoint = ray.intersectAABB(box); // Returns hit point Vec3 or null
const sphere = new Sphere(new Vec3(0, 0, 0), 2.0);
const hitSphere = ray.intersectSphere(sphere);

// Camera Frustum Culling
const viewProj = Mat4.perspectiveZO(Math.PI / 3, 16 / 9, 0.1, 500.0);
const frustum = new Frustum().fromViewProjection(viewProj, "zero-to-one");

// Fast AABB frustum visibility test (positive vertex test)
const isVisible = frustum.intersectsAABB(box);
if (isVisible && hitPoint && hitSphere) {
	// Submit mesh draw call to GPU command encoder
}
```

### Technical Breakdown
- `Ray.prototype.intersectAABB(aabb, out?)`: Evaluates ray vs. axis-aligned bounding box intersection using the slab method (handling boundary-parallel rays without `NaN`). Returns the entry (or forward exit when starting inside) intersection point `Vec3`, or `null` if the ray misses. `intersectAABBDist(aabb)` returns the scalar distance `t >= 0` or `null`.
- `Ray.prototype.intersectSphere(sphere, out?)`: Evaluates analytic ray-sphere intersection. Returns the intersection point `Vec3` (`t >= 0`) or `null`. `intersectSphereDist(sphere)` returns the scalar distance `t >= 0` or `null`.
- `AABB.prototype.transformMat4(m, out)`: Transforms the 8 bounding corners of this box by matrix `m` and computes the resulting axis-aligned bounding extents.
- `Frustum.prototype.fromViewProjection(vp, clipDepthMode = "zero-to-one")`: Extracts the 6 frustum clipping planes (Left, Right, Bottom, Top, Near, Far) from a combined View-Projection matrix using the Gribb-Hartmann algorithm. Supports both `"zero-to-one"` ($[0, 1]$) and `"neg-one-to-one"` ($[-1, 1]$) clip depth modes.
- `Frustum.prototype.intersectsAABB(aabb)`: Tests bounding box against all 6 frustum planes using positive vertex testing. Returns `false` immediately upon discovering an outside plane (fast rejection), avoiding redundant draw calls for invisible objects.
