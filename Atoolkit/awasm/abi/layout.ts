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
    ptr: 4, // 32-bit WebAssembly linear memory pointer
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
    v128: 16, // SIMD v128 requires 16-byte alignment
    ptr: 4,
};

/**
 * Declarative binary struct layout calculator conforming to C/Rust repr(C) rules.
 *
 * Class Responsibility:
 * Calculates member byte offsets, alignment padding, and total struct stride.
 * Provides lookup tables for fast offset indexing in linear memory.
 *
 * Method Contracts:
 * - field(name: string, type: StructFieldType, count?: number): Appends struct member.
 * - finish(packAlignment?: number): Computes final stride and returns StructDescriptor.
 * - getField(descriptor: StructDescriptor, name: string): Returns field metadata.
 *
 * Operational Invariants:
 * - Automatically aligns each member to its natural alignment or packAlignment limit.
 * - Total stride is padded to a multiple of largest member alignment.
 * - Supports 16-byte alignment for WebAssembly SIMD v128 vectors.
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

    public static getField(descriptor: StructDescriptor, name: string): StructField {
        const field = descriptor.fieldMap.get(name);
        if (!field) {
            throw new Error(`Field '${name}' not found in struct '${descriptor.name}'`);
        }
        return field;
    }
}
