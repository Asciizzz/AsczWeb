/**
 * Joint hierarchy node descriptor storing relative and inverse bind transforms.
 */
export interface JointData {
    /** Joint identifier name. */
    name: string;
    /** Parent joint index in skeleton array (-1 for root joints). */
    parentIndex: number;
    /** Local transform matrix relative to parent joint (16 floats, column-major). */
    localMatrix: Float32Array;
    /** Inverse bind pose matrix (16 floats, column-major). */
    inverseBindMatrix: Float32Array;
}

const IDENTITY_MAT4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

/**
 * Multiplies two 4x4 column-major matrices with arbitrary buffer offsets.
 */
function mulMat4(
    a: ArrayLike<number>, aOff: number,
    b: ArrayLike<number>, bOff: number,
    out: Float32Array, outOff: number
): void {
    const a00 = a[aOff + 0],  a01 = a[aOff + 1],  a02 = a[aOff + 2],  a03 = a[aOff + 3];
    const a10 = a[aOff + 4],  a11 = a[aOff + 5],  a12 = a[aOff + 6],  a13 = a[aOff + 7];
    const a20 = a[aOff + 8],  a21 = a[aOff + 9],  a22 = a[aOff + 10], a23 = a[aOff + 11];
    const a30 = a[aOff + 12], a31 = a[aOff + 13], a32 = a[aOff + 14], a33 = a[aOff + 15];

    let b0 = b[bOff + 0], b1 = b[bOff + 1], b2 = b[bOff + 2], b3 = b[bOff + 3];
    out[outOff + 0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[outOff + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[outOff + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[outOff + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[bOff + 4]; b1 = b[bOff + 5]; b2 = b[bOff + 6]; b3 = b[bOff + 7];
    out[outOff + 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[outOff + 5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[outOff + 6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[outOff + 7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[bOff + 8]; b1 = b[bOff + 9]; b2 = b[bOff + 10]; b3 = b[bOff + 11];
    out[outOff + 8]  = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[outOff + 9]  = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[outOff + 10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[outOff + 11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[bOff + 12]; b1 = b[bOff + 13]; b2 = b[bOff + 14]; b3 = b[bOff + 15];
    out[outOff + 12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[outOff + 13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[outOff + 14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[outOff + 15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
}

/**
 * CPU skeletal hierarchy evaluating joint transforms and skinning matrices.
 */
export class SkeletonCPU {
    /** Joint array in skeletal hierarchy. */
    joints: JointData[];

    private _worldMatrices?: Float32Array;
    private _computedFlags?: Uint8Array;

    constructor(joints?: JointData[]) {
        this.joints = joints
            ? joints.map((j) => ({
                  name: j.name,
                  parentIndex: j.parentIndex,
                  localMatrix: new Float32Array(j.localMatrix),
                  inverseBindMatrix: new Float32Array(j.inverseBindMatrix),
              }))
            : [];
    }

    /**
     * Appends joint descriptor to skeleton array.
     */
    addJoint(
        name: string,
        parentIndex: number,
        localMatrix?: ArrayLike<number>,
        inverseBindMatrix?: ArrayLike<number>
    ): number {
        const local = new Float32Array(16);
        if (localMatrix) {
            for (let i = 0; i < 16 && i < localMatrix.length; i++) {
                local[i] = localMatrix[i];
            }
        } else {
            local.set(IDENTITY_MAT4);
        }

        const invBind = new Float32Array(16);
        if (inverseBindMatrix) {
            for (let i = 0; i < 16 && i < inverseBindMatrix.length; i++) {
                invBind[i] = inverseBindMatrix[i];
            }
        } else {
            invBind.set(IDENTITY_MAT4);
        }

        const index = this.joints.length;
        this.joints.push({
            name,
            parentIndex,
            localMatrix: local,
            inverseBindMatrix: invBind,
        });
        return index;
    }

    /**
     * Returns total number of joints in skeleton.
     */
    get jointCount(): number {
        return this.joints.length;
    }

    /**
     * Updates local matrix of specified joint.
     */
    setLocalMatrix(jointIndex: number, matrix: ArrayLike<number>): this {
        if (jointIndex >= 0 && jointIndex < this.joints.length) {
            const target = this.joints[jointIndex].localMatrix;
            for (let i = 0; i < 16 && i < matrix.length; i++) {
                target[i] = matrix[i];
            }
        }
        return this;
    }

    /**
     * Evaluates forward kinematics and returns flat array of skinning matrices.
     * Each joint skinning matrix is computed as: JointMatrix = WorldMatrix * InverseBindMatrix.
     */
    computeJointMatrices(
        localTransforms?: (Float32Array | ArrayLike<number>)[],
        out?: Float32Array
    ): Float32Array {
        const count = this.joints.length;
        if (count === 0) {
            return out ?? new Float32Array(0);
        }

        const requiredFloats = count * 16;
        const result = out && out.length >= requiredFloats ? out : new Float32Array(requiredFloats);

        if (!this._worldMatrices || this._worldMatrices.length < requiredFloats) {
            this._worldMatrices = new Float32Array(requiredFloats);
            this._computedFlags = new Uint8Array(count);
        }

        const world = this._worldMatrices;
        const flags = this._computedFlags!;
        flags.fill(0);

        const computeWorldTransform = (index: number): void => {
            if (flags[index]) return;

            const joint = this.joints[index];
            const local = localTransforms?.[index] ?? joint.localMatrix;
            const jointOffset = index * 16;
            const parent = joint.parentIndex;

            if (parent < 0 || parent >= count) {
                for (let k = 0; k < 16; k++) {
                    world[jointOffset + k] = local[k];
                }
            } else {
                computeWorldTransform(parent);
                mulMat4(world, parent * 16, local, 0, world, jointOffset);
            }

            flags[index] = 1;
        };

        for (let i = 0; i < count; i++) {
            computeWorldTransform(i);
        }

        for (let i = 0; i < count; i++) {
            mulMat4(world, i * 16, this.joints[i].inverseBindMatrix, 0, result, i * 16);
        }

        return result;
    }

    /**
     * Creates deep copy of skeleton hierarchy.
     */
    clone(): SkeletonCPU {
        return new SkeletonCPU(this.joints);
    }
}
