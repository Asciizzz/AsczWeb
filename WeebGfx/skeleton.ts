import { Mat4 } from "@asciiz/atoolkit/alm/index.js";

/**
 * Joint hierarchy node descriptor storing relative and inverse bind transforms.
 */
export interface JointData {
    /** Joint identifier name. */
    name: string;
    /** Parent joint index in skeleton array (-1 for root joints). */
    parentIndex: number;
    /** Local transform matrix relative to parent joint. */
    localMatrix: Mat4;
    /** Inverse bind pose matrix. */
    inverseBindMatrix: Mat4;
}

/**
 * CPU skeletal hierarchy evaluating joint transforms and skinning matrices using Alm.
 */
export class SkeletonCPU {
    /** Joint array in skeletal hierarchy. */
    joints: JointData[];

    private _worldTransforms?: Mat4[];
    private _computedFlags?: Uint8Array;
    private _skinEvalMat = new Mat4();

    constructor(joints?: JointData[]) {
        this.joints = joints
            ? joints.map((j) => ({
                  name: j.name,
                  parentIndex: j.parentIndex,
                  localMatrix: new Mat4(j.localMatrix),
                  inverseBindMatrix: new Mat4(j.inverseBindMatrix),
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
        const local = localMatrix ? new Mat4(localMatrix) : new Mat4();
        const invBind = inverseBindMatrix ? new Mat4(inverseBindMatrix) : new Mat4();

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
            this.joints[jointIndex].localMatrix.copy(matrix);
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

        if (!this._worldTransforms || this._worldTransforms.length < count) {
            this._worldTransforms = Array.from({ length: count }, () => new Mat4());
            this._computedFlags = new Uint8Array(count);
        }

        const worldList = this._worldTransforms;
        const flags = this._computedFlags!;
        flags.fill(0);

        const computeWorldTransform = (index: number): void => {
            if (flags[index]) return;

            const joint = this.joints[index];
            const local = localTransforms?.[index] ?? joint.localMatrix;
            const world = worldList[index];
            const parent = joint.parentIndex;

            if (parent < 0 || parent >= count) {
                world.copy(local);
            } else {
                computeWorldTransform(parent);
                worldList[parent].mul(local, world);
            }

            flags[index] = 1;
        };

        for (let i = 0; i < count; i++) {
            computeWorldTransform(i);
        }

        for (let i = 0; i < count; i++) {
            worldList[i].mul(this.joints[i].inverseBindMatrix, this._skinEvalMat);
            result.set(this._skinEvalMat, i * 16);
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
