import type { MeshCPU, MeshGPU } from "../mesh.js";
import type { TextureCPU, TextureGPU } from "../texture.js";
import type { SkeletonCPU } from "../skeleton.js";
import type { Actor, ActorOptions } from "../actor.js";

/**
 * CPU material parameter container parsed from asset metadata.
 */
export interface MaterialData {
    name?: string;
    baseColorFactor?: [number, number, number, number];
    baseColorTextureIndex?: number;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTextureIndex?: number;
    normalTextureIndex?: number;
    normalTextureScale?: number;
    occlusionTextureIndex?: number;
    occlusionTextureStrength?: number;
    emissiveFactor?: [number, number, number];
    emissiveTextureIndex?: number;
    alphaMode?: "OPAQUE" | "MASK" | "BLEND";
    alphaCutoff?: number;
    doubleSided?: boolean;
}

/**
 * Pure CPU model representation holding geometry, textures, materials, and skeletal hierarchy.
 */
export interface ModelCPU {
    name?: string;
    mesh: MeshCPU;
    textures: TextureCPU[];
    materials: MaterialData[];
    skeleton?: SkeletonCPU;
}

/**
 * Abstract GPU model container managing hardware resources and instantiating Actors.
 */
export abstract class ModelGPU {
    name?: string;
    abstract mesh: MeshGPU;
    abstract textures: TextureGPU[];
    abstract materials: MaterialData[];
    skeleton?: SkeletonCPU;

    /**
     * Stamped Actor factory creating independent render units with separate transform streams.
     */
    abstract createActor(options?: Partial<ActorOptions>): Actor;

    /**
     * Disposes underlying GPU mesh, texture, and pipeline resources.
     */
    abstract destroy(): void;
}
