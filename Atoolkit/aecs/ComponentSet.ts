import { type Entity, entityIndex } from "./Entity.js";

/**
 * Contiguous component set indexed by Entity.
 */
export class ComponentSet<T> implements Iterable<[Entity, T]> {
    readonly dense: T[] = [];
    readonly entities: Entity[] = [];
    readonly sparse: number[] = [];

    get size(): number {
        return this.dense.length;
    }

    has(entity: Entity): boolean {
        const slot = entityIndex(entity);
        const denseIdx = this.sparse[slot];
        return denseIdx !== undefined && denseIdx >= 0 && denseIdx < this.dense.length && this.entities[denseIdx] === entity;
    }

    get(entity: Entity): T | undefined {
        const slot = entityIndex(entity);
        const denseIdx = this.sparse[slot];
        if (denseIdx !== undefined && denseIdx >= 0 && denseIdx < this.dense.length && this.entities[denseIdx] === entity) {
            return this.dense[denseIdx];
        }
        return undefined;
    }

    set(entity: Entity, value: T): this {
        const slot = entityIndex(entity);
        const denseIdx = this.sparse[slot];
        if (denseIdx !== undefined && denseIdx >= 0 && denseIdx < this.dense.length && this.entities[denseIdx] === entity) {
            this.dense[denseIdx] = value;
            return this;
        }

        const newIdx = this.dense.length;
        this.dense.push(value);
        this.entities.push(entity);
        this.sparse[slot] = newIdx;
        return this;
    }

    /**
     * Returns existing component if present, or sets and returns defaultValue.
     */
    getOrAdd(entity: Entity, valueOrFactory: T | (() => T)): T {
        const existing = this.get(entity);
        if (existing !== undefined) return existing;
        const val = typeof valueOrFactory === "function" ? (valueOrFactory as () => T)() : valueOrFactory;
        this.set(entity, val);
        return val;
    }

    delete(entity: Entity): boolean {
        const slot = entityIndex(entity);
        const denseIdx = this.sparse[slot];
        if (denseIdx === undefined || denseIdx < 0 || denseIdx >= this.dense.length || this.entities[denseIdx] !== entity) {
            return false;
        }

        const lastIdx = this.dense.length - 1;
        if (denseIdx < lastIdx) {
            const lastEntity = this.entities[lastIdx];
            const lastVal = this.dense[lastIdx];
            this.dense[denseIdx] = lastVal;
            this.entities[denseIdx] = lastEntity;
            this.sparse[entityIndex(lastEntity)] = denseIdx;
        }

        this.dense.pop();
        this.entities.pop();
        this.sparse[slot] = -1;
        return true;
    }

    /**
     * Swaps component values between two entities.
     */
    swap(entityA: Entity, entityB: Entity): boolean {
        const slotA = entityIndex(entityA);
        const slotB = entityIndex(entityB);
        const idxA = this.sparse[slotA];
        const idxB = this.sparse[slotB];

        if (idxA === undefined || idxA < 0 || idxA >= this.dense.length || this.entities[idxA] !== entityA) return false;
        if (idxB === undefined || idxB < 0 || idxB >= this.dense.length || this.entities[idxB] !== entityB) return false;

        const tmp = this.dense[idxA];
        this.dense[idxA] = this.dense[idxB];
        this.dense[idxB] = tmp;
        return true;
    }

    clear(): void {
        this.dense.length = 0;
        this.entities.length = 0;
        this.sparse.length = 0;
    }

    *[Symbol.iterator](): Iterator<[Entity, T]> {
        const len = this.dense.length;
        for (let i = 0; i < len; i++) {
            yield [this.entities[i], this.dense[i]];
        }
    }

    *entries(): IterableIterator<[Entity, T]> {
        const len = this.dense.length;
        for (let i = 0; i < len; i++) {
            yield [this.entities[i], this.dense[i]];
        }
    }

    *keys(): IterableIterator<Entity> {
        const len = this.dense.length;
        for (let i = 0; i < len; i++) {
            yield this.entities[i];
        }
    }

    *values(): IterableIterator<T> {
        const len = this.dense.length;
        for (let i = 0; i < len; i++) {
            yield this.dense[i];
        }
    }

    each(fn: (entity: Entity, value: T) => void): void {
        const len = this.dense.length;
        for (let i = 0; i < len; i++) {
            fn(this.entities[i], this.dense[i]);
        }
    }
}
