import type { Node, Socket } from "../types.js";

/**
 * Transforms local vertex position and normal to world space using instance matrices.
 */
export class WorldTransformNode implements Node {
    id: string;
    type = "WorldTransform";
    stage: "vertex" = "vertex";

    inputs: Socket[];
    outputs: Socket[];

    constructor(id = "world_transform") {
        this.id = id;
        this.inputs = [
            { id: "in_position", name: "in_position", dataType: "vec3<f32>", isInput: true },
            { id: "in_normal", name: "in_normal", dataType: "vec3<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "out_position", name: "out_position", dataType: "vec3<f32>", isInput: false },
            { id: "out_normal", name: "out_normal", dataType: "vec3<f32>", isInput: false },
        ];
    }
}


/**
 * Transforms vertex position and normal using weighted skeletal joint matrices.
 */
export class SkinTransformNode implements Node {
    id: string;
    type = "SkinTransform";
    stage: "vertex" = "vertex";

    inputs: Socket[];
    outputs: Socket[];

    constructor(id = "skin_transform") {
        this.id = id;
        this.inputs = [
            { id: "in_position", name: "in_position", dataType: "vec3<f32>", isInput: true },
            { id: "in_normal", name: "in_normal", dataType: "vec3<f32>", isInput: true },
            { id: "in_joints", name: "in_joints", dataType: "vec4<u32>", isInput: true },
            { id: "in_weights", name: "in_weights", dataType: "vec4<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "out_position", name: "out_position", dataType: "vec3<f32>", isInput: false },
            { id: "out_normal", name: "out_normal", dataType: "vec3<f32>", isInput: false },
        ];
    }
}
