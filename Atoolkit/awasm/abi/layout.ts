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
	| "i64"
	| "u64"
	| "f32"
	| "f64"
	| "v128"
	| "ptr";

export interface StructField {
	readonly name: string;
	readonly type: StructFieldType;
	readonly count: number;
	readonly byteOffset: number;
	readonly byteSize: number;
	readonly alignment: number;
}

export interface StructDescriptor {
	readonly name: string;
	readonly fields: ReadonlyArray<StructField>;
	readonly stride: number;
	readonly alignment: number;
	readonly fieldMap: ReadonlyMap<string, StructField>;
}

interface FieldSpec {
	readonly name: string;
	readonly type: StructFieldType;
	readonly count: number;
	readonly baseSize: number;
	readonly requestedAlignment: number;
}

const TYPE_SIZES: Record<StructFieldType, number> = {
	i8: 1,
	u8: 1,
	i16: 2,
	u16: 2,
	i32: 4,
	u32: 4,
	i64: 8,
	u64: 8,
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
	i64: 8,
	u64: 8,
	f32: 4,
	f64: 8,
	v128: 16,
	ptr: 4,
};

function isPowerOfTwo(val: number): boolean {
	return (
		Number.isSafeInteger(val) &&
		val >= 1 &&
		val <= 0x40000000 &&
		(val & (val - 1)) === 0
	);
}

function alignUp(offset: number, alignment: number): number {
	const rem = offset % alignment;
	return rem === 0 ? offset : offset + (alignment - rem);
}

/**
 * Declarative `wasm32` scalar/SIMD struct layout calculator.
 *
 * Layout contract:
 * - Uses `wasm32` natural scalar alignments (`i8`/`u8`: 1, `i16`/`u16`: 2, `i32`/`u32`/`f32`/`ptr`: 4,
 *   `i64`/`u64`/`f64`: 8, `v128`: 16) unless overridden per field via `explicitAlignment`.
 * - Rejects duplicate field names, invalid types, non-positive counts, and non-power-of-two alignments.
 * - If `packAlignment` is passed to `finish(packAlignment)`, each field's effective alignment is
 *   `Math.min(fieldAlignment, packAlignment)` and the final struct alignment/stride is padded to
 *   `Math.min(maxFieldAlignment, packAlignment)`.
 * - `finish()` returns a frozen, immutable `StructDescriptor` snapshot that cannot be mutated by
 *   subsequent builder calls or external array modifications.
 */
export class StructLayout {
	readonly #name: string;
	readonly #fieldSpecs: FieldSpec[] = [];
	readonly #fieldNames = new Set<string>();

	constructor(name = "AnonymousStruct") {
		if (typeof name !== "string" || name.length === 0) {
			throw new TypeError("StructLayout: struct name must be a non-empty string.");
		}
		this.#name = name;
	}

	/**
	 * Appends a member field to the layout definition.
	 */
	field(
		name: string,
		type: StructFieldType,
		count = 1,
		explicitAlignment?: number
	): this {
		if (typeof name !== "string" || name.length === 0) {
			throw new TypeError("StructLayout.field: field name must be a non-empty string.");
		}
		if (this.#fieldNames.has(name)) {
			throw new Error(
				`StructLayout.field: duplicate field name '${name}' in struct '${this.#name}'.`
			);
		}
		if (!(type in TYPE_SIZES)) {
			throw new TypeError(
				`StructLayout.field: unknown field type '${String(type)}' for field '${name}'.`
			);
		}
		if (!Number.isSafeInteger(count) || count < 1) {
			throw new RangeError(
				`StructLayout.field: count must be a positive integer, received ${count}.`
			);
		}
		if (explicitAlignment !== undefined && !isPowerOfTwo(explicitAlignment)) {
			throw new RangeError(
				`StructLayout.field: explicitAlignment must be a positive power of two, received ${explicitAlignment}.`
			);
		}

		const baseSize = TYPE_SIZES[type];
		const requestedAlignment = explicitAlignment ?? TYPE_ALIGNMENTS[type];

		this.#fieldNames.add(name);
		this.#fieldSpecs.push({
			name,
			type,
			count,
			baseSize,
			requestedAlignment,
		});

		return this;
	}

	/**
	 * Computes field offsets, struct alignment, and total stride, returning an immutable `StructDescriptor` snapshot.
	 * When `packAlignment` is provided (for example `1`, `2`, `4`, `8`), caps each field's effective alignment
	 * to `Math.min(fieldAlignment, packAlignment)` before computing field offsets and final stride.
	 */
	finish(packAlignment?: number): StructDescriptor {
		if (packAlignment !== undefined && !isPowerOfTwo(packAlignment)) {
			throw new RangeError(
				`StructLayout.finish: packAlignment must be a positive power of two, received ${packAlignment}.`
			);
		}

		const fields: StructField[] = [];
		const fieldMap = new Map<string, StructField>();
		let currentOffset = 0;
		let maxEffectiveAlign = 1;

		for (let i = 0; i < this.#fieldSpecs.length; i++) {
			const spec = this.#fieldSpecs[i];
			const effectiveAlign =
				packAlignment !== undefined
					? Math.min(spec.requestedAlignment, packAlignment)
					: spec.requestedAlignment;

			const byteOffset = alignUp(currentOffset, effectiveAlign);
			const byteSize = spec.baseSize * spec.count;

			const fieldObj: StructField = Object.freeze({
				name: spec.name,
				type: spec.type,
				count: spec.count,
				byteOffset,
				byteSize,
				alignment: effectiveAlign,
			});

			fields.push(fieldObj);
			fieldMap.set(spec.name, fieldObj);

			currentOffset = byteOffset + byteSize;
			if (effectiveAlign > maxEffectiveAlign) {
				maxEffectiveAlign = effectiveAlign;
			}
		}

		const structAlign =
			packAlignment !== undefined
				? Math.min(maxEffectiveAlign, packAlignment)
				: maxEffectiveAlign;
		const stride = alignUp(currentOffset, structAlign);

		const frozenFields = Object.freeze(fields);
		return Object.freeze({
			name: this.#name,
			fields: frozenFields,
			stride,
			alignment: structAlign,
			fieldMap,
		});
	}

	/**
	 * Retrieves member field metadata from a compiled `StructDescriptor` in O(1) time.
	 */
	static getField(descriptor: StructDescriptor, name: string): StructField {
		const field = descriptor.fieldMap.get(name);
		if (!field) {
			throw new Error(`Field '${name}' not found in struct '${descriptor.name}'.`);
		}
		return field;
	}
}
