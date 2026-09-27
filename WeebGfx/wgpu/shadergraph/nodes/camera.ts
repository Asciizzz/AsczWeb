import type { Node, Socket } from "../types.js";

/**
 * Uniform matrix node (e.g. viewProjection matrix).
 */
export class UniformMatrixNode implements Node {
    id: string;
    type = "UniformMatrix";
    paramName: string;
    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id: string, paramName = "viewProj") {
        this.id = id;
        this.paramName = paramName;
        this.outputs = [
            { id: "matrix", name: "matrix", dataType: "mat4x4<f32>", isInput: false },
        ];
    }
}

/**
 * External camera input node providing view, projection, combined viewProj matrices, and camera world position.
 * Output sockets:
 * - 'view': mat4x4<f32> (Camera view matrix)
 * - 'proj': mat4x4<f32> (Camera projection matrix)
 * - 'viewProj': mat4x4<f32> (Combined view * projection matrix)
 * - 'position': vec3<f32> (Camera world position)
 */
export class CameraNode implements Node {
    id: string;
    type = "Camera";
    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id = "camera") {
        this.id = id;
        this.outputs = [
            { id: "view", name: "view", dataType: "mat4x4<f32>", isInput: false },
            { id: "proj", name: "proj", dataType: "mat4x4<f32>", isInput: false },
            { id: "viewProj", name: "viewProj", dataType: "mat4x4<f32>", isInput: false },
            { id: "position", name: "position", dataType: "vec3<f32>", isInput: false },
        ];
    }
}
