import type { Node, Socket } from "../types.js";

/**
 * Scalar float value or parameter node.
 * When isParam is true (default), the value acts as the fallback default
 * when no float value is provided in the Actor's material params.
 */
export class FloatNode implements Node {
    id: string;
    type = "Float";
    value: number;
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(id: string, defaultValue = 0.0, isParam = true, paramName?: string) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "f32", isInput: false },
        ];
    }
}

/**
 * 2-component vector node.
 * When isParam is true (default), the value acts as the fallback default.
 */
export class Vec2Node implements Node {
    id: string;
    type = "Vec2";
    value: [number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number] = [0, 0],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec2<f32>", isInput: false },
        ];
    }
}

/**
 * 3-component vector node.
 * When isParam is true (default), the value acts as the fallback default.
 */
export class Vec3Node implements Node {
    id: string;
    type = "Vec3";
    value: [number, number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number, number] = [0, 0, 0],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec3<f32>", isInput: false },
        ];
    }
}

/**
 * 4-component vector node representing vector or color data.
 * When isParam is true (default), the value acts as the fallback default
 * when no vector value is provided in the Actor's material params.
 */
export class Vec4Node implements Node {
    id: string;
    type = "Vec4";
    value: [number, number, number, number];
    isParam: boolean;
    paramName?: string;

    inputs: Socket[] = [];
    outputs: Socket[];

    constructor(
        id: string,
        defaultValue: [number, number, number, number] = [1, 1, 1, 1],
        isParam = true,
        paramName?: string
    ) {
        this.id = id;
        this.value = defaultValue;
        this.isParam = isParam;
        this.paramName = paramName ?? (isParam ? id : undefined);

        this.outputs = [
            { id: "value", name: "value", dataType: "vec4<f32>", isInput: false },
        ];
    }
}
