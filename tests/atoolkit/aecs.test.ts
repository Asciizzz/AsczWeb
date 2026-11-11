import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ENTITY_GEN_MASK,
	NULL_ENTITY,
	EntityPool,
	ComponentSet,
	FloatSet,
	Query,
	entityGeneration,
	entityIndex,
	packEntity
} from "../../Atoolkit/aecs/index.ts";

describe("aecs - EntityPool liveness, clear invalidation, and generation exhaustion", () => {
	it("never reports slot 0 or unallocated handles as alive prior to creation", () => {
		const pool = new EntityPool();
		assert.equal(pool.isAlive(NULL_ENTITY), false);
		assert.equal(pool.isAlive(packEntity(0, 0)), false);
		assert.equal(pool.isAlive(packEntity(1, 0)), false);
		assert.equal(pool.isAlive(packEntity(1, 1)), false);
		assert.equal(pool.isAlive(packEntity(999, 1)), false);

		const e1 = pool.spawn();
		assert.equal(pool.isAlive(e1), true);
		assert.equal(pool.destroy(e1), true);
		assert.equal(pool.isAlive(e1), false);
		assert.equal(pool.destroy(e1), false);
	});

	it("invalidates all handles across clear() and does not resurrect stale handles on post-clear spawn()", () => {
		const pool = new EntityPool();
		const a = pool.spawn();
		const b = pool.spawn();
		assert.equal(pool.isAlive(a), true);
		assert.equal(pool.isAlive(b), true);

		pool.clear();
		assert.equal(pool.aliveCount, 0);
		assert.equal(pool.isAlive(a), false);
		assert.equal(pool.isAlive(b), false);

		const c = pool.spawn();
		const d = pool.spawn();
		assert.notEqual(c, a);
		assert.notEqual(c, b);
		assert.notEqual(d, a);
		assert.notEqual(d, b);
		assert.equal(pool.isAlive(a), false);
		assert.equal(pool.isAlive(b), false);
		assert.equal(pool.isAlive(c), true);
		assert.equal(pool.isAlive(d), true);
	});

	it("permanently retires a slot when its 11-bit generation counter reaches ENTITY_GEN_MASK", () => {
		const pool = new EntityPool();
		let current = pool.spawn();
		const firstIndex = entityIndex(current);

		for (let step = 1; step < ENTITY_GEN_MASK; step++) {
			assert.equal(entityIndex(current), firstIndex);
			assert.equal(entityGeneration(current), step);
			assert.equal(pool.destroy(current), true);
			current = pool.spawn();
		}

		// Now at generation ENTITY_GEN_MASK (2047)
		assert.equal(entityIndex(current), firstIndex);
		assert.equal(entityGeneration(current), ENTITY_GEN_MASK);

		// Destroying at max generation retires the slot permanently instead of wrapping
		assert.equal(pool.destroy(current), true);
		assert.equal(pool.isAlive(current), false);
		assert.equal(pool.retiredCount, 1);

		const next = pool.spawn();
		assert.notEqual(entityIndex(next), firstIndex);
		assert.equal(entityGeneration(next), 1);
	});
});

describe("aecs - ComponentSet, FloatSet, and Query invariants", () => {
	it("rejects stale-generation collisions at an occupied slot without overwriting existing data", () => {
		const pool = new EntityPool();
		const store = new ComponentSet<string>();
		const floats = new FloatSet(3, 2);

		const eOld = pool.spawn();
		store.set(eOld, "original");
		floats.set(eOld, 1, 2, 3);

		// Recycle the entity in the pool without removing from stores yet
		pool.destroy(eOld);
		const eNew = pool.spawn();
		assert.equal(entityIndex(eNew), entityIndex(eOld));
		assert.notEqual(eNew, eOld);

		// Setting eNew while eOld still occupies the slot must throw and preserve eOld's data
		assert.throws(() => store.set(eNew, "overwrite"), /occupied/i);
		assert.equal(store.get(eOld), "original");
		assert.equal(store.get(eNew), undefined);

		assert.throws(() => floats.set(eNew, 9, 9, 9), /occupied/i);
		assert.deepEqual(Array.from(floats.get(eOld)!), [1, 2, 3]);
		assert.equal(floats.get(eNew), undefined);

		// Deleting with stale/mismatched handle is a no-op
		assert.equal(store.delete(eNew), false);
		assert.equal(floats.delete(eNew), false);

		// Deleting the actual occupant frees the slot for the new generation
		assert.equal(store.delete(eOld), true);
		assert.equal(floats.delete(eOld), true);
		store.set(eNew, "new-value");
		floats.set(eNew, 4, 5, 6);
		assert.equal(store.get(eNew), "new-value");
		assert.deepEqual(Array.from(floats.get(eNew)!), [4, 5, 6]);
	});

	it("grows FloatSet from initialCapacity = 0 and handles partial component writes accurately", () => {
		assert.throws(() => new FloatSet(0), RangeError);
		assert.throws(() => new FloatSet(-2), RangeError);
		assert.throws(() => new FloatSet(3, -1), RangeError);

		const pool = new EntityPool();
		const fs = new FloatSet(3, 0);
		const e1 = pool.spawn();
		const e2 = pool.spawn();

		// New insert with fewer than stride values zero-fills trailing components
		fs.set(e1, 10);
		assert.deepEqual(Array.from(fs.get(e1)!), [10, 0, 0]);

		// Partial update on existing entity preserves trailing components
		fs.set(e1, 20, 30);
		assert.deepEqual(Array.from(fs.get(e1)!), [20, 30, 0]);
		fs.setDirect(e1, 2, 40);
		assert.equal(fs.getDirect(e1, 2), 40);

		fs.set(e2, 7, 8, 9);
		const out = new Float32Array(3);
		assert.equal(fs.copyTo(e2, out), true);
		assert.deepEqual(Array.from(out), [7, 8, 9]);
	});

	it("guards against structural mutations during ComponentSet, FloatSet, and Query iteration", () => {
		const pool = new EntityPool();
		const names = new ComponentSet<string>();
		const pos = new FloatSet(2, 4);

		const e1 = pool.spawn();
		const e2 = pool.spawn();
		const e3 = pool.spawn();

		names.set(e1, "a");
		names.set(e2, "b");
		pos.set(e1, 1, 2);
		pos.set(e2, 3, 4);

		assert.throws(() => {
			names.forEach((entity) => {
				names.delete(entity);
			});
		}, /iteration/i);

		assert.throws(() => {
			for (const [entity] of names) {
				names.delete(entity);
			}
		}, /iteration/i);

		assert.throws(() => {
			pos.forEachRaw((entity) => {
				pos.delete(entity);
			});
		}, /iteration/i);

		const q = new Query(names, pos);
		assert.equal(q.count, 2);

		assert.throws(() => {
			q.forEachEntity(() => {
				names.set(e3, "c");
			});
		}, /iteration/i);

		// Updating an existing entity's value in-place during iteration is non-structural and allowed
		names.forEach((entity, val) => {
			names.set(entity, val.toUpperCase());
		});
		assert.equal(names.get(e1), "A");
		assert.equal(names.get(e2), "B");
	});
});
