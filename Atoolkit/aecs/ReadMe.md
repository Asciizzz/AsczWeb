# Aecs

Minimalist, sets-first Entity Component System. Eliminates coordinator god classes, treating components as self-contained sparse-dense sets indexed by entity numbers with generational slot validation.

---

## Architecture Overview

Aecs structures entity data across five core primitives:

1. `Entity`: Unsigned 32-bit generational identifier packing a 20-bit slot index, an 11-bit generation counter, and a 1-bit alive flag (`NULL_ENTITY = 0`).
2. `EntityPool`: Slot allocator managing issuance, generational invalidation, generation exhaustion retirement, and slot reuse.
3. `ComponentSet<T>`: Contiguous sparse-dense storage for JavaScript objects, state tags, and references.
4. `FloatSet`: Contiguous packed `Float32Array` storage for high-frequency numeric vectors and matrices.
5. `Query`: Multi-store sparse-set intersection query engine with smallest-set pivot selection and exclusion filters (`.not(...)`).

---

## 1. Entity Identifier Allocation

`EntityPool` allocates generational numeric IDs and reclaims destroyed IDs via an internal free-list array.

```typescript
import { EntityPool, entityIndex, entityGeneration } from "@asciiz/atoolkit/aecs";

const pool = new EntityPool();

// Allocates incremental entity ID with initial generation 0
const e1 = pool.spawn(); // slot 0, gen 0
const e2 = pool.spawn(); // slot 1, gen 0
void e2;

// Recycles destroyed ID and increments generation counter
pool.destroy(e1);
const e3 = pool.spawn(); // slot 0, gen 1 (stale references to e1 invalidated)

// Inspect entity components
const slot = entityIndex(e3);       // 0
const gen = entityGeneration(e3);   // 1
const alive = pool.isAlive(e3);     // true
const stale = pool.isAlive(e1);     // false
void slot;
void gen;
void alive;
void stale;
```

- `spawn()`: Returns the most recently freed slot from the internal free list if available, or allocates the next fresh slot.
- `destroy(entity)`: Validates that the entity is alive, marks it dead, increments its 11-bit generation counter, and pushes the slot onto the free list (or permanently retires the slot if its generation reaches `ENTITY_GEN_MASK = 0x7FF`).
- `isAlive(entity)`: Verifies that the handle has `ENTITY_ALIVE_BIT` set, the slot index is within bounds, and the slot is alive at the matching generation. `NULL_ENTITY = 0` is never alive.
- `clear()`: Invalidates all active entities by advancing their slot generations, ensuring handles issued before `clear()` do not alias entities spawned after `clear()`.

---

## 2. Object and Tag Storage

`ComponentSet<T>` implements a contiguous sparse-dense set for arbitrary JavaScript objects, references, or state tags.

```typescript
import { EntityPool, ComponentSet } from "@asciiz/atoolkit/aecs";

interface Transform {
	x: number;
	y: number;
}

const pool = new EntityPool();
const e1 = pool.spawn();
const transforms = new ComponentSet<Transform>();

// Mutations
transforms.set(e1, { x: 10, y: 20 });
const hasTransform = transforms.has(e1); // true
const t = transforms.get(e1);           // { x: 10, y: 20 }
void hasTransform;
void t;

// Dense contiguous iteration
for (const [_entity, transform] of transforms) {
	transform.x += 1;
}

transforms.forEach((_entity, transform) => {
	transform.x += 1;
});

// Deletion via swap-and-pop
transforms.delete(e1);
```

- Storage layout:
  - `dense: ReadonlyArray<T>`: Packed array storing component values contiguously with zero holes.
  - `entities: ReadonlyArray<Entity>`: Packed array storing corresponding full `Entity` handles at matching dense indices.
  - `sparse: Int32Array`: Direct lookup array mapping entity slot indices to dense indices.
- `set(entity, value)`: Updates value in place if the exact `Entity` handle already exists in the set, or appends a new entry if the slot is unoccupied. Throws if the slot is occupied by a different generation.
- `delete(entity)`: Verifies full `Entity` handle identity, swaps the tail element into the deleted element's dense slot, pops the tail, updates the swapped element's sparse pointer, and sets the deleted entity's sparse pointer to `-1` in O(1).
- `get(entity)` / `has(entity)` / `denseIndexOf(entity)`: Verifies sparse index bounds and full `Entity` handle identity (`entities[denseIdx] === entity`) in O(1).
- `forEach(callback)`: Iterates over all `(entity, component, denseIndex)` entries without tuple allocations.
- Iteration safety: Structural mutations (`set` of a new entity, `delete`, `clear`) while iterating over the set throw an `Error`.

---

## 3. Packed Numeric Storage

`FloatSet` provides flat `Float32Array` storage for high-frequency numeric components (positions, velocities, colors, matrices).

```typescript
import { EntityPool, FloatSet } from "@asciiz/atoolkit/aecs";

const pool = new EntityPool();
const e1 = pool.spawn();

// Stride of 3 floats: [x, y, z]
const positions = new FloatSet(3, 1024);

// Write coordinates directly (rest parameters or setFromArray)
positions.set(e1, 100.0, 200.0, 300.0);

// Zero-allocation slice retrieval
const pos = positions.get(e1); // Float32Array(3) subarray view
if (pos) {
	pos[0] += 5.0; // In-place coordinate update
}

// Zero-allocation direct element access
const y = positions.getDirect(e1, 1); // Reads y coordinate without subarray allocation
positions.setDirect(e1, 1, 250.0);   // Writes y coordinate directly into buffer
void y;

// Contiguous zero-allocation iteration over backing buffer
positions.forEachRaw((_entity, buffer, offset) => {
	buffer[offset + 1] -= 9.8; // Gravity step
});
```

- Storage layout: Flat `dense: Float32Array` storing interleaved numeric records of length `stride`, paired with `entities: ReadonlyArray<Entity>` and `sparse: Int32Array`.
- `stride`: Fixed number of float elements per entity.
- Buffer expansion: Automatically grows backing `Float32Array` capacity (including from `initialCapacity = 0`) when element count exceeds allocated bounds.
- `set(entity, ...values)` / `setFromArray(entity, values, sourceOffset?, count?)`: Inserts or updates a record. Throws if the slot is occupied by a different generation.
- `get(entity)`: Verifies full `Entity` handle identity and returns a `Float32Array.subarray` view into dense memory in O(1).
- `getDirect(entity, componentIndex)`: Reads a single float at component index without allocating a subarray view.
- `setDirect(entity, componentIndex, value)`: Writes a single float directly into dense memory without allocating an array.
- `copyTo(entity, out, outOffset?)`: Copies entity floats into an external array or `Float32Array` at destination offset.
- `forEachRaw(callback)`: Iterates over all active records by passing `(entity, buffer, offset, denseIndex)` without allocating subarray views.
- `delete(entity)`: Verifies full `Entity` handle identity and copies the tail stride block into the vacated slot in O(1).
- Iteration safety: Structural mutations (`set` of a new entity, `delete`, `clear`) while iterating over the set throw an `Error`.

---

## 4. Multi-Set Query Engine

`Query` evaluates multi-store constraints, automatically selecting the required store with smallest cardinality (`size`) to drive the iteration loop.

```typescript
import { EntityPool, ComponentSet, FloatSet, Query } from "@asciiz/atoolkit/aecs";

const pool = new EntityPool();
const e1 = pool.spawn();
const positions = new FloatSet(2);
const velocities = new FloatSet(2);
const dead = new ComponentSet<boolean>();

positions.set(e1, 0, 0);
velocities.set(e1, 1, 2);

// Construct query over required stores with optional exclusion filters
const query = new Query(positions, velocities).not(dead);

// Zero-view-allocation traversal over matching entity handles
query.forEachEntity((entity) => {
	const px = positions.getDirect(entity, 0)! + velocities.getDirect(entity, 0)!;
	const py = positions.getDirect(entity, 1)! + velocities.getDirect(entity, 1)!;
	positions.setDirect(entity, 0, px);
	positions.setDirect(entity, 1, py);
});

// Tuple iteration yielding [entity, ...components]
for (const [_entity, pos, vel] of query) {
	pos[0] += vel[0];
	pos[1] += vel[1];
}

// Query evaluation properties
const count = query.count;
const first = query.first;
void count;
void first;
```

- `new Query(...stores)`: Requires an entity to be present in every specified store.
- `not(...excluded)`: Excludes entities present in any of the specified excluded stores.
- Pivot selection: Identifies the required store with minimum `size`, iterates its dense entity array, and executes O(1) full-handle checks against companion and excluded stores while locking all participating stores against structural mutation during iteration.
- `forEachEntity(callback)`: Invokes `callback(entity)` for each match with zero view or tuple allocations.
- `each()` / `[Symbol.iterator]()`: Yields `[entity, ...components]` rows for each matching entity.
- `count`: Number of matching entities (computed without constructing component views).
- `first`: First matching `[entity, ...components]` row, or `undefined` if no entity matches.
