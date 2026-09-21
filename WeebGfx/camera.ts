import { Mat4 } from "@asciiz/atoolkit/alm/mat4.js";
import { Vec3 } from "@asciiz/atoolkit/alm/vec3.js";

export type CameraProjectionMode = "perspective" | "orthographic";

/**
 * Camera structure encapsulating view, projection, and zero-allocation uniform packing.
 * High-performance: maintains preallocated matrices and packed uniform buffers.
 */
export class Camera {
    readonly viewMatrix = Mat4.create();
    readonly projMatrix = Mat4.create();
    readonly viewProjMatrix = Mat4.create();
    readonly invViewMatrix = Mat4.create();
    readonly invProjMatrix = Mat4.create();

    readonly position = new Vec3(0, 0, 10);
    readonly target = new Vec3(0, 0, 0);
    readonly up = new Vec3(0, 1, 0);

    mode: CameraProjectionMode = "perspective";
    fovY = Math.PI / 4;
    aspect = 1.0;
    near = 0.1;
    far = 1000.0;

    // Orthographic bounds
    orthoLeft = -10;
    orthoRight = 10;
    orthoBottom = -10;
    orthoTop = 10;

    /**
     * Continuous 52-float (208 bytes) uniform buffer:
     *   0..15: viewMatrix (mat4x4<f32>, 64B)
     *  16..31: projMatrix (mat4x4<f32>, 64B)
     *  32..47: viewProjMatrix (mat4x4<f32>, 64B)
     *  48..50: cameraPosition (vec3<f32>, 12B)
     *  51:     _pad (f32, 4B)
     */
    readonly uniformData = new Float32Array(52);

    constructor(fovY = Math.PI / 4, aspect = 1.0, near = 0.1, far = 1000.0) {
        this.fovY = fovY;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this.updateProjection();
        this.updateView();
    }

    setPerspective(fovY: number, aspect: number, near = 0.1, far = 1000.0): this {
        this.mode = "perspective";
        this.fovY = fovY;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this.updateProjection();
        return this;
    }

    setOrthographic(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near = 0.1,
        far = 1000.0
    ): this {
        this.mode = "orthographic";
        this.orthoLeft = left;
        this.orthoRight = right;
        this.orthoBottom = bottom;
        this.orthoTop = top;
        this.near = near;
        this.far = far;
        this.updateProjection();
        return this;
    }

    setAspect(aspect: number): this {
        if (this.aspect !== aspect) {
            this.aspect = aspect;
            this.updateProjection();
        }
        return this;
    }

    lookAt(
        eye: [number, number, number] | Float32Array | Vec3,
        target: [number, number, number] | Float32Array | Vec3,
        up?: [number, number, number] | Float32Array | Vec3
    ): this {
        this.position[0] = eye[0];
        this.position[1] = eye[1];
        this.position[2] = eye[2];

        this.target[0] = target[0];
        this.target[1] = target[1];
        this.target[2] = target[2];

        if (up) {
            this.up[0] = up[0];
            this.up[1] = up[1];
            this.up[2] = up[2];
        }

        this.updateView();
        return this;
    }

    updateProjection(): this {
        if (this.mode === "perspective") {
            Mat4.perspectiveZO(this.fovY, this.aspect, this.near, this.far, this.projMatrix);
        } else {
            Mat4.orthoZO(
                this.orthoLeft,
                this.orthoRight,
                this.orthoBottom,
                this.orthoTop,
                this.near,
                this.far,
                this.projMatrix
            );
        }
        Mat4.invert(this.projMatrix, this.invProjMatrix);
        this._updateViewProj();
        return this;
    }

    updateView(): this {
        Mat4.lookAt(this.position, this.target, this.up, this.viewMatrix);
        Mat4.invert(this.viewMatrix, this.invViewMatrix);
        this._updateViewProj();
        return this;
    }

    update(): this {
        return this.updateView();
    }

    private _updateViewProj(): void {
        this.projMatrix.mul(this.viewMatrix, this.viewProjMatrix);

        // Pack into continuous uniform buffer (zero heap allocation)
        this.uniformData.set(this.viewMatrix, 0);
        this.uniformData.set(this.projMatrix, 16);
        this.uniformData.set(this.viewProjMatrix, 32);
        this.uniformData[48] = this.position[0];
        this.uniformData[49] = this.position[1];
        this.uniformData[50] = this.position[2];
        this.uniformData[51] = 0.0;
    }

    getUniformData(): Float32Array {
        return this.uniformData;
    }
}
