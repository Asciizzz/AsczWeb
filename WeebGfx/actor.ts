import type { MeshGPU } from "./mesh.js";
import type { ShaderGPU } from "./shader.js";
import type { ShaderParams } from "./types.js";
import type { Camera } from "./camera.js";

export interface SkinData {
    jointMatrices: Float32Array;
    jointCount: number;
}

export interface MorphData {
    weights: Float32Array;
    count: number;
}

export interface ActorOptions {
    /** Target GPU mesh */
    mesh: MeshGPU;

    /** Single shader for all submeshes or array per submesh */
    shaders?: ShaderGPU | (ShaderGPU | null)[];

    /** Material parameters per submesh or single uniform collection */
    params?: ShaderParams | ShaderParams[];

    /** 4x4 World matrix */
    transform?: Float32Array | ArrayLike<number>;

    /** Optional 4x4 normal matrix */
    normalMatrix?: Float32Array | ArrayLike<number>;

    /** Optional camera override */
    camera?: Camera;

    /** Optional skeletal skinning joint matrices */
    skin?: SkinData | Float32Array;

    /** Optional blendshape / morph weights */
    morph?: MorphData;

    /** Optional continuous Float32Array of 4x4 instance matrices for GPU instancing */
    instances?: Float32Array;

    /** Number of instances to draw */
    instanceCount?: number;
}

const IDENTITY_MAT4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

/**
 * Draw item holding mesh, shaders, material parameters, transform, camera override, and skinning data.
 */
export class Actor {
    mesh: MeshGPU;
    shaders: (ShaderGPU | null)[];
    params: ShaderParams[];
    transform: Float32Array;
    normalMatrix?: Float32Array;
    camera?: Camera;
    skin?: SkinData;
    morph?: MorphData;
    instances?: Float32Array;
    instanceCount: number;

    constructor(
        meshOrOptions: MeshGPU | ActorOptions,
        shader?: ShaderGPU | (ShaderGPU | null)[],
        transform?: Float32Array | ArrayLike<number>
    ) {
        if ("mesh" in meshOrOptions && typeof (meshOrOptions as any).mesh === "object") {
            const opts = meshOrOptions as ActorOptions;
            this.mesh = opts.mesh;

            if (Array.isArray(opts.shaders)) {
                this.shaders = [...opts.shaders];
            } else if (opts.shaders) {
                this.shaders = [opts.shaders];
            } else {
                this.shaders = [];
            }

            if (Array.isArray(opts.params)) {
                this.params = [...opts.params];
            } else if (opts.params) {
                this.params = [opts.params];
            } else {
                this.params = [];
            }

            if (opts.transform) {
                this.transform = opts.transform instanceof Float32Array
                    ? opts.transform
                    : new Float32Array(opts.transform);
            } else {
                this.transform = new Float32Array(IDENTITY_MAT4);
            }

            if (opts.normalMatrix) {
                this.normalMatrix = opts.normalMatrix instanceof Float32Array
                    ? opts.normalMatrix
                    : new Float32Array(opts.normalMatrix);
            }

            this.camera = opts.camera;

            if (opts.skin) {
                if (opts.skin instanceof Float32Array) {
                    this.skin = {
                        jointMatrices: opts.skin,
                        jointCount: Math.floor(opts.skin.length / 16),
                    };
                } else {
                    this.skin = opts.skin;
                }
            }

            this.morph = opts.morph;
            this.instances = opts.instances;
            this.instanceCount = opts.instanceCount ?? (opts.instances ? Math.floor(opts.instances.length / 16) : 1);
        } else {
            this.mesh = meshOrOptions as MeshGPU;

            if (Array.isArray(shader)) {
                this.shaders = [...shader];
            } else if (shader) {
                this.shaders = [shader];
            } else {
                this.shaders = [];
            }

            this.params = [];

            if (transform) {
                this.transform = transform instanceof Float32Array
                    ? transform
                    : new Float32Array(transform);
            } else {
                this.transform = new Float32Array(IDENTITY_MAT4);
            }

            this.instanceCount = 1;
        }
    }

    /**
     * Sets world matrix and optional normal matrix.
     */
    setTransform(
        world: Float32Array | ArrayLike<number>,
        normal?: Float32Array | ArrayLike<number>
    ): this {
        if (world instanceof Float32Array && world.length === 16) {
            this.transform.set(world);
        } else {
            for (let i = 0; i < 16 && i < world.length; i++) {
                this.transform[i] = world[i];
            }
        }

        if (normal) {
            if (!this.normalMatrix) {
                this.normalMatrix = new Float32Array(16);
            }
            if (normal instanceof Float32Array && normal.length === 16) {
                this.normalMatrix.set(normal);
            } else {
                for (let i = 0; i < 16 && i < normal.length; i++) {
                    this.normalMatrix[i] = normal[i];
                }
            }
        }
        return this;
    }

    /**
     * Sets shader for specified submesh index.
     */
    setShader(shader: ShaderGPU | null, submeshIndex = 0): this {
        this.shaders[submeshIndex] = shader;
        return this;
    }

    /**
     * Sets material parameters for specified submesh index.
     */
    setParams(params: ShaderParams, submeshIndex = 0): this {
        this.params[submeshIndex] = params;
        return this;
    }

    /**
     * Sets camera override.
     */
    setCamera(camera?: Camera): this {
        this.camera = camera;
        return this;
    }

    /**
     * Sets skeletal skinning joint matrices.
     */
    setSkin(joints: Float32Array | SkinData, jointCount?: number): this {
        if (joints instanceof Float32Array) {
            this.skin = {
                jointMatrices: joints,
                jointCount: jointCount ?? Math.floor(joints.length / 16),
            };
        } else {
            this.skin = joints;
        }
        return this;
    }

    /**
     * Sets instance matrices for instanced draws.
     */
    setInstances(instances: Float32Array, count?: number): this {
        this.instances = instances;
        this.instanceCount = count ?? Math.floor(instances.length / 16);
        return this;
    }
}
