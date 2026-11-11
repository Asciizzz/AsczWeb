import { type Entity, entityIndex, isValidEntityHandle } from "./Entity.js";

/**
 * Sparse-set component store mapping Entity handles to values of type T.
 *
 * Contract:
 * - At most one generation may occupy a given entity slot index at a time.
 * - Calling set() with a handle whose slot index is already occupied by a different
 *   generation throws an Error and leaves the store unchanged. Callers must delete
 *   an entity's component before recycling its slot, or clear the store on reset.
 * - Structural mutations (set of a new entity, delete, clear) during active iteration
 *   throw an Error to prevent skipped or duplicated elements on swap-remove.
 */
export class ComponentSet<T> {
	#sparse: Int32Array = new Int32Array(256).fill(-1);
	#dense: T[] = [];
	#entities: Entity[] = [];
	#iterationDepth = 0;

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

	#assertValidEntity(entity: Entity): void {
		if (!isValidEntityHandle(entity)) {
			throw new RangeError(`Invalid entity handle: ${entity}`);
		}
	}

	#assertNotIterating(op: string): void {
		if (this.#iterationDepth > 0) {
			throw new Error(`ComponentSet.${op} cannot be called during active iteration.`);
		}
	}

	/** Number of stored component records. */
	get size(): number {
		return this.#dense.length;
	}

	/** Read-only view of packed entity handles corresponding to dense indices 0..size-1. */
	get entities(): ReadonlyArray<Entity> {
		return this.#entities;
	}

	/** Read-only view of packed component values corresponding to dense indices 0..size-1. */
	get dense(): ReadonlyArray<T> {
		return this.#dense;
	}

	/** Returns the dense index (0..size-1) for the exact entity handle, or -1 if absent. */
	denseIndexOf(entity: Entity): number {
		if (!isValidEntityHandle(entity)) {
			return -1;
		}
		const slot = entityIndex(entity);
		if (slot >= this.#sparse.length) {
			return -1;
		}
		const denseIdx = this.#sparse[slot];
		if (denseIdx >= 0 && denseIdx < this.#dense.length && this.#entities[denseIdx] === entity) {
			return denseIdx;
		}
		return -1;
	}

	/**
	 * Assigns or updates the component value for entity.
	 * Throws if the slot is currently occupied by a different generation.
	 */
	set(entity: Entity, value: T): this {
		this.#assertValidEntity(entity);
		const slot = entityIndex(entity);
		const existingDenseIdx = slot < this.#sparse.length ? this.#sparse[slot] : -1;

		if (existingDenseIdx >= 0 && existingDenseIdx < this.#dense.length) {
			const occupant = this.#entities[existingDenseIdx];
			if (occupant !== entity) {
				throw new Error(
					`ComponentSet.set: slot ${slot} is already occupied by entity ${occupant} (cannot overwrite with generation-mismatched entity ${entity}). Remove the previous entity's component before recycling its slot.`
				);
			}
			this.#dense[existingDenseIdx] = value;
			return this;
		}

		this.#assertNotIterating("set");
		this.#ensureSparseCapacity(slot);
		const newIdx = this.#dense.length;
		this.#sparse[slot] = newIdx;
		this.#dense.push(value);
		this.#entities.push(entity);
		return this;
	}

	/** Returns the component value for the exact entity handle, or undefined if absent. */
	get(entity: Entity): T | undefined {
		const denseIdx = this.denseIndexOf(entity);
		return denseIdx >= 0 ? this.#dense[denseIdx] : undefined;
	}

	/** Returns true if the exact entity handle has a component in this store. */
	has(entity: Entity): boolean {
		return this.denseIndexOf(entity) >= 0;
	}

	/** Returns the dense value at dense index i (0 <= i < size). */
	getAtDenseIndex(denseIdx: number): T | undefined {
		return this.#dense[denseIdx];
	}

	/** Returns the entity handle at dense index i (0 <= i < size). */
	getEntityAtDenseIndex(denseIdx: number): Entity | undefined {
		return this.#entities[denseIdx];
	}

	/**
	 * Removes the component for the exact entity handle using O(1) swap-remove.
	 * Returns true if removed, or false if the exact handle was not present.
	 */
	delete(entity: Entity): boolean {
		const denseIdx = this.denseIndexOf(entity);
		if (denseIdx < 0) {
			return false;
		}
		this.#assertNotIterating("delete");

		const slot = entityIndex(entity);
		const lastIdx = this.#dense.length - 1;

		if (denseIdx !== lastIdx) {
			const lastEntity = this.#entities[lastIdx];
			const lastValue = this.#dense[lastIdx];
			this.#dense[denseIdx] = lastValue;
			this.#entities[denseIdx] = lastEntity;
			this.#sparse[entityIndex(lastEntity)] = denseIdx;
		}

		this.#dense.pop();
		this.#entities.pop();
		this.#sparse[slot] = -1;
		return true;
	}

	/** Removes all components from this store. */
	clear(): void {
		this.#assertNotIterating("clear");
		for (let i = 0; i < this.#entities.length; i++) {
			this.#sparse[entityIndex(this.#entities[i])] = -1;
		}
		this.#dense.length = 0;
		this.#entities.length = 0;
	}

	/**
	 * Iterates over all (entity, component) pairs without tuple allocations.
	 * Structural mutations during iteration are rejected.
	 */
	forEach(callback: (entity: Entity, component: T, denseIndex: number) => void): void {
		this.#iterationDepth++;
		try {
			const len = this.#dense.length;
			for (let i = 0; i < len; i++) {
				callback(this.#entities[i], this.#dense[i], i);
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
	 * Yields [entity, component] tuples for each stored component.
	 * Note: generator iteration allocates a 2-element tuple per step; use forEach for non-allocating traversal.
	 */
	*[Symbol.iterator](): IterableIterator<[Entity, T]> {
		this.#iterationDepth++;
		try {
			const len = this.#dense.length;
			for (let i = 0; i < len; i++) {
				yield [this.#entities[i], this.#dense[i]];
			}
		} finally {
			this.#iterationDepth--;
		}
	}
}
