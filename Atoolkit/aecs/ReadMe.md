# Aecs

Minimalist, sets-first Entity Component System. Eliminates coordinator god classes, treating components as self-contained sparse-dense sets indexed by entity numbers with generational slot validation.

---

## Architecture Overview

Aecs structures entity data across six core primitives:

1. `Entity`: Numeric generational identifier packing 20-bit slot index and 12-bit generation counter.
2. `EntityPool`: Slot allocator managing issuance, generational invalidation, and slot reuse.
3. `ComponentSet<T>`: Contiguous sparse-dense storage for JavaScript objects, state tags, and references.
4. `FloatSet`: Contiguous packed `Float32Array` storage for high-frequency numeric vectors and matrices.
5. `Query` & `QueryBuilder`: Multi-set query engine with driver set cardinality optimization, supporting `all`, `none`, and `any` filters.
6. `query2` & `query3`: Cardinality-driven fast joins for two and three component sets.

---

## 1. Entity Identifier Allocation

`EntityPool` allocates generational numeric IDs and reclaims destroyed IDs via an internal free-list array.

```typescript
import { EntityPool, entityIndex, entityGeneration } from "./Entity.js";

const pool = new EntityPool();

// Allocates incremental entity ID with initial generation 0
const e1 = pool.spawn(); // slot 1, gen 0
const e2 = pool.spawn(); // slot 2, gen 0

// Recycles destroyed ID and increments generation counter
pool.destroy(e1);
const e3 = pool.spawn(); // slot 1, gen 1 (stale references to e1 invalidated)

// Inspect entity components
const slot = entityIndex(e3);       // 1
const gen = entityGeneration(e3);   // 1
const alive = pool.isAlive(e3);     // true
const stale = pool.isAlive(e1);     // false
```

- `spawn()`: Returns the most recently freed slot from the internal free list if available, bumping its generation counter; increments slot index otherwise.
- `destroy(entity)`: Validates that the entity is alive, marks it dead, and pushes the slot index onto the free list.
- `isAlive(entity)`: Verifies that the slot index is valid and matches the current slot generation.
- `clear()`: Resets slot index to 1, empties free list, and resets generation counters.

---

## 2. Object and Tag Storage

`ComponentSet<T>` implements a contiguous sparse-dense set for arbitrary JavaScript objects, references, or state tags.

```typescript
import { ComponentSet } from "./ComponentSet.js";

interface Transform {
    x: number;
    y: number;
}

const transforms = new ComponentSet<Transform>();

// Mutations
transforms.set(e1, { x: 10, y: 20 });
const hasTransform = transforms.has(e1); // true
const t = transforms.get(e1);           // { x: 10, y: 20 }

// Deletion via swap-and-pop
transforms.delete(e1);

// Dense contiguous iteration
for (const [entity, transform] of transforms) {
    console.log(entity, transform.x, transform.y);
}

transforms.each((entity, transform) => {
    transform.x += 1;
});
```

- Storage layout:
  - `dense: T[]`: Packed array storing component values contiguously with zero holes.
  - `entities: Entity[]`: Packed array storing corresponding entity IDs at matching dense indices.
  - `sparse: number[]`: Direct lookup array mapping entity slot indices to dense indices.
- `set(entity, value)`: Updates value in place if entity already exists in set. Otherwise appends value and entity ID to dense arrays and records index in sparse array in O(1).
- `delete(entity)`: Swaps tail element into deleted element's dense slot, pops tail, updates swapped element's sparse pointer, and sets deleted entity's sparse pointer to `-1` in O(1). Preserves contiguous dense array packing.
- `get(entity)`: Verifies sparse index bounds and entity identity, returning component reference in O(1).
- `getOrAdd(entity, valOrFactory)`: Returns existing component or initializes and sets a new one.
- `ensure(entity, val)`: Ensures component exists on entity without overwriting existing state.
- `swap(entityA, entityB)`: Swaps component values between two entities in O(1).

---

## 3. Packed Numeric Storage

`FloatSet` provides flat `Float32Array` storage for high-frequency numeric components (positions, velocities, colors, matrices).

```typescript
import { FloatSet } from "./FloatSet.js";

// Stride of 3 floats: [x, y, z]
const positions = new FloatSet(3, 1024);

// Write coordinates directly
positions.set(e1, [100.0, 200.0, 300.0]);

// Zero-allocation slice retrieval
const pos = positions.get(e1); // Float32Array(3) subarray view
if (pos) {
    pos[0] += 5.0; // In-place coordinate update
}

// Zero-allocation direct element access
const y = positions.getDirect(e1, 1); // Reads y coordinate without subarray allocation
positions.setDirect(e1, 1, 250.0);   // Writes y coordinate directly into buffer

// Contiguous iteration
positions.each((entity, coords) => {
    coords[1] -= 9.8; // Gravity step
});
```

- Storage layout: Flat `dense: Float32Array` storing interleaved numeric records of length `stride`, paired with `entities: Entity[]` and `sparse: number[]`.
- `stride`: Fixed number of float elements per entity.
- Buffer expansion: Automatically doubles backing `Float32Array` capacity when element count exceeds allocated bounds, copying existing data in a single typed array copy.
- `get(entity)`: Returns a `Float32Array.subarray` view into dense memory in O(1).
- `getDirect(entity, index)`: Reads a single float at component index without allocating a subarray view.
- `setDirect(entity, index, value)`: Writes a single float directly into dense memory without allocating an array.
- `copyTo(entity, dst, dstOffset)`: Copies entity floats into an external Float32Array at destination offset.
- `delete(entity)`: Uses `Float32Array.copyWithin` to swap tail stride block into vacated slot in O(1).

---

## 4. Multi-Set Query Engine

`Query` and `QueryBuilder` evaluate multi-set constraints, automatically selecting the set with smallest cardinality to drive the iteration loop.

```typescript
import { Query, createQuery } from "./index.js";

// Construct query directly or via createQuery()
const query = new Query()
    .all(positions, velocities)
    .none(dead)
    .any(burning, frozen);

// Direct iteration with zero allocations on hot paths
query.each(entity => {
    const pos = positions.get(entity)!;
    const vel = velocities.get(entity)!;
    pos[0] += vel[0];
    pos[1] += vel[1];
});

// Query evaluation operations
const count = query.count();
const first = query.first();
const entities = query.entities();
const matches = query.matches(e1);
```

- `all(...sets)`: Requires entity to be present in every specified set.
- `none(...sets)`: Excludes entities present in any of the specified sets.
- `any(...sets)`: Requires entity to be present in at least one of the specified sets.
- Driver selection: Identifies set in `all` with minimum `size`. Iterates driver's dense entity list and executes O(1) sparse checks against companion sets.
- Hot-path invariant: `each()` skips non-driver sets via in-place index validation with zero array allocations.

---

## 5. Fast Typed Joins

`query2` and `query3` provide fast 2-way and 3-way joins across `ComponentSet` and `FloatSet` sources:

```typescript
import { query2, query3 } from "./index.js";

// 2-way join passing typed component references
query2(transforms, positions, (entity, transform, pos) => {
    transform.x = pos[0];
    transform.y = pos[1];
});

// 3-way join passing typed component references
query3(transforms, positions, velocities, (entity, transform, pos, vel) => {
    pos[0] += vel[0];
    pos[1] += vel[1];
    transform.x = pos[0];
});
```

- `query2(setA, setB, fn)`: Drives loop from whichever set has lower element count.
- `query3(setA, setB, setC, fn)`: Drives loop from whichever of the three sets has lowest element count.
- Aliases `join2` and `join3` remain available for backward compatibility.
