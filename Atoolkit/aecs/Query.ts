import type { Entity } from "./Entity.js";
import type { ComponentSet } from "./ComponentSet.js";
import type { FloatSet } from "./FloatSet.js";

/** Any component store supported by Query. */
export type AnyStore = ComponentSet<any> | FloatSet;

/** Extracts the value type yielded by a store S. */
export type StoreValue<S> =
	S extends ComponentSet<infer T> ? T :
	S extends FloatSet ? Float32Array :
	never;

/** Maps a tuple of stores to the tuple of [Entity, ...StoreValues] yielded by Query. */
export type QueryRow<Stores extends readonly AnyStore[]> = [
	Entity,
	...{ [K in keyof Stores]: StoreValue<Stores[K]> }
];

/**
 * Multi-store sparse-set intersection query with optional exclusion filters.
 *
 * Scans the smallest required store as the pivot and probes all other required
 * and excluded stores in O(1) per candidate entity.
 *
 * Structural mutation of participating stores during active query traversal throws an Error.
 */
export class Query<const Stores extends readonly AnyStore[]> {
	readonly #stores: Stores;
	readonly #excluded: AnyStore[] = [];

	constructor(...stores: Stores) {
		this.#stores = stores;
	}

	/** Excludes entities that are present in any of the given stores. */
	not(...excluded: AnyStore[]): this {
		this.#excluded.push(...excluded);
		return this;
	}

	#lockStores(): void {
		for (let i = 0; i < this.#stores.length; i++) {
			this.#stores[i]._beginIteration();
		}
		for (let i = 0; i < this.#excluded.length; i++) {
			this.#excluded[i]._beginIteration();
		}
	}

	#unlockStores(): void {
		for (let i = 0; i < this.#stores.length; i++) {
			this.#stores[i]._endIteration();
		}
		for (let i = 0; i < this.#excluded.length; i++) {
			this.#excluded[i]._endIteration();
		}
	}

	#findPivotIndex(): number {
		const stores = this.#stores;
		if (stores.length === 0) return -1;
		let minIdx = 0;
		let minSize = stores[0].size;
		for (let i = 1; i < stores.length; i++) {
			const sz = stores[i].size;
			if (sz < minSize) {
				minSize = sz;
				minIdx = i;
			}
		}
		return minSize === 0 ? -1 : minIdx;
	}

	#matchesAt(entity: Entity, pivotIdx: number): boolean {
		const stores = this.#stores;
		const excluded = this.#excluded;

		for (let j = 0; j < stores.length; j++) {
			if (j !== pivotIdx && !stores[j].has(entity)) {
				return false;
			}
		}
		for (let k = 0; k < excluded.length; k++) {
			if (excluded[k].has(entity)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Zero-view-allocation traversal that invokes callback with each matching Entity handle.
	 * Callers can read components via store.getDirect(entity, ...) or denseIndexOf(entity).
	 */
	forEachEntity(callback: (entity: Entity) => void): void {
		const pivotIdx = this.#findPivotIndex();
		if (pivotIdx < 0) return;

		const pivot = this.#stores[pivotIdx];
		const pivotEntities = pivot.entities;
		const pivotLen = pivot.size;

		this.#lockStores();
		try {
			for (let i = 0; i < pivotLen; i++) {
				const entity = pivotEntities[i];
				if (this.#matchesAt(entity, pivotIdx)) {
					callback(entity);
				}
			}
		} finally {
			this.#unlockStores();
		}
	}

	/**
	 * Yields [entity, ...components] for each entity matching all required stores and no excluded stores.
	 * Note: allocates a row array (and FloatSet subarray views if FloatSet stores are queried) per match.
	 */
	*each(): IterableIterator<QueryRow<Stores>> {
		const pivotIdx = this.#findPivotIndex();
		if (pivotIdx < 0) return;

		const stores = this.#stores;
		const numStores = stores.length;
		const pivot = stores[pivotIdx];
		const pivotEntities = pivot.entities;
		const pivotLen = pivot.size;

		this.#lockStores();
		try {
			for (let i = 0; i < pivotLen; i++) {
				const entity = pivotEntities[i];
				if (!this.#matchesAt(entity, pivotIdx)) {
					continue;
				}
				const row = new Array(numStores + 1);
				row[0] = entity;
				for (let j = 0; j < numStores; j++) {
					row[j + 1] = j === pivotIdx
						? stores[j].getAtDenseIndex(i)
						: stores[j].get(entity);
				}
				yield row as unknown as QueryRow<Stores>;
			}
		} finally {
			this.#unlockStores();
		}
	}

	/** Making Query directly iterable in for..of loops. */
	[Symbol.iterator](): IterableIterator<QueryRow<Stores>> {
		return this.each();
	}

	/** Returns the number of matching entities without constructing component views. */
	get count(): number {
		const pivotIdx = this.#findPivotIndex();
		if (pivotIdx < 0) return 0;

		const pivot = this.#stores[pivotIdx];
		const pivotEntities = pivot.entities;
		const pivotLen = pivot.size;

		let n = 0;
		for (let i = 0; i < pivotLen; i++) {
			if (this.#matchesAt(pivotEntities[i], pivotIdx)) {
				n++;
			}
		}
		return n;
	}

	/**
	 * Returns the first matching [entity, ...components] row, or undefined if no entity matches.
	 * Stops scanning immediately upon finding the first match.
	 */
	get first(): QueryRow<Stores> | undefined {
		const pivotIdx = this.#findPivotIndex();
		if (pivotIdx < 0) return undefined;

		const stores = this.#stores;
		const numStores = stores.length;
		const pivot = stores[pivotIdx];
		const pivotEntities = pivot.entities;
		const pivotLen = pivot.size;

		for (let i = 0; i < pivotLen; i++) {
			const entity = pivotEntities[i];
			if (!this.#matchesAt(entity, pivotIdx)) {
				continue;
			}
			const row = new Array(numStores + 1);
			row[0] = entity;
			for (let j = 0; j < numStores; j++) {
				row[j + 1] = j === pivotIdx
					? stores[j].getAtDenseIndex(i)
					: stores[j].get(entity);
			}
			return row as unknown as QueryRow<Stores>;
		}
		return undefined;
	}
}
