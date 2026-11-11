import { type Entity, entityIndex, isValidEntityHandle } from "./Entity.js";

/**
 * Flat Float32Array sparse-set component store with fixed stride per record.
 *
 * Contract:
 * - stride must be a positive integer (>= 1); initialCapacity must be a non-negative integer (>= 0).
 * - At most one generation may occupy a given entity slot index at a time. Calling set() or
 *   setFromArray() with a handle whose slot is occupied by a different generation throws an Error
 *   and leaves the store unchanged.
 * - Inserting a new record with fewer values than stride zero-fills the remaining components.
 * - Updating an existing record with fewer values than stride updates only the supplied leading
 *   components and preserves the remaining components.
 * - get(entity) returns a borrowed Float32Array subarray into the backing buffer. It becomes detached
 *   or stale if the store grows, and refers to whatever record occupies that dense slot after delete().
 *   Use copyTo() or getDirect() when stable values are required across mutations.
 */
export class FloatSet {
	readonly stride: number;

	#sparse: Int32Array = new Int32Array(256).fill(-1);
	#dense: Float32Array;
	#entities: Entity[] = [];
	#size = 0;
	#iterationDepth = 0;

	constructor(stride: number, initialCapacity = 64) {
		if (!Number.isInteger(stride) || stride < 1) {
			throw new RangeError(`FloatSet stride must be a positive integer, got ${stride}.`);
		}
		if (!Number.isInteger(initialCapacity) || initialCapacity < 0) {
			throw new RangeError(`FloatSet initialCapacity must be a non-negative integer, got ${initialCapacity}.`);
		}
		this.stride = stride;
		this.#dense = new Float32Array(initialCapacity * stride);
	}

	#ensureSparseCapacity(slot: number): void {
		if (slot < this.#sparse.length) {
			return;
		}
		let nextCap = this.#sparse.length;
		while (nextCap <= slot) {
			nextCap *= 2;
		}
		const nextSparse = new Int32Array(nextCap).fill(-1);
		nextSparse.set(this.#sparse);
		this.#sparse = nextSparse;
	}

	#ensureDenseCapacity(minRecords: number): void {
		const currentCap = this.#dense.length / this.stride;
		if (minRecords <= currentCap) {
			return;
		}
		let nextCap = Math.max(1, currentCap);
		while (nextCap < minRecords) {
			nextCap *= 2;
		}
		const nextDense = new Float32Array(nextCap * this.stride);
		nextDense.set(this.#dense.subarray(0, this.#size * this.stride));
		this.#dense = nextDense;
	}

	#assertValidEntity(entity: Entity): void {
		if (!isValidEntityHandle(entity)) {
			throw new RangeError(`Invalid entity handle: ${entity}`);
		}
	}

	#assertValidComponentIndex(componentIndex: number): void {
		if (!Number.isInteger(componentIndex) || componentIndex < 0 || componentIndex >= this.stride) {
			throw new RangeError(
				`Component index ${componentIndex} out of bounds for stride ${this.stride}.`
			);
		}
	}

	#assertNotIterating(op: string): void {
		if (this.#iterationDepth > 0) {
			throw new Error(`FloatSet.${op} cannot be called during active iteration.`);
		}
	}

	/** Number of active records in this store. */
	get size(): number {
		return this.#size;
	}

	/** Current record capacity before reallocation. */
	get capacity(): number {
		return this.#dense.length / this.stride;
	}

	/** Read-only view of packed entity handles corresponding to dense indices 0..size-1. */
	get entities(): ReadonlyArray<Entity> {
		return this.#entities;
	}

	/**
	 * Returns a borrowed Float32Array view of the active dense storage (length = size * stride).
	 * This view is invalidated on capacity growth.
	 */
	get dense(): Float32Array {
		return this.#dense.subarray(0, this.#size * this.stride);
	}

	/** Returns the dense record index (0..size-1) for the exact entity handle, or -1 if absent. */
	denseIndexOf(entity: Entity): number {
		if (!isValidEntityHandle(entity)) {
			return -1;
		}
		const slot = entityIndex(entity);
		if (slot >= this.#sparse.length) {
			return -1;
		}
		const denseIdx = this.#sparse[slot];
		if (denseIdx >= 0 && denseIdx < this.#size && this.#entities[denseIdx] === entity) {
			return denseIdx;
		}
		return -1;
	}

	/** Returns true if the exact entity handle is present in this store. */
	has(entity: Entity): boolean {
		return this.denseIndexOf(entity) >= 0;
	}

	/**
	 * Reads a single component scalar directly without allocating a subarray view.
	 * Returns undefined if the entity is absent.
	 */
	getDirect(entity: Entity, componentIndex = 0): number | undefined {
		this.#assertValidComponentIndex(componentIndex);
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return undefined;
		}
		return this.#dense[denseIdx * this.stride + componentIndex];
	}

	/**
	 * Writes a single component scalar directly for an existing entity record.
	 * Returns true if updated, or false if the entity is not present.
	 */
	setDirect(entity: Entity, componentIndex: number, value: number): boolean {
		this.#assertValidComponentIndex(componentIndex);
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return false;
		}
		this.#dense[denseIdx * this.stride + componentIndex] = value;
		return true;
	}

	/**
	 * Copies a record's stride components into out starting at outOffset.
	 * Returns true if the entity was found and copied, or false if absent.
	 */
	copyTo(entity: Entity, out: Float32Array | number[], outOffset = 0): boolean {
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return false;
		}
		const base = denseIdx * this.stride;
		for (let i = 0; i < this.stride; i++) {
			out[outOffset + i] = this.#dense[base + i];
		}
		return true;
	}

	/**
	 * Inserts or updates a record from an array-like source.
	 * - On insert, unspecified trailing components (up to stride) are zero-filled.
	 * - On update, only the supplied components (up to stride) are overwritten.
	 * - Throws if the entity's slot is occupied by a different generation.
	 */
	setFromArray(entity: Entity, values: ArrayLike<number>, sourceOffset = 0, count?: number): this {
		this.#assertValidEntity(entity);
		const slot = entityIndex(entity);
		const existingDenseIdx = slot < this.#sparse.length ? this.#sparse[slot] : -1;

		const available = Math.max(0, values.length - sourceOffset);
		const writeCount = Math.min(this.stride, count !== undefined ? Math.min(count, available) : available);

		if (existingDenseIdx >= 0 && existingDenseIdx < this.#size) {
			const occupant = this.#entities[existingDenseIdx];
			if (occupant !== entity) {
				throw new Error(
					`FloatSet.set: slot ${slot} is already occupied by entity ${occupant} (cannot overwrite with generation-mismatched entity ${entity}). Remove the previous entity's component before recycling its slot.`
				);
			}
			const base = existingDenseIdx * this.stride;
			for (let i = 0; i < writeCount; i++) {
				this.#dense[base + i] = values[sourceOffset + i];
			}
			return this;
		}

		this.#assertNotIterating("set");
		this.#ensureSparseCapacity(slot);
		this.#ensureDenseCapacity(this.#size + 1);

		const newIdx = this.#size;
		this.#sparse[slot] = newIdx;
		this.#entities.push(entity);
		this.#size++;

		const base = newIdx * this.stride;
		for (let i = 0; i < writeCount; i++) {
			this.#dense[base + i] = values[sourceOffset + i];
		}
		for (let i = writeCount; i < this.stride; i++) {
			this.#dense[base + i] = 0;
		}
		return this;
	}

	/**
	 * Inserts or updates a record for entity.
	 * - On insert, unspecified trailing components are zero-filled.
	 * - On update, unspecified trailing components are preserved.
	 * - Throws if the entity's slot is occupied by a different generation.
	 */
	set(entity: Entity, ...values: number[]): this {
		return this.setFromArray(entity, values, 0, values.length);
	}

	/**
	 * Returns a borrowed Float32Array subarray of length stride for entity, or undefined if absent.
	 * Warning: this view aliases internal storage and can become stale after growth or structural changes.
	 */
	get(entity: Entity): Float32Array | undefined {
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return undefined;
		}
		const offset = denseIdx * this.stride;
		return this.#dense.subarray(offset, offset + this.stride);
	}

	/** Returns a borrowed Float32Array subarray at dense index i (0 <= i < size). */
	getAtDenseIndex(denseIdx: number): Float32Array | undefined {
		if (denseIdx < 0 || denseIdx >= this.#size) {
			return undefined;
		}
		const offset = denseIdx * this.stride;
		return this.#dense.subarray(offset, offset + this.stride);
	}

	/** Returns the entity handle at dense index i (0 <= i < size). */
	getEntityAtDenseIndex(denseIdx: number): Entity | undefined {
		return this.#entities[denseIdx];
	}

	/**
	 * Removes the record for the exact entity handle using O(1) swap-remove.
	 * Returns true if removed, or false if the exact handle was not present.
	 */
	delete(entity: Entity): boolean {
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return false;
		}
		this.#assertNotIterating("delete");

		const slot = entityIndex(entity);
		const lastIdx = this.#size - 1;

		if (denseIdx !== lastIdx) {
			const lastEntity = this.#entities[lastIdx];
			const dstOffset = denseIdx * this.stride;
			const srcOffset = lastIdx * this.stride;

			for (let i = 0; i < this.stride; i++) {
				this.#dense[dstOffset + i] = this.#dense[srcOffset + i];
			}

			this.#entities[denseIdx] = lastEntity;
			this.#sparse[entityIndex(lastEntity)] = denseIdx;
		}

		this.#entities.pop();
		this.#size--;
		this.#sparse[slot] = -1;
		return true;
	}

	/** Removes all records from this store without deallocating the backing Float32Array. */
	clear(): void {
		this.#assertNotIterating("clear");
		for (let i = 0; i < this.#size; i++) {
			this.#sparse[entityIndex(this.#entities[i])] = -1;
		}
		this.#entities.length = 0;
		this.#size = 0;
	}

	/**
	 * Iterates over all active records by passing the entity handle, backing Float32Array,
	 * and base float offset (denseIndex * stride) without allocating subarray views.
	 */
	forEachRaw(callback: (entity: Entity, buffer: Float32Array, offset: number, denseIndex: number) => void): void {
		this.#iterationDepth++;
		try {
			const len = this.#size;
			const s = this.stride;
			for (let i = 0; i < len; i++) {
				callback(this.#entities[i], this.#dense, i * s, i);
			}
		} finally {
			this.#iterationDepth--;
		}
	}

	/** Enters an external iteration guard (used by Query). */
	_beginIteration(): void {
		this.#iterationDepth++;
	}

	/** Exits an external iteration guard (used by Query). */
	_endIteration(): void {
		if (this.#iterationDepth > 0) {
			this.#iterationDepth--;
		}
	}

	/**
	 * Yields [entity, borrowedSubarray] tuples for each active record.
	 * Note: allocates a subarray view and tuple per step; use forEachRaw in allocation-sensitive loops.
	 */
	*[Symbol.iterator](): IterableIterator<[Entity, Float32Array]> {
		this.#iterationDepth++;
		try {
			const len = this.#size;
			const s = this.stride;
			for (let i = 0; i < len; i++) {
				const offset = i * s;
				yield [this.#entities[i], this.#dense.subarray(offset, offset + s)];
			}
		} finally {
			this.#iterationDepth--;
		}
	}
}
