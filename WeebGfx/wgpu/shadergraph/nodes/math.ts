import type { WgslDataType, Node, Socket } from "../types.js";

/**
 * Component-wise vector or float addition.
 */
export class AddNode implements Node {
    id: string;
    type = "Add";
    dataType: WgslDataType;
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string, dataType: WgslDataType = "vec3<f32>") {
        this.id = id;
        this.dataType = dataType;
        this.inputs = [
            { id: "a", name: "a", dataType, isInput: true },
            { id: "b", name: "b", dataType, isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType, isInput: false },
        ];
    }
}

/**
 * Component-wise multiplication or matrix-vector product.
 */
export class MultiplyNode implements Node {
    id: string;
    type = "Multiply";
    dataType: WgslDataType;
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string, dataType: WgslDataType = "vec4<f32>") {
        this.id = id;
        this.dataType = dataType;
        this.inputs = [
            { id: "a", name: "a", dataType, isInput: true },
            { id: "b", name: "b", dataType, isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType, isInput: false },
        ];
    }
}
