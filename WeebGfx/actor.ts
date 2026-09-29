import type { MeshGPU } from "./mesh.js";
import type { ShaderGPU } from "./shader.js";
import type { ShaderParams } from "./types.js";

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

const IDENTITY_MAT4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

/**
 * Shader pass bucket mapping a shader to its target submesh indices and parameters.
 */
export interface ActorPass {
    shader: ShaderGPU;
    submeshIndices: number[];
    params: (ShaderParams | null)[];
}

/**
 * Atomic draw item holding mesh, shader pass buckets,
 * instance transforms, and skeletal skinning data.
 */
export class Actor {
    public mesh: MeshGPU;

    /**
     * Shader passes bucketed by shader.
     * Each pass specifies a shader, target submesh indices, and per-submesh parameters.
     */
    public passes: ActorPass[] = [];

    /** Unified instance transform storage. Single entity = 1 instance. */
    public instances: InstanceData;

    public skin?: SkinData;
    public morph?: MorphData;

    constructor(
        mesh: MeshGPU,
        shader?: ShaderGPU | ActorPass | ActorPass[],
        transform?: Float32Array | ArrayLike<number>
    ) {
        this.mesh = mesh;
        this.passes = [];

        const mat = transform
            ? (transform instanceof Float32Array ? transform : new Float32Array(transform))
            : new Float32Array(IDENTITY_MAT4);

        this.instances = {
            matrices: mat,
            count: 1,
        };

        if (shader) {
            if (Array.isArray(shader)) {
                this.passes = [...shader];
            } else if ("submeshIndices" in shader) {
                this.passes = [shader];
            } else {
                this.addPass(shader);
            }
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
        if (norm instanceof Float32Array) {
            this.instances.normalMatrices = norm;
        } else {
            this.instances.normalMatrices = new Float32Array(norm);
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
     * Adds a pass bucket targeting the specified submesh indices with optional parameters.
     * When submeshIndices is omitted, targets all submeshes in the mesh.
     */
    addPass(
        shader: ShaderGPU,
        submeshIndices?: number | number[],
        params?: ShaderParams | (ShaderParams | null)[] | null
    ): this {
        const subCount = this.mesh?.submeshes?.length ?? 1;
        let indices: number[];
        if (submeshIndices === undefined) {
            indices = Array.from({ length: subCount }, (_, i) => i);
        } else if (Array.isArray(submeshIndices)) {
            indices = [...submeshIndices];
        } else {
            indices = [submeshIndices];
        }

        let pList: (ShaderParams | null)[];
        if (Array.isArray(params)) {
            pList = [...params];
        } else if (params !== undefined && params !== null) {
            pList = Array(indices.length).fill(params);
        } else {
            pList = Array(indices.length).fill(null);
        }

        while (pList.length < indices.length) {
            pList.push(null);
        }

        let existingPass = this.passes.find((p) => p.shader === shader);
        if (!existingPass) {
            existingPass = {
                shader,
                submeshIndices: [],
                params: [],
            };
            this.passes.push(existingPass);
        }

        for (let i = 0; i < indices.length; i++) {
            const smIdx = indices[i];
            const existingIdx = existingPass.submeshIndices.indexOf(smIdx);
            if (existingIdx !== -1) {
                if (pList[i] !== null) {
                    existingPass.params[existingIdx] = pList[i];
                }
            } else {
                existingPass.submeshIndices.push(smIdx);
                existingPass.params.push(pList[i]);
            }
        }

        return this;
    }

    /**
     * Clears all passes and adds a single shader pass.
     */
    setPass(
        shader: ShaderGPU,
        submeshIndices?: number | number[],
        params?: ShaderParams | (ShaderParams | null)[] | null
    ): this {
        this.passes = [];
        return this.addPass(shader, submeshIndices, params);
    }

    /**
     * Finds existing pass for shader if present.
     */
    getPass(shader: ShaderGPU): ActorPass | undefined {
        return this.passes.find((p) => p.shader === shader);
    }

    /**
     * Removes pass matching shader.
     */
    removePass(shader: ShaderGPU): this {
        this.passes = this.passes.filter((p) => p.shader !== shader);
        return this;
    }

    /**
     * Clears all passes.
     */
    clearPasses(): this {
        this.passes = [];
        return this;
    }

    /**
     * Sets parameter override for a specific submesh or all submeshes in a pass.
     */
    setPassParams(
        shader: ShaderGPU,
        params: ShaderParams | null,
        submeshIndex?: number
    ): this {
        const pass = this.getPass(shader);
        if (!pass) return this;

        if (submeshIndex !== undefined) {
            const idx = pass.submeshIndices.indexOf(submeshIndex);
            if (idx !== -1) {
                pass.params[idx] = params;
            } else {
                pass.submeshIndices.push(submeshIndex);
                pass.params.push(params);
            }
        } else {
            for (let i = 0; i < pass.params.length; i++) {
                pass.params[i] = params;
            }
        }
        return this;
    }

    /** Checks if submesh index is present in any pass. */
    isSubmeshVisible(submeshIndex: number): boolean {
        return this.passes.some((p) => p.submeshIndices.includes(submeshIndex));
    }

    /** Toggles visibility for specified submesh index across all passes. */
    setSubmeshVisible(submeshIndex: number, visible: boolean): this {
        if (!visible) {
            for (const pass of this.passes) {
                const idx = pass.submeshIndices.indexOf(submeshIndex);
                if (idx !== -1) {
                    pass.submeshIndices.splice(idx, 1);
                    pass.params.splice(idx, 1);
                }
            }
        }
        return this;
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
