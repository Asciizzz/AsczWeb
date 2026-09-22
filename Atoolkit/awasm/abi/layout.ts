// ================================================================
//  Awasm - ABI: StructLayout
// ================================================================

export type StructFieldType =
    | "i8"
    | "u8"
    | "i16"
    | "u16"
    | "i32"
    | "u32"
    | "f32"
    | "f64"
    | "v128"
    | "ptr";

export interface StructField {
    name: string;
    type: StructFieldType;
    count: number;
    byteOffset: number;
    byteSize: number;
    alignment: number;
}

export interface StructDescriptor {
    name: string;
    fields: StructField[];
    stride: number;
    alignment: number;
    fieldMap: Map<string, StructField>;
}

const TYPE_SIZES: Record<StructFieldType, number> = {
    i8: 1,
    u8: 1,
    i16: 2,
    u16: 2,
    i32: 4,
    u32: 4,
    f32: 4,
    f64: 8,
    v128: 16,
    ptr: 4,
};

const TYPE_ALIGNMENTS: Record<StructFieldType, number> = {
    i8: 1,
    u8: 1,
    i16: 2,
    u16: 2,
    i32: 4,
    u32: 4,
    f32: 4,
    f64: 8,
    v128: 16,
    ptr: 4,
};

/**
 * Declarative binary struct layout calculator conforming to C/Rust repr(C) rules.
 * Computes member byte offsets, alignment padding, and total struct stride with SIMD support.
 */
export class StructLayout {
    private readonly _name: string;
    private readonly _fields: StructField[];
    private _currentOffset: number;
    private _maxAlignment: number;

    constructor(name: string = "AnonymousStruct") {
        this._name = name;
        this._fields = [];
        this._currentOffset = 0;
        this._maxAlignment = 1;
    }

    /**
     * Appends a member field to the layout, aligning offset to the field's natural or explicit alignment.
     */
    public field(name: string, type: StructFieldType, count: number = 1, explicitAlignment?: number): this {
        if (count <= 0) {
            throw new Error(`Field count must be at least 1, received ${count}`);
        }

        const baseSize = TYPE_SIZES[type];
        const baseAlign = explicitAlignment ?? TYPE_ALIGNMENTS[type];
        const totalSize = baseSize * count;

        const mask = baseAlign - 1;
        const alignedOffset = (this._currentOffset + mask) & ~mask;

        this._fields.push({
            name,
            type,
            count,
            byteOffset: alignedOffset,
            byteSize: totalSize,
            alignment: baseAlign,
        });

        this._currentOffset = alignedOffset + totalSize;
        if (baseAlign > this._maxAlignment) {
            this._maxAlignment = baseAlign;
        }

        return this;
    }

    /**
     * Finalizes struct layout, computing total stride padded to a multiple of largest member alignment.
     */
    public finish(packAlignment?: number): StructDescriptor {
        const align = packAlignment !== undefined ? Math.min(this._maxAlignment, packAlignment) : this._maxAlignment;
        const mask = align - 1;
        const stride = (this._currentOffset + mask) & ~mask;

        const fieldMap = new Map<string, StructField>();
        for (let i = 0; i < this._fields.length; i++) {
            const f = this._fields[i];
            fieldMap.set(f.name, f);
        }

        return {
            name: this._name,
            fields: [...this._fields],
            stride,
            alignment: align,
            fieldMap,
        };
    }

    /**
     * Retrieves member field metadata from a compiled StructDescriptor in O(1) time.
     */
    public static getField(descriptor: StructDescriptor, name: string): StructField {
        const field = descriptor.fieldMap.get(name);
        if (!field) {
            throw new Error(`Field '${name}' not found in struct '${descriptor.name}'`);
        }
        return field;
    }
}
