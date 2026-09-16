# Acircuit

Directed value computation circuit featuring typed socket endpoints, 1-to-1 input connections, 1-to-N output fan-out, static graph validation, subcircuit composite encapsulation, and dependency plan caching.

---

## Architecture Overview

Acircuit structures computational graphs across five core primitives:

1. `Socket`: Input and output endpoint descriptors with optional data type and requirement tags.
2. `Wire`: Directed connection interface linking an output endpoint to an input endpoint.
3. `Chip`: Stateless computational unit declaring socket interfaces and evaluating input records.
4. `Circuit`: Graph topology owner resolving dependencies, performing static analysis, and caching execution plans.
5. `Subcircuit`: Composite chip encapsulating an inner circuit with boundary socket mapping and graph inlining support.

---

## 1. Socket and Wire Endpoints

`Socket` represents an endpoint on a computational chip. `Wire` connects an output socket to an input socket.

```typescript
import { Socket, inSocketKey, wireEquals, type Wire } from "./index.js";

// Endpoint definition with data type and requirement tags
const inSocket = new Socket("intensity", "input", { dataType: "number", required: true });
const outSocket = new Socket("result", "output", "number");

// Wire interface
const wire: Wire = {
    outChipId: "sourceChip",
    outSocket: "result",
    inChipId: "targetChip",
    inSocket: "intensity",
};

// Endpoint lookup key
const key = inSocketKey("targetChip", "intensity"); // "targetChip:intensity"
```

- `Socket(name, direction, options)`: Instantiates endpoint. `direction` enforces `"input"` or `"output"`. Options configure `dataType` (for type compatibility enforcement) and `required` (for static validation).
- `Wire`: Immutable directed connection describing `{ outChipId, outSocket, inChipId, inSocket }`.
  - Input sockets enforce 1-to-1 wiring; connecting a new wire replaces any pre-existing connection.
  - Output sockets support 1-to-N fan-out to multiple downstream inputs.
- `inSocketKey(chipId, socketName)` / `outSocketKey`: Generates colon-delimited lookup keys (`"chipId:socketName"`).
- `wireEquals(a, b)`: Compares two wire instances across all four endpoint coordinates.
- `formatWire(wire)`: Formats connection string for diagnostic logging: `"(outChip:outSocket -> inChip:inSocket)"`.

---

## 2. Computational Chips

`Chip` represents a stateless processing unit with declared inputs and outputs. Values belong strictly to the circuit run, not to the chip instance.

```typescript
import { Chip, type ProcessCtx } from "./index.js";

class MultiplyAddChip extends Chip {
    constructor(id: string) {
        super(id, "MultiplyAdd");
        this.addInput("a", "number")
            .addInput("b", "number")
            .addInput("c", "number")
            .addOutput("result", "number");
    }

    override canConnectInput(
        inSocketName: string,
        outChip: Chip,
        outSocketName: string
    ): boolean {
        // Enforces socket existence and dataType matching
        return super.canConnectInput(inSocketName, outChip, outSocketName);
    }

    override process(
        inputs: Record<string, any>,
        ctx?: ProcessCtx
    ): Record<string, any> {
        const a = typeof inputs.a === "number" ? inputs.a : 0;
        const b = typeof inputs.b === "number" ? inputs.b : 0;
        const c = typeof inputs.c === "number" ? inputs.c : 0;
        return { result: (a * b) + c };
    }
}
```

- `Chip(id, name)`: Abstract base constructor registering immutable string identifier and debug name.
- `addInput(socketOrName, options)` / `addOutput(socketOrName, dataType)`: Registers endpoints with optional type validation tags.
- `canConnectInput(inSocketName, outChip, outSocketName)`: Pre-connection validation gate invoked by `Circuit.connect()`. Verifies type compatibility when data types are declared.
- `process(inputs, ctx)`: Evaluates chip using resolved input values for the current pass.
- `ChipProxy`: Transparent proxy chip delegating execution and configuration to a wrapped source chip.

---

## 3. Circuit Topology and Static Validation

`Circuit` manages chip collections, maintains multi-map wire indices, validates acyclic constraints, and caches execution plans.

```typescript
import { Circuit } from "./index.js";

const circuit = new Circuit({ label: "AudioSignalPipeline" });

const chipA = new MultiplyAddChip("chipA");
const chipB = new MultiplyAddChip("chipB");

// Graph construction
circuit.addChip(chipA);
circuit.addChip(chipB);

// Wire connection (replaces existing connection on chipB:a)
const wire = circuit.connect(chipA, "result", chipB, "a");

// Static validation without throwing
const validation = circuit.validate();
if (!validation.valid) {
    console.error("Circuit issues:", validation.issues);
}
```

- Storage structures:
  - `chips: Map<string, Chip>`: Registered chips by identifier.
  - `_inWires: Map<string, Wire>`: 1-to-1 map keyed by `"inChipId:inSocket"`.
  - `_outWires: Map<string, Wire[]>`: 1-to-N map keyed by `"outChipId:outSocket"`.
  - `_chipInWires` / `_chipOutWires`: Grouped wire indices by chip ID for fast bulk disconnection.
- `connect(outChip, outSocket, inChip, inSocket)`: Validates endpoints, enforces `canConnectInput`, replaces pre-existing wire on destination input, and invalidates cached plan.
- `disconnect(wireOrChipId, inSocketName?)`: Removes matching wire from indices and invalidates plan.
- `disconnectAll(chipOrId)`: Removes all connections associated with chip.
- `validate()`: Statically analyzes graph and returns `{ valid: boolean, issues: CircuitIssue[] }`. Detects:
  - Cycles (`"cycle"`)
  - Missing required inputs (`"missing_input"`)
  - Mismatched socket data types (`"type_mismatch"`)
  - Isolated disconnected chips (`"isolated_chip"`)

---

## 4. Graph Inspection and Traversal

`Circuit` provides non-destructive graph analysis queries:

- `getSources()`: Returns array of chips with indegree 0 (zero incoming wires).
- `getSinks()`: Returns array of chips with outdegree 0 (zero outgoing wires).
- `getUpstreamChips(chipOrId)`: Returns a `Set<Chip>` containing all transitive ancestor dependencies feeding into the specified chip.
- `getDownstreamChips(chipOrId)`: Returns a `Set<Chip>` containing all transitive descendant chips fed by the specified chip.
- `isReachable(fromChip, toChip)`: Returns boolean indicating whether a directed path exists from source to target.

---

## 5. Dead Code Elimination and Subgraphs

`Circuit` supports pruning unused chips and extracting isolated sub-graphs:

```typescript
// Prunes all chips that do not contribute to target sinks
circuit.pruneUnreachable(["outputChip"]);

// Extracts minimal subgraph required to compute target chips
const subCircuit = circuit.extractSubgraph(["outputChip"]);
```

- `pruneUnreachable(targetChipIds?)`: Keeps target chips (or all sinks if omitted) and their transitive upstream dependencies; removes all non-contributing chips and wires from the circuit.
- `extractSubgraph(targetChipIds, options?)`: Constructs and returns a new `Circuit` containing only target chips, their transitive upstream dependencies, and interconnecting wires.

---

## 6. Composite Subcircuits and Inlining

`Subcircuit` wraps an entire inner circuit as a single computational chip, mapping outer boundary sockets to inner chips.

```typescript
import { Circuit, Subcircuit } from "./index.js";

const inner = new Circuit({ label: "FilterBlock" });
// ... populate inner circuit ...

const composite = new Subcircuit("filter1", "AudioFilter", inner);
composite.mapInput("audioIn", "innerPreAmp", "signal");
composite.mapOutput("audioOut", "innerPostAmp", "result");

const mainCircuit = new Circuit({ label: "Main" });
mainCircuit.addChip(composite);

// Inline/flatten composite into parent circuit
mainCircuit.flatten("filter1");
```

- `mapInput(outerSocket, innerChipId, innerSocket, dataType?)`: Maps external input to internal chip input.
- `mapOutput(outerSocket, innerChipId, innerSocket, dataType?)`: Maps internal chip output to external output.
- `flatten(chipOrId, prefix?)`: Inlines inner chips into parent circuit with prefixed IDs, re-routes incoming and outgoing wires directly to inner endpoints, copies inner wires, and removes composite chip.

---

## 7. Serialization, Cloning, and Merging

- `toJSON()`: Serializes topology, sockets, and metadata into a portable `SerializedCircuit` structure.
- `Circuit.fromJSON(json, chipFactory)`: Reconstructs circuit graph using a factory callback instantiating chips by descriptor.
- `clone(chipCloner?)`: Duplicates circuit and interconnecting wires.
- `merge(other, prefix?)`: Merges another circuit into this graph with optional ID prefixing.

---

## 8. Topological Execution Pipeline

`circuit.run()` evaluates chips in dependency order using run-local input and output records.

```typescript
import { Circuit, type RunOptions, type RunResult } from "./index.js";

const result = circuit.run({
    overrides: {
        chipA: { a: 2, b: 3, c: 4 },
        chipB: { b: 10, c: 5 },
    },
    ctx: { sampleRate: 44100 },
    onChipEnter: (chip, inputs) => console.log(`Executing ${chip.id}`),
    onChipLeave: (chip, outputs) => console.log(`Completed ${chip.id}`, outputs),
    onWireTransmit: (wire, value) => console.log(`Wire transmitted:`, wire, value),
});

const finalOutput = result.outputs.get("chipB")?.result;
console.log(result.executedChips);
console.log(result.errors);
```