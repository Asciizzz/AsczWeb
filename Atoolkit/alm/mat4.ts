import { EPSILON } from "./constants.js";
import { Vec2 } from "./vec2.js";
import { Vec3 } from "./vec3.js";
import { Vec4 } from "./vec4.js";
import { Quat } from "./quat.js";

/**
 * 4x4 Matrix stored as column-major Float32Array[16].
 *
 * Index mapping:
 *  0  4  8  12
 *  1  5  9  13
 *  2  6  10 14
 *  3  7  11 15
 */
export class _Mat4 extends Float32Array {
    static get [Symbol.species](): Float32ArrayConstructor {
        return Float32Array;
    }

    static readonly IDENTITY: Readonly<_Mat4> = new _Mat4([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);

    constructor();
    constructor(elements: ArrayLike<number>);
    constructor(buffer: ArrayBufferLike, byteOffset?: number);
    constructor(a?: ArrayLike<number> | ArrayBufferLike, b?: number) {
        if (a instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && a instanceof SharedArrayBuffer)) {
            super(a as ArrayBuffer, b ?? 0, 16);
        } else {
            super(16);
            if (a && "length" in a) {
                const len = Math.min(a.length, 16);
                for (let i = 0; i < len; i++) {
                    this[i] = a[i];
                }
            } else {
                this[0] = 1;
                this[5] = 1;
                this[10] = 1;
                this[15] = 1;
            }
        }
    }

    static create(): _Mat4 {
        return new _Mat4();
    }

    static identity(out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[0] = 1;  out[1] = 0;  out[2] = 0;  out[3] = 0;
        out[4] = 0;  out[5] = 1;  out[6] = 0;  out[7] = 0;
        out[8] = 0;  out[9] = 0;  out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    }

    static view(buffer: ArrayBufferLike, byteOffset = 0): _Mat4 {
        return new _Mat4(buffer, byteOffset);
    }

    static fromArray(array: ArrayLike<number>, offset = 0, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        for (let i = 0; i < 16; i++) {
            out[i] = array[offset + i];
        }
        return out;
    }

    identity(): this {
        this[0] = 1;  this[1] = 0;  this[2] = 0;  this[3] = 0;
        this[4] = 0;  this[5] = 1;  this[6] = 0;  this[7] = 0;
        this[8] = 0;  this[9] = 0;  this[10] = 1; this[11] = 0;
        this[12] = 0; this[13] = 0; this[14] = 0; this[15] = 1;
        return this;
    }

    copy(src: ArrayLike<number>): this {
        for (let i = 0; i < 16; i++) {
            this[i] = src[i];
        }
        return this;
    }

    clone(): _Mat4 {
        return new _Mat4(this);
    }

    mul(b: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        const a00 = this[0],  a01 = this[1],  a02 = this[2],  a03 = this[3];
        const a10 = this[4],  a11 = this[5],  a12 = this[6],  a13 = this[7];
        const a20 = this[8],  a21 = this[9],  a22 = this[10], a23 = this[11];
        const a30 = this[12], a31 = this[13], a32 = this[14], a33 = this[15];

        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8]  = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[9]  = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        return out;
    }

    multiply(b: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        return this.mul(b, out);
    }

    premul(a: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        return _Mat4.mul(a, this, out);
    }

    transpose(out: _Mat4 = this): _Mat4 {
        if (out === this) {
            let t: number;
            t = this[1];  this[1]  = this[4];  this[4]  = t;
            t = this[2];  this[2]  = this[8];  this[8]  = t;
            t = this[3];  this[3]  = this[12]; this[12] = t;
            t = this[6];  this[6]  = this[9];  this[9]  = t;
            t = this[7];  this[7]  = this[13]; this[13] = t;
            t = this[11]; this[11] = this[14]; this[14] = t;
            return this;
        }
        out[0]  = this[0]; out[1]  = this[4]; out[2]  = this[8];  out[3]  = this[12];
        out[4]  = this[1]; out[5]  = this[5]; out[6]  = this[9];  out[7]  = this[13];
        out[8]  = this[2]; out[9]  = this[6]; out[10] = this[10]; out[11] = this[14];
        out[12] = this[3]; out[13] = this[7]; out[14] = this[11]; out[15] = this[15];
        return out;
    }

    invert(out: _Mat4 = this): _Mat4 | null {
        const a00 = this[0],  a01 = this[1],  a02 = this[2],  a03 = this[3];
        const a10 = this[4],  a11 = this[5],  a12 = this[6],  a13 = this[7];
        const a20 = this[8],  a21 = this[9],  a22 = this[10], a23 = this[11];
        const a30 = this[12], a31 = this[13], a32 = this[14], a33 = this[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (Math.abs(det) <= EPSILON) return null;
        det = 1.0 / det;

        out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
        return out;
    }

    /**
     * Fast specialized inverse for affine/rigid transformation matrices (Rotation + Translation).
     * ~8x faster than full general matrix inversion.
     */
    invertRigid(out: _Mat4 = this): _Mat4 {
        const r00 = this[0], r01 = this[4], r02 = this[8];
        const r10 = this[1], r11 = this[5], r12 = this[9];
        const r20 = this[2], r21 = this[6], r22 = this[10];
        const tx = this[12], ty = this[13], tz = this[14];

        out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
        out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
        out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
        out[12] = -(r00 * tx + r10 * ty + r20 * tz);
        out[13] = -(r01 * tx + r11 * ty + r21 * tz);
        out[14] = -(r02 * tx + r12 * ty + r22 * tz);
        out[15] = 1;
        return out;
    }

    /**
     * Computes 3x3 normal matrix (transpose of inverse of model matrix) embedded into a Mat4.
     * Essential for 3D lighting with non-uniform scale.
     */
    normalMatrix(out: _Mat4 = this): _Mat4 | null {
        const a00 = this[0], a01 = this[1], a02 = this[2];
        const a10 = this[4], a11 = this[5], a12 = this[6];
        const a20 = this[8], a21 = this[9], a22 = this[10];

        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;

        let d = a00 * b01 + a01 * b11 + a02 * b21;
        if (Math.abs(d) <= EPSILON) return null;
        d = 1.0 / d;

        out[0] = b01 * d;
        out[1] = (-a22 * a01 + a02 * a21) * d;
        out[2] = (a12 * a01 - a02 * a11) * d;
        out[3] = 0;

        out[4] = b11 * d;
        out[5] = (a22 * a00 - a02 * a20) * d;
        out[6] = (-a12 * a00 + a02 * a10) * d;
        out[7] = 0;

        out[8] = b21 * d;
        out[9] = (-a21 * a00 + a01 * a20) * d;
        out[10] = (a11 * a00 - a01 * a10) * d;
        out[11] = 0;

        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    }

    /**
     * Computes determinant of this 4x4 matrix.
     */
    determinant(): number {
        return _Mat4.determinant(this);
    }

    /**
     * Decomposes matrix into translation, rotation quaternion, and scale.
     */
    decompose(
        outTranslation?: Vec3,
        outRotation?: Quat,
        outScale?: Vec3
    ): { translation: Vec3; rotation: Quat; scale: Vec3 } {
        return _Mat4.decompose(this, outTranslation, outRotation, outScale);
    }

    translate(v: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        const x = v[0], y = v[1], z = v[2];
        if (out !== this) {
            out[0] = this[0]; out[1] = this[1]; out[2] = this[2];   out[3] = this[3];
            out[4] = this[4]; out[5] = this[5]; out[6] = this[6];   out[7] = this[7];
            out[8] = this[8]; out[9] = this[9]; out[10] = this[10]; out[11] = this[11];
        }
        out[12] = this[0] * x + this[4] * y + this[8]  * z + this[12];
        out[13] = this[1] * x + this[5] * y + this[9]  * z + this[13];
        out[14] = this[2] * x + this[6] * y + this[10] * z + this[14];
        out[15] = this[3] * x + this[7] * y + this[11] * z + this[15];
        return out;
    }

    rotateX(rad: number, out: _Mat4 = this): _Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a10 = this[4], a11 = this[5], a12 = this[6],  a13 = this[7];
        const a20 = this[8], a21 = this[9], a22 = this[10], a23 = this[11];
        if (this !== out) {
            out[0] = this[0];   out[1] = this[1];   out[2] = this[2];   out[3] = this[3];
            out[12] = this[12]; out[13] = this[13]; out[14] = this[14]; out[15] = this[15];
        }
        out[4]  = a10 * c + a20 * s;
        out[5]  = a11 * c + a21 * s;
        out[6]  = a12 * c + a22 * s;
        out[7]  = a13 * c + a23 * s;
        out[8]  = a20 * c - a10 * s;
        out[9]  = a21 * c - a11 * s;
        out[10] = a22 * c - a12 * s;
        out[11] = a23 * c - a13 * s;
        return out;
    }

    rotateY(rad: number, out: _Mat4 = this): _Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = this[0], a01 = this[1], a02 = this[2],  a03 = this[3];
        const a20 = this[8], a21 = this[9], a22 = this[10], a23 = this[11];
        if (this !== out) {
            out[4] = this[4];   out[5] = this[5];   out[6] = this[6];   out[7] = this[7];
            out[12] = this[12]; out[13] = this[13]; out[14] = this[14]; out[15] = this[15];
        }
        out[0]  = a00 * c - a20 * s;
        out[1]  = a01 * c - a21 * s;
        out[2]  = a02 * c - a22 * s;
        out[3]  = a03 * c - a23 * s;
        out[8]  = a00 * s + a20 * c;
        out[9]  = a01 * s + a21 * c;
        out[10] = a02 * s + a22 * c;
        out[11] = a03 * s + a23 * c;
        return out;
    }

    rotateZ(rad: number, out: _Mat4 = this): _Mat4 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = this[0], a01 = this[1], a02 = this[2],  a03 = this[3];
        const a10 = this[4], a11 = this[5], a12 = this[6],  a13 = this[7];
        if (this !== out) {
            out[8]  = this[8];  out[9]  = this[9];  out[10] = this[10]; out[11] = this[11];
            out[12] = this[12]; out[13] = this[13]; out[14] = this[14]; out[15] = this[15];
        }
        out[0] = a00 * c + a10 * s;
        out[1] = a01 * c + a11 * s;
        out[2] = a02 * c + a12 * s;
        out[3] = a03 * c + a13 * s;
        out[4] = a10 * c - a00 * s;
        out[5] = a11 * c - a01 * s;
        out[6] = a12 * c - a02 * s;
        out[7] = a13 * c - a03 * s;
        return out;
    }

    rotate(axis: ArrayLike<number>, rad: number, out: _Mat4 = this): _Mat4 {
        let x = axis[0], y = axis[1], z = axis[2];
        let len = Math.hypot(x, y, z);
        if (len < EPSILON) {
            if (out !== this) out.set(this);
            return out;
        }
        len = 1.0 / len;
        x *= len; y *= len; z *= len;

        const s = Math.sin(rad), c = Math.cos(rad), t = 1.0 - c;
        const b00 = x * x * t + c,     b01 = y * x * t + z * s, b02 = z * x * t - y * s;
        const b10 = x * y * t - z * s, b11 = y * y * t + c,     b12 = z * y * t + x * s;
        const b20 = x * z * t + y * s, b21 = y * z * t - x * s, b22 = z * z * t + c;

        const a00 = this[0], a01 = this[1], a02 = this[2],  a03 = this[3];
        const a10 = this[4], a11 = this[5], a12 = this[6],  a13 = this[7];
        const a20 = this[8], a21 = this[9], a22 = this[10], a23 = this[11];

        out[0] = a00 * b00 + a10 * b01 + a20 * b02;
        out[1] = a01 * b00 + a11 * b01 + a21 * b02;
        out[2] = a02 * b00 + a12 * b01 + a22 * b02;
        out[3] = a03 * b00 + a13 * b01 + a23 * b02;

        out[4] = a00 * b10 + a10 * b11 + a20 * b12;
        out[5] = a01 * b10 + a11 * b11 + a21 * b12;
        out[6] = a02 * b10 + a12 * b11 + a22 * b12;
        out[7] = a03 * b10 + a13 * b11 + a23 * b12;

        out[8]  = a00 * b20 + a10 * b21 + a20 * b22;
        out[9]  = a01 * b20 + a11 * b21 + a21 * b22;
        out[10] = a02 * b20 + a12 * b21 + a22 * b22;
        out[11] = a03 * b20 + a13 * b21 + a23 * b22;

        if (this !== out) {
            out[12] = this[12]; out[13] = this[13]; out[14] = this[14]; out[15] = this[15];
        }
        return out;
    }

    rotateQ(q: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        const rot = _Mat4.fromQuat(q);
        return this.mul(rot, out);
    }

    scale(v: ArrayLike<number>, out: _Mat4 = this): _Mat4 {
        const x = v[0], y = v[1], z = v[2];
        out[0] = this[0] * x; out[1] = this[1] * x; out[2] = this[2] * x; out[3] = this[3] * x;
        out[4] = this[4] * y; out[5] = this[5] * y; out[6] = this[6] * y; out[7] = this[7] * y;
        out[8] = this[8] * z; out[9] = this[9] * z; out[10] = this[10] * z; out[11] = this[11] * z;
        if (this !== out) {
            out[12] = this[12]; out[13] = this[13]; out[14] = this[14]; out[15] = this[15];
        }
        return out;
    }

    getTranslation(out?: Vec3): Vec3 {
        out ??= new Vec3();
        out[0] = this[12];
        out[1] = this[13];
        out[2] = this[14];
        return out;
    }

    getScaling(out?: Vec3): Vec3 {
        out ??= new Vec3();
        out[0] = Math.hypot(this[0], this[1], this[2]);
        out[1] = Math.hypot(this[4], this[5], this[6]);
        out[2] = Math.hypot(this[8], this[9], this[10]);
        return out;
    }

    getRotation(out?: Quat): Quat {
        out ??= new Quat();
        const scaling = this.getScaling();
        const isx = scaling[0] > EPSILON ? 1.0 / scaling[0] : 0;
        const isy = scaling[1] > EPSILON ? 1.0 / scaling[1] : 0;
        const isz = scaling[2] > EPSILON ? 1.0 / scaling[2] : 0;

        const m00 = this[0] * isx, m01 = this[1] * isx, m02 = this[2] * isx;
        const m10 = this[4] * isy, m11 = this[5] * isy, m12 = this[6] * isy;
        const m20 = this[8] * isz, m21 = this[9] * isz, m22 = this[10] * isz;

        const trace = m00 + m11 + m22;
        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            out[3] = 0.25 / s;
            out[0] = (m21 - m12) * s;
            out[1] = (m02 - m20) * s;
            out[2] = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            out[3] = (m21 - m12) / s;
            out[0] = 0.25 * s;
            out[1] = (m01 + m10) / s;
            out[2] = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            out[3] = (m02 - m20) / s;
            out[0] = (m01 + m10) / s;
            out[1] = 0.25 * s;
            out[2] = (m12 + m21) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            out[3] = (m10 - m01) / s;
            out[0] = (m02 + m20) / s;
            out[1] = (m12 + m21) / s;
            out[2] = 0.25 * s;
        }
        return out;
    }

    transformVec2(v: ArrayLike<number>, out?: Vec2): Vec2 {
        out ??= new Vec2();
        const x = v[0], y = v[1];
        out[0] = this[0] * x + this[4] * y + this[12];
        out[1] = this[1] * x + this[5] * y + this[13];
        return out;
    }

    transformVec3(v: ArrayLike<number>, out?: Vec3): Vec3 {
        out ??= new Vec3();
        const x = v[0], y = v[1], z = v[2];
        let w = this[3] * x + this[7] * y + this[11] * z + this[15];
        w = w !== 0 ? 1.0 / w : 1.0;
        out[0] = (this[0] * x + this[4] * y + this[8]  * z + this[12]) * w;
        out[1] = (this[1] * x + this[5] * y + this[9]  * z + this[13]) * w;
        out[2] = (this[2] * x + this[6] * y + this[10] * z + this[14]) * w;
        return out;
    }

    transformDirection(v: ArrayLike<number>, out?: Vec3): Vec3 {
        out ??= new Vec3();
        const x = v[0], y = v[1], z = v[2];
        out[0] = this[0] * x + this[4] * y + this[8]  * z;
        out[1] = this[1] * x + this[5] * y + this[9]  * z;
        out[2] = this[2] * x + this[6] * y + this[10] * z;
        return out;
    }

    transformVec4(v: ArrayLike<number>, out?: Vec4): Vec4 {
        out ??= new Vec4();
        const x = v[0], y = v[1], z = v[2], w = v[3];
        out[0] = this[0] * x + this[4] * y + this[8]  * z + this[12] * w;
        out[1] = this[1] * x + this[5] * y + this[9]  * z + this[13] * w;
        out[2] = this[2] * x + this[6] * y + this[10] * z + this[14] * w;
        out[3] = this[3] * x + this[7] * y + this[11] * z + this[15] * w;
        return out;
    }

    equals(b: ArrayLike<number>, epsilon = EPSILON): boolean {
        for (let i = 0; i < 16; i++) {
            if (Math.abs(this[i] - b[i]) > epsilon) return false;
        }
        return true;
    }

    exactEquals(b: ArrayLike<number>): boolean {
        for (let i = 0; i < 16; i++) {
            if (this[i] !== b[i]) return false;
        }
        return true;
    }

    // Static factories and constructors
    static fromTranslation(v: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = v[0]; out[13] = v[1]; out[14] = v[2]; out[15] = 1;
        return out;
    }

    static fromScaling(v: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[0] = v[0]; out[1] = 0;    out[2] = 0;    out[3] = 0;
        out[4] = 0;    out[5] = v[1]; out[6] = 0;    out[7] = 0;
        out[8] = 0;    out[9] = 0;    out[10] = v[2]; out[11] = 0;
        out[12] = 0;   out[13] = 0;   out[14] = 0;   out[15] = 1;
        return out;
    }

    static fromRotationX(rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[7] = 0; out[8] = 0; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        const c = Math.cos(rad), s = Math.sin(rad);
        out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
        return out;
    }

    static fromRotationY(rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[1] = 0; out[3] = 0; out[4] = 0; out[5] = 1;
        out[6] = 0; out[7] = 0; out[9] = 0; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        const c = Math.cos(rad), s = Math.sin(rad);
        out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
        return out;
    }

    static fromRotationZ(rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        out[2] = 0; out[3] = 0; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        const c = Math.cos(rad), s = Math.sin(rad);
        out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
        return out;
    }

    static fromQuat(q: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, yx = y * x2, yy = y * y2;
        const zx = z * x2, zy = z * y2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        out[0] = 1 - yy - zz; out[1] = yx + wz;     out[2] = zx - wy;     out[3] = 0;
        out[4] = yx - wz;     out[5] = 1 - xx - zz; out[6] = zy + wx;     out[7] = 0;
        out[8] = zx + wy;     out[9] = zy - wx;     out[10] = 1 - xx - yy; out[11] = 0;
        out[12] = 0;          out[13] = 0;          out[14] = 0;          out[15] = 1;
        return out;
    }

    static fromTRS(pos: ArrayLike<number>, rotQ: ArrayLike<number>, scale: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const x = rotQ[0], y = rotQ[1], z = rotQ[2], w = rotQ[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        const sx = scale[0], sy = scale[1], sz = scale[2];

        out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx;      out[2] = (xz - wy) * sx;      out[3] = 0;
        out[4] = (xy - wz) * sy;      out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy;      out[7] = 0;
        out[8] = (xz + wy) * sz;      out[9] = (yz - wx) * sz;      out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
        out[12] = pos[0];             out[13] = pos[1];             out[14] = pos[2];             out[15] = 1;
        return out;
    }

    /**
     * Computes determinant of a 4x4 matrix.
     */
    static determinant(a: ArrayLike<number>): number {
        const a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
        const a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
        const a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    }

    /**
     * Decomposes a 4x4 affine transformation matrix into translation, rotation quaternion, and scale.
     */
    static decompose(
        m: ArrayLike<number>,
        outTranslation?: Vec3,
        outRotation?: Quat,
        outScale?: Vec3
    ): { translation: Vec3; rotation: Quat; scale: Vec3 } {
        const trans = outTranslation ?? new Vec3();
        trans[0] = m[12];
        trans[1] = m[13];
        trans[2] = m[14];

        let sx = Math.hypot(m[0], m[1], m[2]);
        let sy = Math.hypot(m[4], m[5], m[6]);
        let sz = Math.hypot(m[8], m[9], m[10]);

        // Check for reflection via 3x3 determinant
        const det3 =
            m[0] * (m[5] * m[10] - m[6] * m[9]) -
            m[4] * (m[1] * m[10] - m[2] * m[9]) +
            m[8] * (m[1] * m[6] - m[2] * m[5]);
        if (det3 < 0) {
            sx = -sx;
        }

        const scale = outScale ?? new Vec3();
        scale[0] = sx;
        scale[1] = sy;
        scale[2] = sz;

        const rot = outRotation ?? new Quat();
        const invSx = Math.abs(sx) > EPSILON ? 1.0 / sx : 0;
        const invSy = Math.abs(sy) > EPSILON ? 1.0 / sy : 0;
        const invSz = Math.abs(sz) > EPSILON ? 1.0 / sz : 0;

        const m00 = m[0] * invSx, m10 = m[1] * invSx, m20 = m[2] * invSx;
        const m01 = m[4] * invSy, m11 = m[5] * invSy, m21 = m[6] * invSy;
        const m02 = m[8] * invSz, m12 = m[9] * invSz, m22 = m[10] * invSz;

        const trace = m00 + m11 + m22;
        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            rot[3] = 0.25 / s;
            rot[0] = (m21 - m12) * s;
            rot[1] = (m02 - m20) * s;
            rot[2] = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            rot[3] = (m21 - m12) / s;
            rot[0] = 0.25 * s;
            rot[1] = (m01 + m10) / s;
            rot[2] = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            rot[3] = (m02 - m20) / s;
            rot[0] = (m01 + m10) / s;
            rot[1] = 0.25 * s;
            rot[2] = (m12 + m21) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            rot[3] = (m10 - m01) / s;
            rot[0] = (m02 + m20) / s;
            rot[1] = (m12 + m21) / s;
            rot[2] = 0.25 * s;
        }

        return { translation: trans, rotation: rot, scale };
    }

    /**
     * WebGPU / Direct3D / Metal zero-to-one [0, 1] clip space perspective projection.
     * Essential for WebGPU pipelines to avoid near-plane clipping and maximize depth precision.
     */
    static perspectiveZO(fovy: number, aspect: number, near: number, far: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const f = 1.0 / Math.tan(fovy * 0.5);
        out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0;          out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0;          out[9] = 0;
        if (Number.isFinite(far)) {
            const nf = 1.0 / (near - far);
            out[10] = far * nf;
            out[14] = far * near * nf;
        } else {
            out[10] = -1.0;
            out[14] = -near;
        }
        out[11] = -1.0;
        out[12] = 0; out[13] = 0; out[15] = 0;
        return out;
    }

    /**
     * OpenGL / WebGL [-1, 1] clip space perspective projection.
     */
    static perspectiveNO(fovy: number, aspect: number, near: number, far: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const f = 1.0 / Math.tan(fovy * 0.5), nf = 1.0 / (near - far);
        out[0] = f / aspect; out[1] = 0; out[2] = 0;                 out[3] = 0;
        out[4] = 0;          out[5] = f; out[6] = 0;                 out[7] = 0;
        out[8] = 0;          out[9] = 0; out[10] = (far + near) * nf; out[11] = -1.0;
        out[12] = 0;         out[13] = 0; out[14] = 2.0 * far * near * nf; out[15] = 0;
        return out;
    }

    /** Standard perspective (alias for WebGPU/Metal [0, 1] projection). */
    static perspective = _Mat4.perspectiveZO;

    /**
     * WebGPU / Metal / DX [0, 1] depth orthographic projection.
     */
    static orthoZO(left: number, right: number, bottom: number, top: number, near: number, far: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const lr = 1.0 / (left - right);
        const bt = 1.0 / (bottom - top);
        const nf = 1.0 / (near - far);
        out[0] = -2.0 * lr;        out[1] = 0;               out[2] = 0;          out[3] = 0;
        out[4] = 0;                out[5] = -2.0 * bt;       out[6] = 0;          out[7] = 0;
        out[8] = 0;                out[9] = 0;               out[10] = nf;        out[11] = 0;
        out[12] = (left + right) * lr; out[13] = (top + bottom) * bt; out[14] = near * nf; out[15] = 1.0;
        return out;
    }

    /**
     * WebGL [-1, 1] depth orthographic projection.
     */
    static orthoNO(left: number, right: number, bottom: number, top: number, near: number, far: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const lr = 1.0 / (left - right), bt = 1.0 / (bottom - top), nf = 1.0 / (near - far);
        out[0] = -2.0 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = -2.0 * bt; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 2.0 * nf; out[11] = 0;
        out[12] = (left + right) * lr; out[13] = (top + bottom) * bt; out[14] = (far + near) * nf; out[15] = 1.0;
        return out;
    }

    static ortho = _Mat4.orthoZO;

    /**
     * Generates a lookAt view matrix looking from eye towards target.
     */
    static lookAt(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const eyex = eye[0], eyey = eye[1], eyez = eye[2];
        const upx = up[0], upy = up[1], upz = up[2];
        const targetx = target[0], targety = target[1], targetz = target[2];

        let z0 = eyex - targetx;
        let z1 = eyey - targety;
        let z2 = eyez - targetz;
        let len = Math.hypot(z0, z1, z2);
        if (len < EPSILON) {
            out.identity();
            return out;
        }
        len = 1.0 / len;
        z0 *= len; z1 *= len; z2 *= len;

        let x0 = upy * z2 - upz * z1;
        let x1 = upz * z0 - upx * z2;
        let x2 = upx * z1 - upy * z0;
        len = Math.hypot(x0, x1, x2);
        if (len < EPSILON) {
            x0 = 0; x1 = 0; x2 = 0;
        } else {
            len = 1.0 / len;
            x0 *= len; x1 *= len; x2 *= len;
        }

        let y0 = z1 * x2 - z2 * x1;
        let y1 = z2 * x0 - z0 * x2;
        let y2 = z0 * x1 - z1 * x0;
        len = Math.hypot(y0, y1, y2);
        if (len < EPSILON) {
            y0 = 0; y1 = 0; y2 = 0;
        } else {
            len = 1.0 / len;
            y0 *= len; y1 *= len; y2 *= len;
        }

        out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
        out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
        out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
        out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
        out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
        out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
        out[15] = 1.0;
        return out;
    }

    /**
     * Generates a matrix that points eye towards target.
     */
    static targetTo(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const eyex = eye[0], eyey = eye[1], eyez = eye[2];
        const upx = up[0], upy = up[1], upz = up[2];
        const targetx = target[0], targety = target[1], targetz = target[2];

        let z0 = targetx - eyex;
        let z1 = targety - eyey;
        let z2 = targetz - eyez;
        let len = Math.hypot(z0, z1, z2);
        if (len < EPSILON) {
            out.identity();
            return out;
        }
        len = 1.0 / len;
        z0 *= len; z1 *= len; z2 *= len;

        let x0 = upy * z2 - upz * z1;
        let x1 = upz * z0 - upx * z2;
        let x2 = upx * z1 - upy * z0;
        len = Math.hypot(x0, x1, x2);
        if (len < EPSILON) {
            x0 = 0; x1 = 0; x2 = 0;
        } else {
            len = 1.0 / len;
            x0 *= len; x1 *= len; x2 *= len;
        }

        let y0 = z1 * x2 - z2 * x1;
        let y1 = z2 * x0 - z0 * x2;
        let y2 = z0 * x1 - z1 * x0;
        len = Math.hypot(y0, y1, y2);
        if (len < EPSILON) {
            y0 = 0; y1 = 0; y2 = 0;
        } else {
            len = 1.0 / len;
            y0 *= len; y1 *= len; y2 *= len;
        }

        out[0] = x0; out[1] = x1; out[2] = x2; out[3] = 0;
        out[4] = y0; out[5] = y1; out[6] = y2; out[7] = 0;
        out[8] = z0; out[9] = z1; out[10] = z2; out[11] = 0;
        out[12] = eyex; out[13] = eyey; out[14] = eyez; out[15] = 1.0;
        return out;
    }

    // Static procedural operations
    static copy(a: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        for (let i = 0; i < 16; i++) {
            out[i] = a[i];
        }
        return out;
    }

    static clone(a: ArrayLike<number>): _Mat4 {
        return new _Mat4(a);
    }

    static mul(a: ArrayLike<number>, b: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
        const a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
        const a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8]  = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[9]  = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        return out;
    }

    static transpose(a: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        if (out === a) {
            let t: number;
            t = a[1];  out[1]  = a[4];  out[4]  = t;
            t = a[2];  out[2]  = a[8];  out[8]  = t;
            t = a[3];  out[3]  = a[12]; out[12] = t;
            t = a[6];  out[6]  = a[9];  out[9]  = t;
            t = a[7];  out[7]  = a[13]; out[13] = t;
            t = a[11]; out[11] = a[14]; out[14] = t;
            return out;
        }
        out[0]  = a[0]; out[1]  = a[4]; out[2]  = a[8];  out[3]  = a[12];
        out[4]  = a[1]; out[5]  = a[5]; out[6]  = a[9];  out[7]  = a[13];
        out[8]  = a[2]; out[9]  = a[6]; out[10] = a[10]; out[11] = a[14];
        out[12] = a[3]; out[13] = a[7]; out[14] = a[11]; out[15] = a[15];
        return out;
    }

    static invert(a: ArrayLike<number>, out?: _Mat4): _Mat4 | null {
        out ??= new _Mat4();
        const a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
        const a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
        const a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (Math.abs(det) <= EPSILON) return null;
        det = 1.0 / det;

        out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
        return out;
    }

    static invertRigid(a: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const r00 = a[0], r01 = a[4], r02 = a[8];
        const r10 = a[1], r11 = a[5], r12 = a[9];
        const r20 = a[2], r21 = a[6], r22 = a[10];
        const tx = a[12], ty = a[13], tz = a[14];

        out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
        out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
        out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
        out[12] = -(r00 * tx + r10 * ty + r20 * tz);
        out[13] = -(r01 * tx + r11 * ty + r21 * tz);
        out[14] = -(r02 * tx + r12 * ty + r22 * tz);
        out[15] = 1;
        return out;
    }

    static normalMatrix(m: ArrayLike<number>, out?: _Mat4): _Mat4 | null {
        out ??= new _Mat4();
        const a00 = m[0], a01 = m[1], a02 = m[2];
        const a10 = m[4], a11 = m[5], a12 = m[6];
        const a20 = m[8], a21 = m[9], a22 = m[10];

        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;

        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (Math.abs(det) <= EPSILON) return null;
        det = 1.0 / det;

        out[0] = b01 * det;
        out[1] = (-a22 * a01 + a02 * a21) * det;
        out[2] = (a12 * a01 - a02 * a11) * det;
        out[3] = 0;

        out[4] = b11 * det;
        out[5] = (a22 * a00 - a02 * a20) * det;
        out[6] = (-a12 * a00 + a02 * a10) * det;
        out[7] = 0;

        out[8] = b21 * det;
        out[9] = (-a21 * a00 + a01 * a20) * det;
        out[10] = (a11 * a00 - a01 * a10) * det;
        out[11] = 0;

        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    }

    static translate(m: ArrayLike<number>, v: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const x = v[0], y = v[1], z = v[2];
        if (out !== m) {
            out[0] = m[0]; out[1] = m[1]; out[2] = m[2];   out[3] = m[3];
            out[4] = m[4]; out[5] = m[5]; out[6] = m[6];   out[7] = m[7];
            out[8] = m[8]; out[9] = m[9]; out[10] = m[10]; out[11] = m[11];
        }
        out[12] = m[0] * x + m[4] * y + m[8]  * z + m[12];
        out[13] = m[1] * x + m[5] * y + m[9]  * z + m[13];
        out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
        out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
        return out;
    }

    static rotateX(m: ArrayLike<number>, rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const s = Math.sin(rad), c = Math.cos(rad);
        const a10 = m[4], a11 = m[5], a12 = m[6],  a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        if (m !== out) {
            out[0] = m[0];   out[1] = m[1];   out[2] = m[2];   out[3] = m[3];
            out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
        }
        out[4]  = a10 * c + a20 * s;
        out[5]  = a11 * c + a21 * s;
        out[6]  = a12 * c + a22 * s;
        out[7]  = a13 * c + a23 * s;
        out[8]  = a20 * c - a10 * s;
        out[9]  = a21 * c - a11 * s;
        out[10] = a22 * c - a12 * s;
        out[11] = a23 * c - a13 * s;
        return out;
    }

    static rotateY(m: ArrayLike<number>, rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = m[0], a01 = m[1], a02 = m[2],  a03 = m[3];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        if (m !== out) {
            out[4] = m[4];   out[5] = m[5];   out[6] = m[6];   out[7] = m[7];
            out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
        }
        out[0]  = a00 * c - a20 * s;
        out[1]  = a01 * c - a21 * s;
        out[2]  = a02 * c - a22 * s;
        out[3]  = a03 * c - a23 * s;
        out[8]  = a00 * s + a20 * c;
        out[9]  = a01 * s + a21 * c;
        out[10] = a02 * s + a22 * c;
        out[11] = a03 * s + a23 * c;
        return out;
    }

    static rotateZ(m: ArrayLike<number>, rad: number, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = m[0], a01 = m[1], a02 = m[2],  a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6],  a13 = m[7];
        if (m !== out) {
            out[8]  = m[8];  out[9]  = m[9];  out[10] = m[10]; out[11] = m[11];
            out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
        }
        out[0] = a00 * c + a10 * s;
        out[1] = a01 * c + a11 * s;
        out[2] = a02 * c + a12 * s;
        out[3] = a03 * c + a13 * s;
        out[4] = a10 * c - a00 * s;
        out[5] = a11 * c - a01 * s;
        out[6] = a12 * c - a02 * s;
        out[7] = a13 * c - a03 * s;
        return out;
    }

    static rotate(m: ArrayLike<number>, axis: ArrayLike<number>, rad: number, out?: _Mat4): _Mat4 {
        let x = axis[0], y = axis[1], z = axis[2];
        let len = Math.hypot(x, y, z);
        if (len < EPSILON) {
            if (out && out !== m) {
                for (let i = 0; i < 16; i++) out[i] = m[i];
            }
            return out ?? new _Mat4(m);
        }
        len = 1.0 / len;
        x *= len; y *= len; z *= len;

        const s = Math.sin(rad), c = Math.cos(rad), t = 1.0 - c;
        const b00 = x * x * t + c,     b01 = y * x * t + z * s, b02 = z * x * t - y * s;
        const b10 = x * y * t - z * s, b11 = y * y * t + c,     b12 = z * y * t + x * s;
        const b20 = x * z * t + y * s, b21 = y * z * t - x * s, b22 = z * z * t + c;

        out ??= new _Mat4();
        const a00 = m[0], a01 = m[1], a02 = m[2],  a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6],  a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];

        out[0] = a00 * b00 + a10 * b01 + a20 * b02;
        out[1] = a01 * b00 + a11 * b01 + a21 * b02;
        out[2] = a02 * b00 + a12 * b01 + a22 * b02;
        out[3] = a03 * b00 + a13 * b01 + a23 * b02;

        out[4] = a00 * b10 + a10 * b11 + a20 * b12;
        out[5] = a01 * b10 + a11 * b11 + a21 * b12;
        out[6] = a02 * b10 + a12 * b11 + a22 * b12;
        out[7] = a03 * b10 + a13 * b11 + a23 * b12;

        out[8]  = a00 * b20 + a10 * b21 + a20 * b22;
        out[9]  = a01 * b20 + a11 * b21 + a21 * b22;
        out[10] = a02 * b20 + a12 * b21 + a22 * b22;
        out[11] = a03 * b20 + a13 * b21 + a23 * b22;

        if (m !== out) {
            out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
        }
        return out;
    }

    static rotateQ(m: ArrayLike<number>, q: ArrayLike<number>, out?: _Mat4): _Mat4 {
        return _Mat4.mul(m, _Mat4.fromQuat(q), out);
    }

    static scale(m: ArrayLike<number>, v: ArrayLike<number>, out?: _Mat4): _Mat4 {
        out ??= new _Mat4();
        const x = v[0], y = v[1], z = v[2];
        out[0] = m[0] * x; out[1] = m[1] * x; out[2] = m[2] * x; out[3] = m[3] * x;
        out[4] = m[4] * y; out[5] = m[5] * y; out[6] = m[6] * y; out[7] = m[7] * y;
        out[8] = m[8] * z; out[9] = m[9] * z; out[10] = m[10] * z; out[11] = m[11] * z;
        if (m !== out) {
            out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
        }
        return out;
    }

    static transformV2(m: ArrayLike<number>, v: ArrayLike<number>, out?: Vec2): Vec2 {
        out ??= new Vec2();
        const x = v[0], y = v[1];
        out[0] = m[0] * x + m[4] * y + m[12];
        out[1] = m[1] * x + m[5] * y + m[13];
        return out;
    }

    static transformV3(m: ArrayLike<number>, v: ArrayLike<number>, out?: Vec3): Vec3 {
        return Vec3.transformMat4(v, m, out);
    }

    static transformV4(m: ArrayLike<number>, v: ArrayLike<number>, out?: Vec4): Vec4 {
        out ??= new Vec4();
        const x = v[0], y = v[1], z = v[2], w = v[3];
        out[0] = m[0] * x + m[4] * y + m[8]  * z + m[12] * w;
        out[1] = m[1] * x + m[5] * y + m[9]  * z + m[13] * w;
        out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
        out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
        return out;
    }

    static equals(a: ArrayLike<number>, b: ArrayLike<number>, epsilon = EPSILON): boolean {
        for (let i = 0; i < 16; i++) {
            if (Math.abs(a[i] - b[i]) > epsilon) return false;
        }
        return true;
    }

    static exactEquals(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
        for (let i = 0; i < 16; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Batch transform an array of 3D positions with perspective divide.
     */
    static transformPositions(
        m: ArrayLike<number>,
        src: Float32Array,
        dst: Float32Array,
        count: number,
        srcStride = 3,
        dstStride = 3
    ): void {
        Vec3.transformPositions(m, src, dst, count, srcStride, dstStride);
    }

    /**
     * Batch transform an array of 3D direction vectors (ignoring translation).
     */
    static transformVectors(
        m: ArrayLike<number>,
        src: Float32Array,
        dst: Float32Array,
        count: number,
        srcStride = 3,
        dstStride = 3
    ): void {
        Vec3.transformDirections(m, src, dst, count, srcStride, dstStride);
    }
}

export type Mat4 = _Mat4;

export interface Mat4Factory {
    new (): Mat4;
    new (elements: ArrayLike<number>): Mat4;
    new (buffer: ArrayBufferLike, byteOffset?: number): Mat4;

    (): Mat4;
    (elements?: ArrayLike<number>): Mat4;
    (buffer: ArrayBufferLike, byteOffset?: number): Mat4;
}

export type Mat4Constructor = typeof _Mat4 & Mat4Factory;

const _Mat4Wrapper: any = function (
    a?: ArrayLike<number> | ArrayBufferLike,
    b?: number
): Mat4 {
    return new _Mat4(a as any, b);
};
Object.setPrototypeOf(_Mat4Wrapper, _Mat4);
_Mat4Wrapper.prototype = _Mat4.prototype;

export const Mat4: Mat4Constructor = _Mat4Wrapper;
