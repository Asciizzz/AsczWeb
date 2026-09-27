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

export interface InstanceData {
    /** Contiguous buffer of 4x4 world matrices (16 floats per instance). */
    matrices: Float32Array;
    /** Optional contiguous buffer of 4x4 normal matrices (16 floats per instance). */
    normalMatrices?: Float32Array;
    /** Number of active instances to render. Defaults to matrices.length / 16. */
    count: number;
}

export interface ActorOptions {
    /** Target GPU mesh */
    mesh: MeshGPU;

    /** Single shader for all submeshes or array per submesh */
    shaders?: ShaderGPU | (ShaderGPU | null)[];

    /** Material parameters per submesh or single uniform collection */
    params?: ShaderParams | ShaderParams[];

    /** 4x4 World matrix for single instance */
    transform?: Float32Array | ArrayLike<number>;

    /** Optional 4x4 normal matrix for single instance */
    normalMatrix?: Float32Array | ArrayLike<number>;

    /** Optional camera override */
    camera?: Camera;

    /** Optional skeletal skinning joint matrices */
    skin?: SkinData | Float32Array;

    /** Optional blendshape / morph weights */
    morph?: MorphData;

    /** Instance transforms or contiguous matrix buffer */
    instances?: InstanceData | Float32Array;

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
 * Atomic draw item holding mesh, shaders, material parameters, instance transforms,
 * optional camera override, and skeletal skinning data.
 */
export class Actor {
    mesh: MeshGPU;
    shaders: (ShaderGPU | null)[];
    params: ShaderParams[];
    camera?: Camera;
    skin?: SkinData;
    morph?: MorphData;

    /** Unified instance transform storage. Single entity = 1 instance. */
    instances: InstanceData;

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

            if (opts.instances) {
                if (opts.instances instanceof Float32Array) {
                    const norm = opts.normalMatrix
                        ? (opts.normalMatrix instanceof Float32Array ? opts.normalMatrix : new Float32Array(opts.normalMatrix))
                        : undefined;
                    this.instances = {
                        matrices: opts.instances,
                        normalMatrices: norm,
                        count: opts.instanceCount ?? Math.floor(opts.instances.length / 16),
                    };
                    if (opts.transform) {
                        this.instances.matrices.set(opts.transform, 0);
                    }
                } else {
                    this.instances = {
                        matrices: opts.instances.matrices,
                        normalMatrices: opts.instances.normalMatrices,
                        count: opts.instanceCount ?? opts.instances.count,
                    };
                    if (opts.transform) {
                        this.instances.matrices.set(opts.transform, 0);
                    }
                }
            } else if (opts.transform) {
                const mat = opts.transform instanceof Float32Array
                    ? opts.transform
                    : new Float32Array(opts.transform);
                const norm = opts.normalMatrix
                    ? (opts.normalMatrix instanceof Float32Array ? opts.normalMatrix : new Float32Array(opts.normalMatrix))
                    : undefined;
                this.instances = {
                    matrices: mat,
                    normalMatrices: norm,
                    count: opts.instanceCount ?? 1,
                };
            } else {
                this.instances = {
                    matrices: new Float32Array(IDENTITY_MAT4),
                    count: opts.instanceCount ?? 1,
                };
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

            const mat = transform
                ? (transform instanceof Float32Array ? transform : new Float32Array(transform))
                : new Float32Array(IDENTITY_MAT4);

            this.instances = {
                matrices: mat,
                count: 1,
            };
        }
    }

    /** World matrix of primary instance (index 0). */
    get transform(): Float32Array {
        return this.instances.matrices.subarray(0, 16);
    }

    set transform(world: Float32Array | ArrayLike<number>) {
        this.setTransform(world);
    }

    /** Normal matrix of primary instance (index 0). */
    get normalMatrix(): Float32Array | undefined {
        return this.instances.normalMatrices ? this.instances.normalMatrices.subarray(0, 16) : undefined;
    }

    set normalMatrix(norm: Float32Array | ArrayLike<number> | undefined) {
        if (!norm) {
            this.instances.normalMatrices = undefined;
            return;
        }
        if (!this.instances.normalMatrices || this.instances.normalMatrices.length < 16) {
            this.instances.normalMatrices = new Float32Array(16);
        }
        if (norm instanceof Float32Array && norm.length === 16) {
            this.instances.normalMatrices.set(norm, 0);
        } else {
            for (let i = 0; i < 16 && i < norm.length; i++) {
                this.instances.normalMatrices[i] = norm[i];
            }
        }
    }

    /** Active instance count. */
    get instanceCount(): number {
        return this.instances.count;
    }

    set instanceCount(count: number) {
        this.instances.count = count;
    }

    /**
     * Sets world matrix and optional normal matrix for a single instance.
     * Resets active instance count to 1.
     */
    setTransform(
        world: Float32Array | ArrayLike<number>,
        normal?: Float32Array | ArrayLike<number>
    ): this {
        if (this.instances.matrices.length < 16) {
            this.instances.matrices = new Float32Array(16);
        }

        if (world instanceof Float32Array && world.length === 16) {
            this.instances.matrices.set(world, 0);
        } else {
            for (let i = 0; i < 16 && i < world.length; i++) {
                this.instances.matrices[i] = world[i];
            }
        }
        this.instances.count = 1;

        if (normal) {
            if (!this.instances.normalMatrices || this.instances.normalMatrices.length < 16) {
                this.instances.normalMatrices = new Float32Array(16);
            }
            if (normal instanceof Float32Array && normal.length === 16) {
                this.instances.normalMatrices.set(normal, 0);
            } else {
                for (let i = 0; i < 16 && i < normal.length; i++) {
                    this.instances.normalMatrices[i] = normal[i];
                }
            }
        }
        return this;
    }

    /**
     * Sets continuous matrix stream for multi-instance batches.
     */
    setInstances(
        instances: Float32Array | InstanceData,
        count?: number,
        normalMatrices?: Float32Array
    ): this {
        if (instances instanceof Float32Array) {
            this.instances.matrices = instances;
            this.instances.count = count ?? Math.floor(instances.length / 16);
            if (normalMatrices) {
                this.instances.normalMatrices = normalMatrices;
            }
        } else {
            this.instances = {
                matrices: instances.matrices,
                normalMatrices: instances.normalMatrices,
                count: count ?? instances.count,
            };
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
}
