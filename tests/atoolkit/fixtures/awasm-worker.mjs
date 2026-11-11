import { parentPort } from "node:worker_threads";

let initializedModule = null;
let initializedMemory = null;

if (parentPort) {
	parentPort.on("message", (msg) => {
		if (!msg || typeof msg !== "object") {
			return;
		}

		if (msg.type === "init") {
			initializedModule = msg.module ?? null;
			initializedMemory = msg.memory ?? null;
			parentPort.postMessage({
				taskId: msg.taskId,
				result: true
			});
			return;
		}

		if (msg.type === "task") {
			const taskId = msg.taskId;
			const taskIndex = msg.taskIndex ?? 0;
			const arg0 = msg.arg0 ?? 0;
			const arg1 = msg.arg1 ?? 0;
			const args = Array.isArray(msg.args) ? msg.args : [arg0, arg1];

			if (taskIndex === 0) {
				parentPort.postMessage({
					taskId,
					result: {
						hasModule: initializedModule instanceof WebAssembly.Module,
						hasMemory: initializedMemory instanceof WebAssembly.Memory,
						taskIndex,
						args,
						arg0,
						arg1,
						sum: arg0 + arg1
					}
				});
				return;
			}

			if (taskIndex === 1) {
				setTimeout(() => {
					parentPort.postMessage({
						taskId,
						result: arg1
					});
				}, Math.max(1, arg0));
				return;
			}

			if (taskIndex === 2) {
				parentPort.postMessage({
					taskId,
					error: "Simulated worker task error"
				});
				return;
			}

			if (taskIndex === 3) {
				setImmediate(() => {
					throw new Error("Simulated uncaught worker thread crash");
				});
				return;
			}
		}

		if (msg.type === "spsc-consume") {
			const { buffer, byteOffset, capacity, totalItems } = msg;
			const view = new Int32Array(buffer);
			const base = byteOffset / 4;
			const headIdx = base;
			const tailIdx = base + 1;
			const dataBase = base + 2;
			const mask = capacity - 1;

			const received = [];
			while (received.length < totalItems) {
				const head = Atomics.load(view, headIdx) >>> 0;
				const tail = Atomics.load(view, tailIdx) >>> 0;
				if (head === tail) {
					continue;
				}
				const slot = dataBase + (head & mask);
				const val = Atomics.load(view, slot);
				Atomics.store(view, headIdx, (head + 1) | 0);
				received.push(val);
			}

			parentPort.postMessage({
				type: "spsc-done",
				received
			});
		}
	});
}
