import { EPSILON, RAD2DEG } from "./constants.js";
import { Vec3 } from "./vec3.js";

export class _Quat extends Float32Array {
    static get [Symbol.species](): Float32ArrayConstructor {
        return Float32Array;
    }

    static readonly IDENTITY: Readonly<_Quat> = new _Quat(0, 0, 0, 1);

    constructor();
    constructor(x: number, y: number, z: number, w: number);
    constructor(elements: ArrayLike<number>);
    constructor(buffer: ArrayBufferLike, byteOffset?: number);
    constructor(a?: number | ArrayLike<number> | ArrayBufferLike, b?: number, c?: number, d?: number) {
        if (a instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && a instanceof SharedArrayBuffer)) {
            super(a as ArrayBuffer, b ?? 0, 4);
        } else {
            super(4);
            if (typeof a === "number") {
                this[0] = a;
                if (typeof b === "number") this[1] = b;
                if (typeof c === "number") this[2] = c;
                this[3] = typeof d === "number" ? d : 1;
            } else if (a && "length" in a) {
                this[0] = a[0] ?? 0;
                this[1] = a[1] ?? 0;
                this[2] = a[2] ?? 0;
                this[3] = a[3] ?? 1;
            } else {
                this[3] = 1;
            }
        }
    }

    get x(): number {
        return this[0];
    }
    set x(val: number) {
        this[0] = val;
    }

    get y(): number {
        return this[1];
    }
    set y(val: number) {
        this[1] = val;
    }

    get z(): number {
        return this[2];
    }
    set z(val: number) {
        this[2] = val;
    }

    get w(): number {
        return this[3];
    }
    set w(val: number) {
        this[3] = val;
    }

    static create(x = 0, y = 0, z = 0, w = 1): _Quat {
        return new _Quat(x, y, z, w);
    }

    static identity(out?: _Quat): _Quat {
        out ??= new _Quat();
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return out;
    }

    static view(buffer: ArrayBufferLike, byteOffset = 0): _Quat {
        return new _Quat(buffer, byteOffset);
    }

    static fromValues(x: number, y: number, z: number, w: number): _Quat {
        return new _Quat(x, y, z, w);
    }

    static fromArray(array: ArrayLike<number>, offset = 0, out?: _Quat): _Quat {
        out ??= new _Quat();
        out[0] = array[offset];
        out[1] = array[offset + 1];
        out[2] = array[offset + 2];
        out[3] = array[offset + 3];
        return out;
    }

    identity(): this {
        this[0] = 0;
        this[1] = 0;
        this[2] = 0;
        this[3] = 1;
        return this;
    }

    setValues(x: number, y: number, z: number, w: number): this {
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this[3] = w;
        return this;
    }

    copy(src: ArrayLike<number>): this {
        this[0] = src[0];
        this[1] = src[1];
        this[2] = src[2];
        this[3] = src[3];
        return this;
    }

    clone(): _Quat {
        return new _Quat(this[0], this[1], this[2], this[3]);
    }

    dot(b: ArrayLike<number>): number {
        return this[0] * b[0] + this[1] * b[1] + this[2] * b[2] + this[3] * b[3];
    }

    mul(b: ArrayLike<number>, out: _Quat = this): _Quat {
        const ax = this[0], ay = this[1], az = this[2], aw = this[3];
        const bx = b[0], by = b[1], bz = b[2], bw = b[3];
        out[0] = aw * bx + ax * bw + ay * bz - az * by;
        out[1] = aw * by - ax * bz + ay * bw + az * bx;
        out[2] = aw * bz + ax * by - ay * bx + az * bw;
        out[3] = aw * bw - ax * bx - ay * by - az * bz;
        return out;
    }

    multiply(b: ArrayLike<number>, out: _Quat = this): _Quat {
        return this.mul(b, out);
    }

    premul(a: ArrayLike<number>, out: _Quat = this): _Quat {
        const ax = a[0], ay = a[1], az = a[2], aw = a[3];
        const bx = this[0], by = this[1], bz = this[2], bw = this[3];
        out[0] = aw * bx + ax * bw + ay * bz - az * by;
        out[1] = aw * by - ax * bz + ay * bw + az * bx;
        out[2] = aw * bz + ax * by - ay * bx + az * bw;
        out[3] = aw * bw - ax * bx - ay * by - az * bz;
        return out;
    }

    len(): number {
        const x = this[0], y = this[1], z = this[2], w = this[3];
        return Math.sqrt(x * x + y * y + z * z + w * w);
    }

    lenSq(): number {
        const x = this[0], y = this[1], z = this[2], w = this[3];
        return x * x + y * y + z * z + w * w;
    }

    magnitude(): number {
        return this.len();
    }

    magnitudeSq(): number {
        return this.lenSq();
    }

    normalize(out: _Quat = this): _Quat {
        const x = this[0], y = this[1], z = this[2], w = this[3];
        const lenSq = x * x + y * y + z * z + w * w;
        if (lenSq > EPSILON * EPSILON) {
            const invLen = 1.0 / Math.sqrt(lenSq);
            out[0] = x * invLen;
            out[1] = y * invLen;
            out[2] = z * invLen;
            out[3] = w * invLen;
        } else {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            out[3] = 1;
        }
        return out;
    }

    norm(out: _Quat = this): _Quat {
        return this.normalize(out);
    }

    conjugate(out: _Quat = this): _Quat {
        out[0] = -this[0];
        out[1] = -this[1];
        out[2] = -this[2];
        out[3] = this[3];
        return out;
    }

    invert(out: _Quat = this): _Quat {
        const x = this[0], y = this[1], z = this[2], w = this[3];
        const dot = x * x + y * y + z * z + w * w;
        const inv = dot > EPSILON ? 1.0 / dot : 0;
        out[0] = -x * inv;
        out[1] = -y * inv;
        out[2] = -z * inv;
        out[3] = w * inv;
        return out;
    }

    slerp(b: ArrayLike<number>, t: number, out: _Quat = this): _Quat {
        let dot = this[0] * b[0] + this[1] * b[1] + this[2] * b[2] + this[3] * b[3];
        let bx = b[0], by = b[1], bz = b[2], bw = b[3];
        if (dot < 0) {
            dot = -dot;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }

        let scale0: number;
        let scale1: number;
        if (dot > 1.0 - EPSILON) {
            scale0 = 1.0 - t;
            scale1 = t;
        } else {
            const theta = Math.acos(dot);
            const sinTheta = Math.sin(theta);
            scale0 = Math.sin((1.0 - t) * theta) / sinTheta;
            scale1 = Math.sin(t * theta) / sinTheta;
        }

        out[0] = scale0 * this[0] + scale1 * bx;
        out[1] = scale0 * this[1] + scale1 * by;
        out[2] = scale0 * this[2] + scale1 * bz;
        out[3] = scale0 * this[3] + scale1 * bw;
        return out;
    }

    fromAxisAngle(axis: ArrayLike<number>, rad: number): this {
        const half = rad * 0.5;
        const s = Math.sin(half);
        this[0] = axis[0] * s;
        this[1] = axis[1] * s;
        this[2] = axis[2] * s;
        this[3] = Math.cos(half);
        return this;
    }

    fromEuler(x: number, y: number, z: number): this {
        const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
        const cx = Math.cos(hx), sx = Math.sin(hx);
        const cy = Math.cos(hy), sy = Math.sin(hy);
        const cz = Math.cos(hz), sz = Math.sin(hz);

        this[0] = sx * cy * cz - cx * sy * sz;
        this[1] = cx * sy * cz + sx * cy * sz;
        this[2] = cx * cy * sz - sx * sy * cz;
        this[3] = cx * cy * cz + sx * sy * sz;
        return this;
    }

    toEulerYPR(out?: Vec3): Vec3 {
        out ??= new Vec3();
        const x = this[0], y = this[1], z = this[2], w = this[3];
        const sx = 2 * (w * x - y * z);
        const clamped = Math.max(-1, Math.min(1, sx));
        const pitch = Math.asin(clamped);
        const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
        const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
        out[0] = yaw * RAD2DEG;
        out[1] = pitch * RAD2DEG;
        out[2] = roll * RAD2DEG;
        return out;
    }

    transformVec3(v: ArrayLike<number>, out?: Vec3): Vec3 {
        out ??= new Vec3();
        const vx = v[0], vy = v[1], vz = v[2];
        const qx = this[0], qy = this[1], qz = this[2], qw = this[3];
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        out[0] = vx + qw * tx + qy * tz - qz * ty;
        out[1] = vy + qw * ty + qz * tx - qx * tz;
        out[2] = vz + qw * tz + qx * ty - qy * tx;
        return out;
    }

    rotateX(rad: number, out: _Quat = this): _Quat {
        const half = rad * 0.5;
        const bx = Math.sin(half), bw = Math.cos(half);
        const ax = this[0], ay = this[1], az = this[2], aw = this[3];
        out[0] = ax * bw + aw * bx;
        out[1] = ay * bw + az * bx;
        out[2] = az * bw - ay * bx;
        out[3] = aw * bw - ax * bx;
        return out;
    }

    rotateY(rad: number, out: _Quat = this): _Quat {
        const half = rad * 0.5;
        const by = Math.sin(half), bw = Math.cos(half);
        const ax = this[0], ay = this[1], az = this[2], aw = this[3];
        out[0] = ax * bw - az * by;
        out[1] = ay * bw + aw * by;
        out[2] = az * bw + ax * by;
        out[3] = aw * bw - ay * by;
        return out;
    }

    rotateZ(rad: number, out: _Quat = this): _Quat {
        const half = rad * 0.5;
        const bz = Math.sin(half), bw = Math.cos(half);
        const ax = this[0], ay = this[1], az = this[2], aw = this[3];
        out[0] = ax * bw + ay * bz;
        out[1] = ay * bw - ax * bz;
        out[2] = az * bw + aw * bz;
        out[3] = aw * bw - az * bz;
        return out;
    }

    equals(b: ArrayLike<number>, epsilon = EPSILON): boolean {
        return (
            Math.abs(this[0] - b[0]) <= epsilon &&
            Math.abs(this[1] - b[1]) <= epsilon &&
            Math.abs(this[2] - b[2]) <= epsilon &&
            Math.abs(this[3] - b[3]) <= epsilon
        );
    }

    exactEquals(b: ArrayLike<number>): boolean {
        return (
            this[0] === b[0] &&
            this[1] === b[1] &&
            this[2] === b[2] &&
            this[3] === b[3]
        );
    }

    // Static procedural API
    static set(x: number, y: number, z: number, w: number, out?: _Quat): _Quat {
        out ??= new _Quat();
        out[0] = x;
        out[1] = y;
        out[2] = z;
        out[3] = w;
        return out;
    }

    static copy(a: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        return out;
    }

    static clone(a: ArrayLike<number>): _Quat {
        return new _Quat(a[0], a[1], a[2], a[3]);
    }

    static dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    }

    static mul(a: ArrayLike<number>, b: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        const ax = a[0], ay = a[1], az = a[2], aw = a[3];
        const bx = b[0], by = b[1], bz = b[2], bw = b[3];
        out[0] = aw * bx + ax * bw + ay * bz - az * by;
        out[1] = aw * by - ax * bz + ay * bw + az * bx;
        out[2] = aw * bz + ax * by - ay * bx + az * bw;
        out[3] = aw * bw - ax * bx - ay * by - az * bz;
        return out;
    }

    static length(a: ArrayLike<number>): number {
        const x = a[0], y = a[1], z = a[2], w = a[3];
        return Math.sqrt(x * x + y * y + z * z + w * w);
    }

    static len(a: ArrayLike<number>): number {
        return _Quat.length(a);
    }

    static lengthSq(a: ArrayLike<number>): number {
        const x = a[0], y = a[1], z = a[2], w = a[3];
        return x * x + y * y + z * z + w * w;
    }

    static lenSq(a: ArrayLike<number>): number {
        return _Quat.lengthSq(a);
    }

    static normalize(a: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        const x = a[0], y = a[1], z = a[2], w = a[3];
        const lenSq = x * x + y * y + z * z + w * w;
        if (lenSq > EPSILON * EPSILON) {
            const invLen = 1.0 / Math.sqrt(lenSq);
            out[0] = x * invLen;
            out[1] = y * invLen;
            out[2] = z * invLen;
            out[3] = w * invLen;
        } else {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            out[3] = 1;
        }
        return out;
    }

    static norm(a: ArrayLike<number>, out?: _Quat): _Quat {
        return _Quat.normalize(a, out);
    }

    static conjugate(a: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        out[0] = -a[0];
        out[1] = -a[1];
        out[2] = -a[2];
        out[3] = a[3];
        return out;
    }

    static invert(a: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        const dot = a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3];
        const inv = dot > EPSILON ? 1.0 / dot : 0;
        out[0] = -a[0] * inv;
        out[1] = -a[1] * inv;
        out[2] = -a[2] * inv;
        out[3] = a[3] * inv;
        return out;
    }

    static slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out?: _Quat): _Quat {
        out ??= new _Quat();
        let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        let bx = b[0], by = b[1], bz = b[2], bw = b[3];
        if (dot < 0) {
            dot = -dot;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }

        let scale0: number;
        let scale1: number;
        if (dot > 1.0 - EPSILON) {
            scale0 = 1.0 - t;
            scale1 = t;
        } else {
            const theta = Math.acos(dot);
            const sinTheta = Math.sin(theta);
            scale0 = Math.sin((1.0 - t) * theta) / sinTheta;
            scale1 = Math.sin(t * theta) / sinTheta;
        }

        out[0] = scale0 * a[0] + scale1 * bx;
        out[1] = scale0 * a[1] + scale1 * by;
        out[2] = scale0 * a[2] + scale1 * bz;
        out[3] = scale0 * a[3] + scale1 * bw;
        return out;
    }

    static fromAxisAngle(axis: ArrayLike<number>, rad: number, out?: _Quat): _Quat {
        out ??= new _Quat();
        const half = rad * 0.5;
        const s = Math.sin(half);
        out[0] = axis[0] * s;
        out[1] = axis[1] * s;
        out[2] = axis[2] * s;
        out[3] = Math.cos(half);
        return out;
    }

    static fromEuler(x: number, y: number, z: number, out?: _Quat): _Quat {
        out ??= new _Quat();
        const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
        const cx = Math.cos(hx), sx = Math.sin(hx);
        const cy = Math.cos(hy), sy = Math.sin(hy);
        const cz = Math.cos(hz), sz = Math.sin(hz);

        out[0] = sx * cy * cz - cx * sy * sz;
        out[1] = cx * sy * cz + sx * cy * sz;
        out[2] = cx * cy * sz - sx * sy * cz;
        out[3] = cx * cy * cz + sx * sy * sz;
        return out;
    }

    static fromMat4(m: ArrayLike<number>, out?: _Quat): _Quat {
        out ??= new _Quat();
        const m00 = m[0], m10 = m[1], m20 = m[2];
        const m01 = m[4], m11 = m[5], m21 = m[6];
        const m02 = m[8], m12 = m[9], m22 = m[10];
        const trace = m00 + m11 + m22;

        let s: number;
        if (trace > 0) {
            s = 0.5 / Math.sqrt(trace + 1.0);
            out[3] = 0.25 / s;
            out[0] = (m21 - m12) * s;
            out[1] = (m02 - m20) * s;
            out[2] = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            out[3] = (m21 - m12) / s;
            out[0] = 0.25 * s;
            out[1] = (m01 + m10) / s;
            out[2] = (m02 + m20) / s;
        } else if (m11 > m22) {
            s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            out[3] = (m02 - m20) / s;
            out[0] = (m01 + m10) / s;
            out[1] = 0.25 * s;
            out[2] = (m12 + m21) / s;
        } else {
            s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            out[3] = (m10 - m01) / s;
            out[0] = (m02 + m20) / s;
            out[1] = (m12 + m21) / s;
            out[2] = 0.25 * s;
        }
        return out;
    }

    static fromM4(m: ArrayLike<number>, out?: _Quat): _Quat {
        return _Quat.fromMat4(m, out);
    }

    static toEulerYPR(q: ArrayLike<number>, out?: Vec3): Vec3 {
        out ??= new Vec3();
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const sx = 2 * (w * x - y * z);
        const clamped = Math.max(-1, Math.min(1, sx));
        const pitch = Math.asin(clamped);
        const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
        const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
        out[0] = yaw * RAD2DEG;
        out[1] = pitch * RAD2DEG;
        out[2] = roll * RAD2DEG;
        return out;
    }

    static transformV3(q: ArrayLike<number>, v: ArrayLike<number>, out?: Vec3): Vec3 {
        out ??= new Vec3();
        const vx = v[0], vy = v[1], vz = v[2];
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        out[0] = vx + qw * tx + qy * tz - qz * ty;
        out[1] = vy + qw * ty + qz * tx - qx * tz;
        out[2] = vz + qw * tz + qx * ty - qy * tx;
        return out;
    }

    static equals(a: ArrayLike<number>, b: ArrayLike<number>, epsilon = EPSILON): boolean {
        return (
            Math.abs(a[0] - b[0]) <= epsilon &&
            Math.abs(a[1] - b[1]) <= epsilon &&
            Math.abs(a[2] - b[2]) <= epsilon &&
            Math.abs(a[3] - b[3]) <= epsilon
        );
    }

    static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
        return (
            a[0] === b[0] &&
            a[1] === b[1] &&
            a[2] === b[2] &&
            a[3] === b[3]
        );
    }

    /**
     * Bulk transform an array of 3D vectors by a rotation quaternion.
     */
    static transformVectors(
        q: ArrayLike<number>,
        src: Float32Array,
        dst: Float32Array,
        count: number,
        srcStride = 3,
        dstStride = 3
    ): void {
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];

        let sIdx = 0;
        let dIdx = 0;
        for (let i = 0; i < count; i++) {
            const vx = src[sIdx];
            const vy = src[sIdx + 1];
            const vz = src[sIdx + 2];

            const tx = 2 * (qy * vz - qz * vy);
            const ty = 2 * (qz * vx - qx * vz);
            const tz = 2 * (qx * vy - qy * vx);

            dst[dIdx] = vx + qw * tx + qy * tz - qz * ty;
            dst[dIdx + 1] = vy + qw * ty + qz * tx - qx * tz;
            dst[dIdx + 2] = vz + qw * tz + qx * ty - qy * tx;

            sIdx += srcStride;
            dIdx += dstStride;
        }
    }
}

export type Quat = _Quat;

export interface QuatFactory {
    new (): Quat;
    new (x: number, y: number, z: number, w: number): Quat;
    new (elements: ArrayLike<number>): Quat;
    new (buffer: ArrayBufferLike, byteOffset?: number): Quat;

    (): Quat;
    (x?: number, y?: number, z?: number, w?: number): Quat;
    (elements: ArrayLike<number>): Quat;
    (buffer: ArrayBufferLike, byteOffset?: number): Quat;
}

export type QuatConstructor = typeof _Quat & QuatFactory;

const _QuatWrapper: any = function (
    a?: number | ArrayLike<number> | ArrayBufferLike,
    b?: number,
    c?: number,
    d?: number
): Quat {
    return new (_Quat as any)(a, b, c, d);
};
Object.setPrototypeOf(_QuatWrapper, _Quat);
_QuatWrapper.prototype = _Quat.prototype;

export const Quat: QuatConstructor = _QuatWrapper;
