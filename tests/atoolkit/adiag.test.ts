import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	Bus,
	type Diagnostic
} from "../../Atoolkit/adiag/index.ts";

describe("adiag - Bounded History, Subscriber Isolation, and Causal Tracing", () => {
	it("validates maxHistory and supports maxHistory = 0 without retaining history", () => {
		assert.throws(() => new Bus({ maxHistory: -1 }), RangeError);
		assert.throws(() => new Bus({ maxHistory: 1.5 }), RangeError);
		assert.throws(() => new Bus({ maxHistory: Number.NaN }), RangeError);

		const zeroBus = new Bus({ maxHistory: 0 });
		const receivedList: Array<Diagnostic<{ msg: string }>> = [];
		zeroBus.on((d) => {
			receivedList.push(d);
		});

		const emitted = zeroBus.info("ZERO_HIST", { msg: "ok" });
		assert.equal(receivedList[0]?.id, emitted.id);
		assert.equal(zeroBus.size, 0);
		assert.deepEqual(zeroBus.history(), []);

		const bus = new Bus({ maxHistory: 3 });
		bus.info("C1", 1);
		bus.info("C2", 2);
		bus.info("C3", 3);
		bus.info("C4", 4);
		assert.equal(bus.size, 3);
		assert.deepEqual(
			bus.history().map((d) => d.message),
			["C2", "C3", "C4"]
		);
	});

	it("isolates throwing subscribers and routes errors to onSubscriberError without recursion storms", () => {
		const capturedErrors: Array<{ error: unknown; message: string }> = [];
		const bus = new Bus({
			onSubscriberError: (error, diagnostic) => {
				capturedErrors.push({ error, message: diagnostic.message });
				// Even if the error handler throws, Bus must not crash or recurse
				throw new Error("handler-throws-too");
			}
		});

		const deliveredToHealthy: string[] = [];
		bus.on(() => {
			throw new Error("bad-listener-1");
		});
		bus.on((d) => {
			deliveredToHealthy.push(d.message);
		});
		bus.on(() => {
			throw new Error("bad-listener-2");
		});

		const diag = bus.warn("WARN_01", { detail: 123 });
		assert.equal(diag.severity, "warn");
		assert.deepEqual(deliveredToHealthy, ["WARN_01"]);
		assert.equal(capturedErrors.length, 2);
		assert.equal(capturedErrors[0]!.message, "WARN_01");
		assert.equal(capturedErrors[1]!.message, "WARN_01");
	});

	it("traces causal chains via causeId and terminates cleanly on evicted causes or cycles", () => {
		const bus = new Bus({ maxHistory: 3 });

		const d1 = bus.error("DISK_READ_ERR", { sector: 9 });
		const d2 = bus.error("TEX_LOAD_ERR", { file: "a.png" }, d1);
		const d3 = bus.error("MAT_INIT_ERR", { mat: "hero" }, d2.id);

		// trace() returns earliest retained root cause -> target diagnostic
		const chain = bus.trace(d3);
		assert.deepEqual(
			chain.map((d) => d.id),
			[d1.id, d2.id, d3.id]
		);

		// Emit d4 to evict d1 from the 3-slot ring buffer
		const d4 = bus.emit("fatal", "FRAME_ABORT", {}, d3.id, "error");
		assert.equal(bus.getById(d1.id), undefined);
		const truncatedChain = bus.trace(d4);
		assert.deepEqual(
			truncatedChain.map((d) => d.id),
			[d2.id, d3.id, d4.id]
		);

		// Guard against synthetic cycle in causeId
		const cycleDiag: Diagnostic<null> = {
			id: 900,
			timestamp: 1,
			severity: "error",
			category: "test",
			message: "CYC_A",
			data: null,
			causeId: 900
		};
		const selfCycleChain = bus.trace(cycleDiag);
		assert.equal(selfCycleChain.length, 1);
	});
});
