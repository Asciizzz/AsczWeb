import type { WgslDataType, Node, Socket } from "../types.js";

/**
 * Terminal fragment execution sink that discards the fragment if condition is true.
 */
export class DiscardNode implements Node {
    id: string;
    type = "Discard";
    stage: "fragment" = "fragment";
    inputs: Socket[];
    outputs: Socket[] = [];

    constructor(id = "discard") {
        this.id = id;
        this.inputs = [
            { id: "condition", name: "condition", dataType: "bool", isInput: true },
        ];
    }
}

export type CompareOp =
    | "less"
    | "less_equal"
    | "greater"
    | "greater_equal"
    | "equal"
    | "not_equal";

/**
 * Compares two scalar or vector values using a relational operator and outputs a boolean.
 */
export class CompareNode implements Node {
    id: string;
    type = "Compare";
    op: CompareOp;
    dataType: WgslDataType;
    defaultB?: number;
    inputs: Socket[];
    outputs: Socket[];

    constructor(
        id: string,
        op: CompareOp = "less",
        dataType: WgslDataType = "f32",
        defaultB?: number
    ) {
        this.id = id;
        this.op = op;
        this.dataType = dataType;
        this.defaultB = defaultB;
        this.inputs = [
            { id: "a", name: "a", dataType, isInput: true },
            { id: "b", name: "b", dataType, isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType: "bool", isInput: false },
        ];
    }
}

export type LogicOp = "and" | "or";

/**
 * Combines two boolean conditions with logical operators (&&, ||).
 */
export class LogicNode implements Node {
    id: string;
    type = "Logic";
    op: LogicOp;
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string, op: LogicOp = "and") {
        this.id = id;
        this.op = op;
        this.inputs = [
            { id: "a", name: "a", dataType: "bool", isInput: true },
            { id: "b", name: "b", dataType: "bool", isInput: true },
        ];
        this.outputs = [
            { id: "res", name: "res", dataType: "bool", isInput: false },
        ];
    }
}

/**
 * Decomposes a 4D vector into individual float channels (r, g, b, a / x, y, z, w).
 */
export class SplitVec4Node implements Node {
    id: string;
    type = "SplitVec4";
    inputs: Socket[];
    outputs: Socket[];

    constructor(id: string) {
        this.id = id;
        this.inputs = [
            { id: "in", name: "in", dataType: "vec4<f32>", isInput: true },
        ];
        this.outputs = [
            { id: "r", name: "r", dataType: "f32", isInput: false },
            { id: "g", name: "g", dataType: "f32", isInput: false },
            { id: "b", name: "b", dataType: "f32", isInput: false },
            { id: "a", name: "a", dataType: "f32", isInput: false },
            { id: "x", name: "x", dataType: "f32", isInput: false },
            { id: "y", name: "y", dataType: "f32", isInput: false },
            { id: "z", name: "z", dataType: "f32", isInput: false },
            { id: "w", name: "w", dataType: "f32", isInput: false },
        ];
    }
}
