# Acircuit

Directed value computation circuit featuring typed socket endpoints, 1-to-1 input connections, 1-to-N output fan-out, transactional topology validation, composite subcircuit encapsulation, and revision-keyed dependency plan caching.

---

## Architecture Overview

Acircuit structures computational graphs across five core primitives:

1. `Socket`: Input and output endpoint descriptors with data type, direction (`SocketDirection.Input` / `SocketDirection.Output`), optional default value, and metadata.
2. `Wire`: Directed connection linking an output endpoint `(fromChipId, fromSocketName)` to an input endpoint `(toChipId, toSocketName)`.
3. `Chip`: Computational unit declaring input/output socket schemas and evaluating `(inputs, outputs)` during a circuit run.
4. `Circuit`: Graph topology owner enforcing transactional wiring, cycle detection, and revision-keyed execution plan caching.
5. `CompositeChip` & `ChipProxy`: Subgraph container exposing selected inner sockets as boundary ports and flattening inner topology into a parent circuit via prefixed proxy chips.

---

## 1. Socket and Wire Endpoints

`Socket` represents an endpoint on a computational chip. `Wire` connects an output socket to an input socket.

```typescript
import { Socket, SocketDirection, Wire, encodeEndpointKey } from "@asciiz/atoolkit/acircuit";

// Endpoint definition with data type, direction, and default value
const inSocket = new Socket("intensity", "number", SocketDirection.Input, 1.0);
const outSocket = new Socket("result", "number", SocketDirection.Output, 0.0);
void inSocket;
void outSocket;

// Wire instance
const wire = new Wire("sourceChip", "result", "targetChip", "intensity");
const endpointKey = encodeEndpointKey(wire.toChipId, wire.toSocketName);
void endpointKey;
```

- `Socket(name, type, direction, defaultValue?, metadata?)`: Instantiates an endpoint. `type` specifies socket data type (or `WILDCARD_TYPE = "*"` to match any type). `direction` is `SocketDirection.Input` or `SocketDirection.Output`.
- `Wire(fromChipId, fromSocketName, toChipId, toSocketName, metadata?)`: Directed connection linking producer endpoint to consumer endpoint.
  - Input sockets enforce 1-to-1 wiring; connecting a new wire replaces any pre-existing connection only after endpoint validation succeeds.
  - Output sockets support 1-to-N fan-out to multiple downstream inputs.
  - Internal endpoint maps use length-prefixed keys via `encodeEndpointKey(chipId, socketName)` so chip IDs and socket names may contain arbitrary characters such as `:` or `/`.
- `canConnectInput(inSocket, outSocket)`: Verifies direction (`Input` vs `Output`) and type compatibility (exact match or `WILDCARD_TYPE`).

---

## 2. Computational Chips

`Chip` represents a processing unit with declared inputs and outputs. Runtime socket values belong strictly to each `circuit.run()` invocation, not to the `Chip` instance.

```typescript
import { Chip } from "@asciiz/atoolkit/acircuit";

const multiplyAdd = new Chip(
	"mad1",
	"MultiplyAdd",
	(inputs, outputs) => {
		const a = typeof inputs.a === "number" ? inputs.a : 0;
		const b = typeof inputs.b === "number" ? inputs.b : 0;
		const c = typeof inputs.c === "number" ? inputs.c : 0;
		outputs.result = a * b + c;
	}
)
	.addInput("a", "number", 0)
	.addInput("b", "number", 1)
	.addInput("c", "number", 0)
	.addOutput("result", "number", 0);
void multiplyAdd;
```

- `Chip(id, label?, process?, metadata?)`: Constructs a chip with an immutable non-empty `id`, display `label`, and processor callback `(inputs, outputs) => void`.
- `addInput(name, type, defaultValue?, metadata?)` / `addOutput(name, type, defaultValue?, metadata?)` / `removeInput(name)` / `removeOutput(name)`: Registers or removes endpoints. While a `Chip` is attached to one or more `Circuit` instances (`isSchemaLocked === true`), its port schema is locked and mutating ports throws an `Error`.
- `inputs` / `outputs`: Returns a defensive `ReadonlyMap<string, Socket>` snapshot of declared sockets.
- `ChipProxy`: Proxy chip wrapping an inner chip under a prefixed ID (`${prefix}/${original.id}`) while delegating execution to `original.process`.

---

## 3. Circuit Topology and Plan Compilation

`Circuit` manages chip collections, maintains structured wire indices, validates acyclic constraints, and caches topological execution plans keyed by structural `revision`.

```typescript
import { Chip, Circuit } from "@asciiz/atoolkit/acircuit";

function createGainChip(id: string, defaultIn = 0): Chip {
	return new Chip(id, "Gain", (inputs, outputs) => {
		outputs.result = (typeof inputs.a === "number" ? inputs.a : 0) * 2;
	})
		.addInput("a", "number", defaultIn)
		.addOutput("result", "number", 0);
}

const circuit = new Circuit({ label: "AudioSignalPipeline" });

const chipA = createGainChip("chipA", 5);
const chipB = createGainChip("chipB", 0);

// Graph construction
circuit.addChip(chipA).addChip(chipB);

// Wire connection (replaces existing connection on chipB.a after validation)
const wire = circuit.connect(chipA, "result", chipB, "a");
void wire;

// Compile and inspect topological order
const compiled = circuit.compile();
void compiled;
```

- `addChip(chip)`: Registers a chip and locks its socket schema (`chip.isSchemaLocked === true`). Passing a different `Chip` instance with an already-registered ID throws an `Error`.
- `connect(outChip, outSocketName, inChip, inSocketName, metadata?)`: Rejects self-loops (`outChip.id === inChip.id`), validates chip ID collisions, endpoint existence, and `canConnectInput` before mutating state, replaces any pre-existing wire on the destination input, and increments `revision`.
- `replaceChip(newChip)`: Transactionally replaces a chip of the same ID after validating that all incident incoming and outgoing wires remain valid against `newChip`'s socket schema.
- `removeChip(chipId)`: Removes a chip and all of its incident wires, unlocking the chip's port schema.
- `disconnect(fromChipId, fromSocketName, toChipId, toSocketName)` / `disconnectInput(inChipId, inSocketName)`: Removes a wire and increments `revision`.
- `compile()` / `topoSort()`: Computes and caches the topological evaluation order via Kahn's algorithm and returns a fresh array copy so caller array mutations cannot corrupt the cached plan. Throws an `Error` if the circuit contains a cycle.

---

## 4. Composite Subcircuits and Inlining

`CompositeChip` wraps an inner `Circuit` as a composite chip, exposing selected inner sockets as external ports and supporting transactional flattening into a parent circuit.

```typescript
import { Chip, Circuit, CompositeChip } from "@asciiz/atoolkit/acircuit";

function createPassChip(id: string): Chip {
	return new Chip(id, "Pass", (inputs, outputs) => {
		outputs.result = inputs.signal ?? 0;
	})
		.addInput("signal", "number", 0)
		.addOutput("result", "number", 0);
}

const inner = new Circuit({ label: "FilterBlock" });
const preAmp = createPassChip("innerPreAmp");
const postAmp = createPassChip("innerPostAmp");
inner.addChip(preAmp).addChip(postAmp);
inner.connect(preAmp, "result", postAmp, "signal");

const composite = new CompositeChip("filter1", inner, "AudioFilter")
	.exposeInput("audioIn", "innerPreAmp", "signal")
	.exposeOutput("audioOut", "innerPostAmp", "result");

const mainCircuit = new Circuit({ label: "Main" });
// Transactionally inline inner chips into mainCircuit as prefixed ChipProxy instances ("filter1/innerPreAmp", etc.)
const proxies = composite.flattenInto(mainCircuit);
void proxies;
```

- `exposeInput(externalName, innerChipId, innerSocketName)`: Exposes an input socket of an inner chip on the `CompositeChip`.
- `exposeOutput(externalName, innerChipId, innerSocketName)`: Exposes an output socket of an inner chip on the `CompositeChip`.
- `flattenInto(targetCircuit)`: Preflights all proxy IDs (`${composite.id}/${innerChip.id}`) and internal wires before mutating `targetCircuit`, then adds `ChipProxy` instances and connects their internal wires.

---

## 5. Serialization and Merging

- `toJSON()`: Serializes chips, sockets, wires, and metadata into a portable `SerializedCircuit` structure.
- `Circuit.fromJSON(data, processorRegistry?)`: Reconstructs a `Circuit` topology from serialized data, binding processor functions by chip ID from `processorRegistry`.
- `merge(otherCircuit)`: Transactionally preflights all chip IDs and wires in `otherCircuit` before merging them into this circuit.

---

## 6. Topological Execution Pipeline

`circuit.run(options?)` evaluates chips in topological dependency order using run-local input and output records.

```typescript
import { Chip, Circuit } from "@asciiz/atoolkit/acircuit";

const sourceChip = new Chip("chipA", "Source", (_inputs, outputs) => {
	outputs.result = 2 * 3 + 4;
}).addOutput("result", "number", 0);

let finalOutput = 0;
const sinkChip = new Chip("chipB", "Sink", (inputs, outputs) => {
	const a = typeof inputs.a === "number" ? inputs.a : 0;
	finalOutput = a + 10;
	outputs.result = finalOutput;
})
	.addInput("a", "number", 0)
	.addOutput("result", "number", 0);

const circuit = new Circuit({ label: "ExecPipeline" });
circuit.connect(sourceChip, "result", sinkChip, "a");

const entered: string[] = [];
const result = circuit.run({
	errorPolicy: "skip-dependents",
	onChipEnter: (chip) => entered.push(chip.id),
});

void result.completed;
void finalOutput;
```

- `CircuitRunOptions`:
  - `errorPolicy?: "skip-dependents" | "fail-fast"`: Under `"skip-dependents"` (default), if a chip processor throws, its error is recorded in `result.errors` and downstream dependent chips are skipped (`result.skippedChipIds`) while independent branches continue. Under `"fail-fast"`, processor exceptions are rethrown immediately.
  - `onChipEnter?: (chip, inputs) => void`: Invoked before each chip processor runs.
  - `onChipLeave?: (chip, outputs) => void`: Invoked after each chip processor succeeds.
  - `onWireTransmit?: (wire, value) => void`: Invoked as each outgoing wire transfers a value.
  - `onError?: (chip, error) => void`: Invoked when a chip processor throws.
