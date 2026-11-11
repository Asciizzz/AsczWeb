import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	Chip,
	Circuit,
	CompositeChip,
	Wire
} from "../../Atoolkit/acircuit/index.ts";

describe("acircuit - Graph Topology, Transactional Mutation, and Execution", () => {
	it("supports arbitrary chip IDs and socket names containing colons and slashes", () => {
		const circuit = new Circuit();
		let observedResult = 0;

		const src = new Chip(
			"ns:chip/source:1",
			"Source",
			(_inputs, outputs) => {
				outputs["out:main/0"] = 42;
			}
		).addOutput("out:main/0", "number", 0);

		const dst = new Chip(
			"ns:chip/target:2",
			"Target",
			(inputs, outputs) => {
				const v = Number(inputs["in:sub/0"]);
				outputs["out:result:1"] = v * 2;
				observedResult = v * 2;
			}
		)
			.addInput("in:sub/0", "number", 0)
			.addOutput("out:result:1", "number", 0);

		circuit.addChip(src).addChip(dst);
		const wire = circuit.connect(src, "out:main/0", dst, "in:sub/0");
		assert.ok(wire instanceof Wire);

		const report = circuit.run();
		assert.equal(report.completed, true);
		assert.equal(observedResult, 84);

		// Verify JSON serialization round-trip preserves structured endpoints
		const json = circuit.toJSON();
		assert.equal(json.wires.length, 1);
		assert.equal(json.wires[0]!.fromChipId, "ns:chip/source:1");
		assert.equal(json.wires[0]!.fromSocketName, "out:main/0");
		assert.equal(json.wires[0]!.toChipId, "ns:chip/target:2");
		assert.equal(json.wires[0]!.toSocketName, "in:sub/0");

		const restored = Circuit.fromJSON(json, {
			"ns:chip/source:1": (_in, out) => {
				out["out:main/0"] = 10;
			},
			"ns:chip/target:2": (inp, out) => {
				out["out:result:1"] = Number(inp["in:sub/0"]) + 5;
			}
		});
		const restoredRun = restored.run();
		assert.equal(restoredRun.completed, true);

		assert.equal(
			circuit.disconnect(
				"ns:chip/source:1",
				"out:main/0",
				"ns:chip/target:2",
				"in:sub/0"
			),
			true
		);
		assert.equal(circuit.wireCount, 0);
	});

	it("locks port schema while a chip is attached to a Circuit and unlocks on removal", () => {
		const circuit = new Circuit();
		const chip = new Chip("c1").addInput("a", "number", 0).addOutput("b", "number", 0);
		circuit.addChip(chip);
		assert.equal(chip.isSchemaLocked, true);

		assert.throws(() => {
			chip.addInput("extra", "number", 0);
		}, /attached/i);
		assert.throws(() => {
			chip.addOutput("extraOut", "number", 0);
		}, /attached/i);
		assert.throws(() => {
			chip.removeInput("a");
		}, /attached/i);

		circuit.removeChip("c1");
		assert.equal(chip.isSchemaLocked, false);
		chip.addInput("extra", "number", 0);
		assert.equal(chip.hasInput("extra"), true);
	});

	it("rejects self-loops, chip ID collisions, and invalid endpoints transactionally during connect", () => {
		const circuit = new Circuit();
		const a = new Chip("A").addInput("in", "number", 0).addOutput("out", "number", 0);
		const b = new Chip("B").addInput("in", "number", 0).addOutput("out", "number", 0);

		circuit.addChip(a);

		// Self-loop rejected
		assert.throws(() => {
			circuit.connect(a, "out", a, "in");
		}, /self-loop/i);
		assert.equal(circuit.wireCount, 0);

		// Missing socket rejected before mutating membership of b
		assert.throws(() => {
			circuit.connect(a, "out", b, "nonexistent");
		}, /not found/i);
		assert.equal(circuit.hasChip("B"), false);
		assert.equal(b.isSchemaLocked, false);

		// Chip ID collision rejected without adding duplicate or modifying wires
		const imposterA = new Chip("A").addOutput("out", "number", 0);
		assert.throws(() => {
			circuit.connect(imposterA, "out", b, "in");
		}, /collides/i);
		assert.equal(circuit.getChip("A"), a);
		assert.equal(circuit.hasChip("B"), false);
	});

	it("performs transactional replaceChip and rolls back if replacement invalidates incident wires", () => {
		const circuit = new Circuit();
		let finalOutput = 0;

		const a = new Chip("A", "A", (_in, out) => {
			out.out = 10;
		}).addOutput("out", "number", 0);

		const b = new Chip("B", "B", (inp, out) => {
			out.out = Number(inp.in) * 2;
		})
			.addInput("in", "number", 0)
			.addOutput("out", "number", 0);

		const c = new Chip("C", "C", (inp) => {
			finalOutput = Number(inp.in) + 5;
		}).addInput("in", "number", 0);

		circuit.connect(a, "out", b, "in");
		circuit.connect(b, "out", c, "in");

		// Incompatible replacement missing output socket "out"
		const badB = new Chip("B").addInput("in", "number", 0).addOutput("wrongOut", "number", 0);
		assert.throws(() => {
			circuit.replaceChip(badB);
		}, /invalidates outgoing wire/i);

		// Original B and all wires must remain intact
		assert.equal(circuit.getChip("B"), b);
		assert.equal(b.isSchemaLocked, true);
		assert.equal(badB.isSchemaLocked, false);
		assert.equal(circuit.wireCount, 2);

		assert.equal(circuit.run().completed, true);
		assert.equal(finalOutput, 25);

		// Valid replacement with compatible sockets
		const goodB = new Chip("B", "B", (inp, out) => {
			out.out = Number(inp.in) * 3;
		})
			.addInput("in", "number", 0)
			.addOutput("out", "number", 0);

		circuit.replaceChip(goodB);
		assert.equal(circuit.getChip("B"), goodB);
		assert.equal(b.isSchemaLocked, false);
		assert.equal(goodB.isSchemaLocked, true);

		assert.equal(circuit.run().completed, true);
		assert.equal(finalOutput, 35);
	});

	it("performs transactional merge and CompositeChip.flattenInto with preflight validation", () => {
		const host = new Circuit();
		const existing = new Chip("shared").addOutput("out", "number", 0);
		host.addChip(existing);

		const other = new Circuit();
		const c1 = new Chip("newChip").addOutput("out", "number", 0);
		const c2 = new Chip("shared").addInput("in", "number", 0);
		other.connect(c1, "out", c2, "in");

		assert.throws(() => {
			host.merge(other);
		}, /collides/i);

		assert.equal(host.chipCount, 1);
		assert.equal(host.hasChip("newChip"), false);

		// Flatten into host under prefix "sub" succeeds
		const comp = new CompositeChip("sub", other);
		comp.flattenInto(host);
		assert.equal(host.hasChip("sub/newChip"), true);
		assert.equal(host.hasChip("sub/shared"), true);
		assert.equal(host.wireCount, 1);

		// Flattening the same composite chip a second time fails preflight without partial insertion
		assert.throws(() => {
			comp.flattenInto(host);
		}, /already exists/i);
		assert.equal(host.chipCount, 3);
	});

	it("returns a defensive copy from topoSort so caller mutation cannot corrupt internal cache", () => {
		const circuit = new Circuit();
		const a = new Chip("A").addOutput("out", "number", 0);
		const b = new Chip("B").addInput("in", "number", 0);
		circuit.connect(a, "out", b, "in");

		const order1 = circuit.topoSort();
		assert.equal(order1.length, 2);
		order1.length = 0;

		const order2 = circuit.topoSort();
		assert.equal(order2.length, 2);
	});

	it("isolates failing branches in skip-dependents mode while executing independent branches", () => {
		const circuit = new Circuit();
		const executed: string[] = [];
		let goodResult = 0;

		const badSrc = new Chip("badSrc", "badSrc", () => {
			executed.push("badSrc");
			throw new Error("boom");
		}).addOutput("out", "number", 0);

		const badDownstream = new Chip("badDownstream", "badDownstream", () => {
			executed.push("badDownstream");
		}).addInput("in", "number", 0);

		const goodSrc = new Chip("goodSrc", "goodSrc", (_in, out) => {
			executed.push("goodSrc");
			out.out = 7;
		}).addOutput("out", "number", 0);

		const goodDownstream = new Chip("goodDownstream", "goodDownstream", (inp) => {
			executed.push("goodDownstream");
			goodResult = Number(inp.in) * 10;
		}).addInput("in", "number", 0);

		circuit.connect(badSrc, "out", badDownstream, "in");
		circuit.connect(goodSrc, "out", goodDownstream, "in");

		const report = circuit.run({ errorPolicy: "skip-dependents" });
		assert.equal(report.completed, false);
		assert.equal(report.executedChipIds.includes("goodSrc"), true);
		assert.equal(report.executedChipIds.includes("goodDownstream"), true);
		assert.equal(report.executedChipIds.includes("badDownstream"), false);
		assert.deepEqual(report.skippedChipIds, ["badDownstream"]);
		assert.equal(report.errors.length, 1);
		assert.equal(report.errors[0]!.chipId, "badSrc");
		assert.equal(goodResult, 70);

		// fail-fast policy halts immediately when a chip throws
		assert.throws(() => {
			circuit.run({ errorPolicy: "fail-fast" });
		}, /boom/);

		// Instrumentation hook errors propagate immediately and are not misattributed to chips
		assert.throws(() => {
			circuit.run({
				errorPolicy: "skip-dependents",
				onChipEnter: () => {
					throw new Error("hook-failure");
				}
			});
		}, /hook-failure/);
	});
});
