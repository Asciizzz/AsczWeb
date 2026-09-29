import type { Entity } from "./Entity.js";

/**
 * Structural interface satisfied by ComponentSet and FloatSet.
 */
export interface EntitySetLike {
    readonly size: number;
    readonly entities: readonly Entity[];
    has(entity: Entity): boolean;
}

/**
 * Component accessor interface supporting generic component retrieval.
 */
export interface ComponentSource<T> extends EntitySetLike {
    get(entity: Entity): T | undefined;
}

/**
 * Multi-set entity query engine with driver set optimization.
 */
export class Query implements Iterable<Entity> {
    protected readonly _all: EntitySetLike[] = [];
    protected readonly _none: EntitySetLike[] = [];
    protected readonly _any: EntitySetLike[] = [];

    constructor(
        all: EntitySetLike[] = [],
        none: EntitySetLike[] = [],
        any: EntitySetLike[] = []
    ) {
        if (all.length > 0) {
            for (let i = 0; i < all.length; i++) this._all.push(all[i]);
        }
        if (none.length > 0) {
            for (let i = 0; i < none.length; i++) this._none.push(none[i]);
        }
        if (any.length > 0) {
            for (let i = 0; i < any.length; i++) this._any.push(any[i]);
        }
    }

    /**
     * Adds required component sets.
     */
    all(...sets: EntitySetLike[]): this {
        for (let i = 0; i < sets.length; i++) this._all.push(sets[i]);
        return this;
    }

    /**
     * Adds excluded component sets.
     */
    none(...sets: EntitySetLike[]): this {
        for (let i = 0; i < sets.length; i++) this._none.push(sets[i]);
        return this;
    }

    /**
     * Adds optional component sets (at least one must match).
     */
    any(...sets: EntitySetLike[]): this {
        for (let i = 0; i < sets.length; i++) this._any.push(sets[i]);
        return this;
    }

    /**
     * Evaluates whether an entity satisfies all query constraints.
     */
    matches(entity: Entity): boolean {
        for (let i = 0; i < this._all.length; i++) {
            if (!this._all[i].has(entity)) return false;
        }
        for (let i = 0; i < this._none.length; i++) {
            if (this._none[i].has(entity)) return false;
        }
        if (this._any.length > 0) {
            let matchedAny = false;
            for (let i = 0; i < this._any.length; i++) {
                if (this._any[i].has(entity)) {
                    matchedAny = true;
                    break;
                }
            }
            if (!matchedAny) return false;
        }
        return true;
    }

    /**
     * Determines driver set with minimum size.
     */
    private _findDriver(): EntitySetLike | undefined {
        if (this._all.length === 0) return undefined;
        let driver = this._all[0];
        for (let i = 1; i < this._all.length; i++) {
            if (this._all[i].size < driver.size) {
                driver = this._all[i];
            }
        }
        return driver;
    }

    /**
     * Executes callback for each entity satisfying query constraints.
     */
    each(fn: (entity: Entity) => void): void {
        if (this._all.length > 0) {
            const driver = this._findDriver()!;
            if (driver.size === 0) return;

            const ents = driver.entities;
            const len = driver.size;
            const allSets = this._all;
            const allCount = allSets.length;
            const noneSets = this._none;
            const noneCount = noneSets.length;
            const anySets = this._any;
            const anyCount = anySets.length;

            entityLoop:
            for (let i = 0; i < len; i++) {
                const entity = ents[i];

                for (let j = 0; j < allCount; j++) {
                    const set = allSets[j];
                    if (set === driver) continue;
                    if (!set.has(entity)) continue entityLoop;
                }
                for (let j = 0; j < noneCount; j++) {
                    if (noneSets[j].has(entity)) continue entityLoop;
                }
                if (anyCount > 0) {
                    let matchedAny = false;
                    for (let j = 0; j < anyCount; j++) {
                        if (anySets[j].has(entity)) {
                            matchedAny = true;
                            break;
                        }
                    }
                    if (!matchedAny) continue entityLoop;
                }

                fn(entity);
            }
            return;
        }

        if (this._any.length > 0) {
            const anySets = this._any;
            const anyCount = anySets.length;
            const noneSets = this._none;
            const noneCount = noneSets.length;

            for (let k = 0; k < anyCount; k++) {
                const source = anySets[k];
                const len = source.size;
                const ents = source.entities;

                entityLoopAny:
                for (let i = 0; i < len; i++) {
                    const entity = ents[i];

                    // Deduplicate against sets already processed
                    for (let prev = 0; prev < k; prev++) {
                        if (anySets[prev].has(entity)) continue entityLoopAny;
                    }
                    for (let j = 0; j < noneCount; j++) {
                        if (noneSets[j].has(entity)) continue entityLoopAny;
                    }

                    fn(entity);
                }
            }
        }
    }

    /**
     * Collects all matching entities into an array.
     */
    entities(): Entity[] {
        const result: Entity[] = [];
        this.each(e => result.push(e));
        return result;
    }

    /**
     * Returns first matching entity, or undefined if no entity matches.
     */
    first(): Entity | undefined {
        let found: Entity | undefined;
        this.each(e => {
            if (found === undefined) found = e;
        });
        return found;
    }

    /**
     * Counts number of entities matching query constraints.
     */
    count(): number {
        let total = 0;
        this.each(() => total++);
        return total;
    }

    /**
     * Iterator yielding matching entities.
     */
    *[Symbol.iterator](): IterableIterator<Entity> {
        const list = this.entities();
        for (let i = 0; i < list.length; i++) {
            yield list[i];
        }
    }
}

/**
 * Fluent builder for constructing and executing multi-set queries.
 */
export class QueryBuilder extends Query {
    build(): Query {
        return this;
    }
}

/**
 * Creates a fluent QueryBuilder.
 */
export function createQuery(): QueryBuilder {
    return new QueryBuilder();
}

/**
 * Fast two-way join driven from smaller set.
 * Supports ComponentSet and FloatSet.
 */
export function query2<A, B>(
    setA: ComponentSource<A>,
    setB: ComponentSource<B>,
    fn: (entity: Entity, a: A, b: B) => void
): void {
    if (setA.size === 0 || setB.size === 0) return;

    if (setA.size <= setB.size) {
        const len = setA.size;
        const ents = setA.entities;
        const denseA = "dense" in setA && Array.isArray((setA as any).dense) ? (setA as any).dense as A[] : undefined;

        for (let i = 0; i < len; i++) {
            const entity = ents[i];
            const b = setB.get(entity);
            if (b !== undefined) {
                const a = denseA ? denseA[i] : setA.get(entity);
                if (a !== undefined) fn(entity, a, b);
            }
        }
    } else {
        const len = setB.size;
        const ents = setB.entities;
        const denseB = "dense" in setB && Array.isArray((setB as any).dense) ? (setB as any).dense as B[] : undefined;

        for (let i = 0; i < len; i++) {
            const entity = ents[i];
            const a = setA.get(entity);
            if (a !== undefined) {
                const b = denseB ? denseB[i] : setB.get(entity);
                if (b !== undefined) fn(entity, a, b);
            }
        }
    }
}

/**
 * Fast three-way join driven from smallest set.
 * Supports ComponentSet and FloatSet.
 */
export function query3<A, B, C>(
    setA: ComponentSource<A>,
    setB: ComponentSource<B>,
    setC: ComponentSource<C>,
    fn: (entity: Entity, a: A, b: B, c: C) => void
): void {
    if (setA.size === 0 || setB.size === 0 || setC.size === 0) return;

    if (setA.size <= setB.size && setA.size <= setC.size) {
        const len = setA.size;
        const ents = setA.entities;
        const denseA = "dense" in setA && Array.isArray((setA as any).dense) ? (setA as any).dense as A[] : undefined;

        for (let i = 0; i < len; i++) {
            const entity = ents[i];
            const b = setB.get(entity);
            if (b === undefined) continue;
            const c = setC.get(entity);
            if (c === undefined) continue;
            const a = denseA ? denseA[i] : setA.get(entity);
            if (a !== undefined) fn(entity, a, b, c);
        }
    } else if (setB.size <= setA.size && setB.size <= setC.size) {
        const len = setB.size;
        const ents = setB.entities;
        const denseB = "dense" in setB && Array.isArray((setB as any).dense) ? (setB as any).dense as B[] : undefined;

        for (let i = 0; i < len; i++) {
            const entity = ents[i];
            const a = setA.get(entity);
            if (a === undefined) continue;
            const c = setC.get(entity);
            if (c === undefined) continue;
            const b = denseB ? denseB[i] : setB.get(entity);
            if (b !== undefined) fn(entity, a, b, c);
        }
    } else {
        const len = setC.size;
        const ents = setC.entities;
        const denseC = "dense" in setC && Array.isArray((setC as any).dense) ? (setC as any).dense as C[] : undefined;

        for (let i = 0; i < len; i++) {
            const entity = ents[i];
            const a = setA.get(entity);
            if (a === undefined) continue;
            const b = setB.get(entity);
            if (b === undefined) continue;
            const c = denseC ? denseC[i] : setC.get(entity);
            if (c !== undefined) fn(entity, a, b, c);
        }
    }
}
