/**
 * Bit-packed 32-bit Entity identifier:
 * - Bits 0..19 (20 bits): Slot index (1 to 1,048,575; index 0 is reserved for NULL_ENTITY).
 * - Bits 20..30 (11 bits): Generation counter (1 to 2,047).
 * - Bit 31 (sign bit): Unused (0) so all valid entities are positive 32-bit signed/unsigned integers.
 *
 * Entity handles are local to the EntityPool that issued them.
 */
export type Entity = number;

export const ENTITY_INDEX_BITS = 20;
export const ENTITY_GEN_BITS = 11;

export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1; // 0xFFFFF (1,048,575)
export const ENTITY_GEN_MASK = (1 << ENTITY_GEN_BITS) - 1;     // 0x7FF   (2,047)

/** Null sentinel entity representing no entity. */
export const NULL_ENTITY: Entity = 0;

/** Extracts the 20-bit slot index from an Entity handle. */
export function entityIndex(e: Entity): number {
	return e & ENTITY_INDEX_MASK;
}

/** Extracts the 11-bit generation counter from an Entity handle. */
export function entityGeneration(e: Entity): number {
	return (e >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
}

/** Packs a 20-bit slot index and an 11-bit generation counter into an Entity handle. */
export function packEntity(index: number, generation: number): Entity {
	return ((generation & ENTITY_GEN_MASK) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK);
}

/** Returns true if e is a well-formed non-null Entity integer within bit limits. */
export function isValidEntityHandle(e: Entity): boolean {
	if (!Number.isInteger(e) || e <= 0 || e > 0x7fffffff) {
		return false;
	}
	const idx = e & ENTITY_INDEX_MASK;
	const gen = (e >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
	const highBits = e >>> (ENTITY_INDEX_BITS + ENTITY_GEN_BITS);
	return idx > 0 && gen > 0 && highBits === 0;
}

/**
 * Manages entity handle allocation, destruction, and generational liveness.
 *
 * Contract:
 * - Handles are pool-local; cross-pool handle checks are unsupported.
 * - Liveness is tracked explicitly per slot, independent of the generation counter.
 * - Destroying a live entity increments its slot generation for future reuse.
 * - When a slot reaches ENTITY_GEN_MASK (2,047) destructions, the slot is permanently
 *   retired rather than wrapping its generation counter.
 * - clear() invalidates all currently live entities and advances their generations
 *   without resetting generation history.
 */
export class EntityPool {
	/** Per-slot generation counters (slot 0 is unused). */
	#generations: Uint16Array;
	/** Per-slot liveness flags: 1 = live, 0 = not live. */
	#alive: Uint8Array;
	/** Per-slot retirement flags: 1 = retired (generation exhausted), 0 = active/reusable. */
	#retired: Uint8Array;
	/** Stack of reusable free slot indices. */
	#free: number[] = [];
	/** Next unallocated slot index (starts at 1; 0 is reserved for NULL_ENTITY). */
	#nextIndex = 1;
	/** Number of currently live entities. */
	#aliveCount = 0;
	/** Number of permanently retired slots whose generations reached ENTITY_GEN_MASK. */
	#retiredCount = 0;

	constructor(initialSlotCapacity = 256) {
		if (!Number.isInteger(initialSlotCapacity) || initialSlotCapacity < 0) {
			throw new RangeError("EntityPool initialSlotCapacity must be a non-negative integer.");
		}
		const cap = Math.min(ENTITY_INDEX_MASK + 1, Math.max(16, initialSlotCapacity + 1));
		this.#generations = new Uint16Array(cap);
		this.#alive = new Uint8Array(cap);
		this.#retired = new Uint8Array(cap);
	}

	#ensureSlotCapacity(slotIndex: number): void {
		if (slotIndex < this.#generations.length) {
			return;
		}
		let nextCap = this.#generations.length;
		while (nextCap <= slotIndex) {
			nextCap = Math.min(ENTITY_INDEX_MASK + 1, nextCap * 2);
			if (nextCap <= slotIndex && nextCap === ENTITY_INDEX_MASK + 1) {
				break;
			}
		}
		const nextGen = new Uint16Array(nextCap);
		nextGen.set(this.#generations);
		this.#generations = nextGen;

		const nextAlive = new Uint8Array(nextCap);
		nextAlive.set(this.#alive);
		this.#alive = nextAlive;

		const nextRetired = new Uint8Array(nextCap);
		nextRetired.set(this.#retired);
		this.#retired = nextRetired;
	}

	/**
	 * Allocates a new live Entity handle, reusing a free slot if available.
	 * Throws a RangeError if all 1,048,575 slots are live or retired.
	 */
	spawn(): Entity {
		let index: number;
		let gen: number;

		if (this.#free.length > 0) {
			index = this.#free.pop()!;
			gen = this.#generations[index];
		} else {
			if (this.#nextIndex > ENTITY_INDEX_MASK) {
				throw new RangeError(
					`EntityPool capacity exhausted: maximum slot index ${ENTITY_INDEX_MASK} reached.`
				);
			}
			index = this.#nextIndex++;
			this.#ensureSlotCapacity(index);
			gen = 1;
			this.#generations[index] = gen;
		}

		this.#alive[index] = 1;
		this.#aliveCount++;
		return packEntity(index, gen);
	}

	/**
	 * Destroys a currently live entity handle.
	 * Returns true if the entity was live and is now destroyed; returns false for stale,
	 * forged, or already-destroyed handles without corrupting the free list.
	 */
	destroy(e: Entity): boolean {
		if (!isValidEntityHandle(e)) {
			return false;
		}
		const index = entityIndex(e);
		if (index >= this.#nextIndex || this.#alive[index] !== 1) {
			return false;
		}
		const gen = entityGeneration(e);
		if (this.#generations[index] !== gen) {
			return false;
		}

		this.#alive[index] = 0;
		this.#aliveCount--;

		if (gen < ENTITY_GEN_MASK) {
			this.#generations[index] = gen + 1;
			this.#free.push(index);
		} else {
			this.#retired[index] = 1;
			this.#retiredCount++;
		}
		return true;
	}

	/**
	 * Returns true only if the entity handle refers to a currently live slot with a matching generation.
	 */
	isAlive(e: Entity): boolean {
		if (!isValidEntityHandle(e)) {
			return false;
		}
		const index = entityIndex(e);
		if (index >= this.#nextIndex || this.#alive[index] !== 1) {
			return false;
		}
		return this.#generations[index] === entityGeneration(e);
	}

	/** Number of currently live entities in this pool. */
	get aliveCount(): number {
		return this.#aliveCount;
	}

	/** Number of slots ever allocated by this pool (live + free + retired). */
	get totalAllocated(): number {
		return this.#nextIndex - 1;
	}

	/** Number of reusable slots currently in the free list. */
	get freeCount(): number {
		return this.#free.length;
	}

	/** Number of permanently retired slots that have exhausted all generations. */
	get retiredCount(): number {
		return this.#retiredCount;
	}

	/**
	 * Invalidates all currently live entities while preserving generation history.
	 * Any handle issued before clear() remains permanently invalid.
	 */
	clear(): void {
		for (let index = 1; index < this.#nextIndex; index++) {
			if (this.#alive[index] === 1) {
				this.#alive[index] = 0;
				const gen = this.#generations[index];
				if (gen < ENTITY_GEN_MASK) {
					this.#generations[index] = gen + 1;
					this.#free.push(index);
				} else {
					this.#retired[index] = 1;
					this.#retiredCount++;
				}
			}
		}
		this.#aliveCount = 0;
	}
}
