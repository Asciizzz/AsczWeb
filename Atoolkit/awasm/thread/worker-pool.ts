// ================================================================
//  Awasm - Threading: WorkerPool
// ================================================================

import { SharedMemory } from "./shared-memory.js";
import { WasmMemory } from "../memory/wasm-memory.js";

export interface WorkerTaskMessage {
	type: "init" | "task" | "terminate";
	taskId?: number;
	taskIndex?: number;
	args?: number[];
	arg0?: number;
	arg1?: number;
	module?: WebAssembly.Module;
	memory?: WebAssembly.Memory;
}

export interface WorkerResultMessage {
	taskId: number;
	result?: unknown;
	error?: string;
}

export interface WorkerLike {
	onmessage: ((event: { data: WorkerResultMessage }) => void) | null;
	onerror?: ((event: unknown) => void) | null;
	onmessageerror?: ((event: unknown) => void) | null;
	postMessage(message: WorkerTaskMessage): void;
	terminate(): void | Promise<number>;
}

export interface WorkerPoolOptions {
	/** Number of worker threads to spawn (positive integer). */
	concurrency?: number;
	/** Maximum number of simultaneously pending tasks before `dispatch()` rejects. Defaults to 1024. */
	maxPendingTasks?: number;
	/** Optional default per-task timeout in milliseconds. */
	defaultTimeoutMs?: number;
	/** Optional custom worker factory (for example wrapping `node:worker_threads` in Node environments). */
	workerFactory?: (scriptUrl: string | URL) => WorkerLike;
}

export interface WorkerDispatchOptions {
	/** Optional timeout in milliseconds for this task. */
	timeoutMs?: number;
	/**
	 * Optional `AbortSignal` that cancels waiting on the caller side.
	 * Note: aborting rejects the caller's promise and ignores any late worker reply,
	 * but does not preemptively halt synchronous guest WebAssembly execution inside the worker.
	 */
	signal?: AbortSignal;
}

interface PendingTaskEntry {
	readonly taskId: number;
	readonly workerIndex: number;
	readonly resolve: (val: any) => void;
	readonly reject: (err: Error) => void;
	cleanup?: () => void;
}

function extractWorkerErrorMessage(event: unknown, fallback: string): string {
	if (event instanceof Error) {
		return event.message;
	}
	if (typeof event === "object" && event !== null) {
		if ("message" in event && typeof (event as { message: unknown }).message === "string") {
			return (event as { message: string }).message;
		}
		if ("error" in event && (event as { error: unknown }).error instanceof Error) {
			return ((event as { error: Error }).error).message;
		}
	}
	return fallback;
}

/**
 * Multi-worker task pool coordinating WebAssembly execution across worker threads.
 *
 * Protocol and lifecycle contract (Experimental):
 * - Initialization sends `{ type: "init", taskId, module, memory }` to every worker and awaits
 *   `{ taskId, result }` (or `{ taskId, error }`) replies. Concurrent `initialize()` calls share
 *   the same in-flight promise.
 * - Task dispatch sends `{ type: "task", taskId, taskIndex, args: [arg0, arg1], arg0, arg1 }`.
 * - Any unhandled worker `error` or `messageerror` fails the pool, terminates all workers, and
 *   rejects all pending tasks.
 * - `terminate()` / `dispose()` is idempotent and rejects all pending tasks with a termination error.
 */
export class WorkerPool {
	readonly #workers: WorkerLike[] = [];
	readonly #concurrency: number;
	readonly #maxPendingTasks: number;
	readonly #defaultTimeoutMs?: number;
	readonly #pendingTasks = new Map<number, PendingTaskEntry>();
	#roundRobinIndex = 0;
	#isInitialized = false;
	#isTerminated = false;
	#failureReason: Error | null = null;
	#initPromise: Promise<void> | null = null;
	#nextTaskId = 1;

	constructor(
		workerScriptUrl: string | URL,
		concurrencyOrOptions?: number | WorkerPoolOptions
	) {
		const opts: WorkerPoolOptions =
			typeof concurrencyOrOptions === "number"
				? { concurrency: concurrencyOrOptions }
				: (concurrencyOrOptions ?? {});

		const detectedConcurrency =
			typeof navigator !== "undefined" &&
			typeof navigator.hardwareConcurrency === "number" &&
			navigator.hardwareConcurrency > 0
				? navigator.hardwareConcurrency
				: 4;

		const concurrency = opts.concurrency ?? detectedConcurrency;
		if (!Number.isInteger(concurrency) || concurrency < 1) {
			throw new RangeError(
				`WorkerPool: concurrency must be a positive integer, received ${concurrency}.`
			);
		}

		const maxPendingTasks = opts.maxPendingTasks ?? 1024;
		if (!Number.isInteger(maxPendingTasks) || maxPendingTasks < 1) {
			throw new RangeError(
				`WorkerPool: maxPendingTasks must be a positive integer, received ${maxPendingTasks}.`
			);
		}

		if (
			opts.defaultTimeoutMs !== undefined &&
			(!Number.isFinite(opts.defaultTimeoutMs) || opts.defaultTimeoutMs <= 0)
		) {
			throw new RangeError(
				`WorkerPool: defaultTimeoutMs must be a positive finite number, received ${opts.defaultTimeoutMs}.`
			);
		}

		const factory =
			opts.workerFactory ??
			(typeof Worker !== "undefined"
				? (url: string | URL) => new Worker(url, { type: "module" }) as unknown as WorkerLike
				: null);

		if (!factory) {
			throw new Error(
				"WorkerPool: Web Worker API is not available in this environment and no workerFactory was provided."
			);
		}

		this.#concurrency = concurrency;
		this.#maxPendingTasks = maxPendingTasks;
		this.#defaultTimeoutMs = opts.defaultTimeoutMs;

		try {
			for (let i = 0; i < this.#concurrency; i++) {
				const worker = factory(workerScriptUrl);
				const workerIndex = i;
				worker.onmessage = (event) => {
					this.#handleWorkerMessage(event);
				};
				if ("onerror" in worker) {
					worker.onerror = (event) => {
						const msg = extractWorkerErrorMessage(event, `Worker ${workerIndex} encountered an error.`);
						this.#failPool(new Error(`WorkerPool worker error: ${msg}`));
					};
				}
				if ("onmessageerror" in worker) {
					worker.onmessageerror = (event) => {
						const msg = extractWorkerErrorMessage(
							event,
							`Worker ${workerIndex} failed to deserialize message.`
						);
						this.#failPool(new Error(`WorkerPool messageerror: ${msg}`));
					};
				}
				this.#workers.push(worker);
			}
		} catch (err) {
			for (let i = 0; i < this.#workers.length; i++) {
				try {
					this.#workers[i].terminate();
				} catch {
					// Ignore cleanup errors during failed construction.
				}
			}
			this.#workers.length = 0;
			throw err;
		}
	}

	/**
	 * Broadcasts the compiled `WebAssembly.Module` and shared `WebAssembly.Memory` to all workers.
	 * Concurrent calls while initialization is in flight share the same promise.
	 */
	initialize(
		module: WebAssembly.Module,
		memory: SharedMemory | WasmMemory | WebAssembly.Memory
	): Promise<void> {
		if (this.#failureReason) {
			return Promise.reject(this.#failureReason);
		}
		if (this.#isTerminated) {
			return Promise.reject(new Error("WorkerPool has been terminated."));
		}
		if (this.#isInitialized) {
			return Promise.resolve();
		}
		if (this.#initPromise !== null) {
			return this.#initPromise;
		}

		const rawMemory =
			memory instanceof WebAssembly.Memory ? memory : memory.handle;

		const initPromises: Promise<void>[] = [];

		for (let i = 0; i < this.#workers.length; i++) {
			const worker = this.#workers[i];
			const p = new Promise<void>((resolve, reject) => {
				const initId = this.#nextTaskId++;
				const entry: PendingTaskEntry = {
					taskId: initId,
					workerIndex: i,
					resolve: () => resolve(),
					reject,
				};
				this.#pendingTasks.set(initId, entry);

				const msg: WorkerTaskMessage = {
					type: "init",
					taskId: initId,
					module,
					memory: rawMemory,
				};

				try {
					worker.postMessage(msg);
				} catch (err) {
					this.#pendingTasks.delete(initId);
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
			initPromises.push(p);
		}

		this.#initPromise = Promise.all(initPromises).then(
			() => {
				this.#initPromise = null;
				if (this.#isTerminated || this.#failureReason) {
					throw this.#failureReason ?? new Error("WorkerPool was terminated during initialization.");
				}
				this.#isInitialized = true;
			},
			(err) => {
				this.#initPromise = null;
				const error = err instanceof Error ? err : new Error(String(err));
				this.#failPool(error);
				throw error;
			}
		);

		return this.#initPromise;
	}

	/**
	 * Dispatches a task `(taskIndex, arg0, arg1)` to the next worker in round-robin order.
	 */
	dispatch<T = unknown>(
		taskIndex: number,
		arg0 = 0,
		arg1 = 0,
		options?: WorkerDispatchOptions
	): Promise<T> {
		return this.dispatchArgs<T>(taskIndex, [arg0, arg1], options);
	}

	/**
	 * Dispatches a task with an explicit numeric `args` array to the next worker in round-robin order.
	 */
	dispatchArgs<T = unknown>(
		taskIndex: number,
		args: readonly number[] = [],
		options?: WorkerDispatchOptions
	): Promise<T> {
		if (this.#failureReason) {
			return Promise.reject(this.#failureReason);
		}
		if (this.#isTerminated) {
			return Promise.reject(new Error("WorkerPool has been terminated."));
		}
		if (!this.#isInitialized) {
			return Promise.reject(
				new Error("WorkerPool must be initialized before dispatching tasks.")
			);
		}
		if (this.#workers.length === 0) {
			return Promise.reject(new Error("No active workers available in pool."));
		}
		if (!Number.isInteger(taskIndex) || taskIndex < 0) {
			return Promise.reject(
				new RangeError(`WorkerPool.dispatch: taskIndex must be a non-negative integer, received ${taskIndex}.`)
			);
		}
		if (this.#pendingTasks.size >= this.#maxPendingTasks) {
			return Promise.reject(
				new RangeError(
					`WorkerPool.dispatch: maximum pending tasks (${this.#maxPendingTasks}) exceeded.`
				)
			);
		}

		const signal = options?.signal;
		if (signal?.aborted) {
			return Promise.reject(new Error("WorkerPool task aborted prior to dispatch."));
		}

		const timeoutMs = options?.timeoutMs ?? this.#defaultTimeoutMs;
		if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
			return Promise.reject(
				new RangeError(`WorkerPool.dispatch: timeoutMs must be a positive finite number, received ${timeoutMs}.`)
			);
		}

		const workerIndex = this.#roundRobinIndex;
		const worker = this.#workers[workerIndex];
		this.#roundRobinIndex = (this.#roundRobinIndex + 1) % this.#workers.length;

		const taskId = this.#nextTaskId++;
		const arg0 = args[0] ?? 0;
		const arg1 = args[1] ?? 0;
		const copiedArgs = Array.from(args);

		return new Promise<T>((resolve, reject) => {
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			let onAbort: (() => void) | undefined;

			const cleanup = (): void => {
				if (timeoutHandle !== undefined) {
					clearTimeout(timeoutHandle);
					timeoutHandle = undefined;
				}
				if (signal && onAbort) {
					signal.removeEventListener("abort", onAbort);
					onAbort = undefined;
				}
			};

			if (timeoutMs !== undefined) {
				timeoutHandle = setTimeout(() => {
					const pending = this.#pendingTasks.get(taskId);
					if (!pending) return;
					this.#pendingTasks.delete(taskId);
					cleanup();
					reject(new Error(`WorkerPool task ${taskId} timed out after ${timeoutMs}ms.`));
				}, timeoutMs);
			}

			if (signal) {
				onAbort = () => {
					const pending = this.#pendingTasks.get(taskId);
					if (!pending) return;
					this.#pendingTasks.delete(taskId);
					cleanup();
					reject(new Error(`WorkerPool task ${taskId} was aborted.`));
				};
				signal.addEventListener("abort", onAbort, { once: true });
			}

			const entry: PendingTaskEntry = {
				taskId,
				workerIndex,
				resolve,
				reject,
				cleanup,
			};
			this.#pendingTasks.set(taskId, entry);

			const msg: WorkerTaskMessage = {
				type: "task",
				taskId,
				taskIndex,
				args: copiedArgs,
				arg0,
				arg1,
			};

			try {
				worker.postMessage(msg);
			} catch (err) {
				this.#pendingTasks.delete(taskId);
				cleanup();
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	#failPool(error: Error): void {
		if (this.#isTerminated) {
			return;
		}
		this.#failureReason = error;
		this.#terminateInternal(error);
	}

	#terminateInternal(reason: Error): void {
		this.#isTerminated = true;
		this.#isInitialized = false;
		this.#initPromise = null;

		const pendingEntries = Array.from(this.#pendingTasks.values());
		this.#pendingTasks.clear();

		for (let i = 0; i < pendingEntries.length; i++) {
			const entry = pendingEntries[i];
			entry.cleanup?.();
			entry.reject(reason);
		}

		for (let i = 0; i < this.#workers.length; i++) {
			try {
				this.#workers[i].terminate();
			} catch {
				// Ignore worker termination errors.
			}
		}
		this.#workers.length = 0;
	}

	/**
	 * Terminates all workers and rejects all in-flight tasks with a termination error.
	 * Idempotent.
	 */
	terminate(): void {
		if (this.#isTerminated) {
			return;
		}
		this.#terminateInternal(new Error("WorkerPool terminated before task completion."));
	}

	/** Alias for `terminate()`. */
	dispose(): void {
		this.terminate();
	}

	#handleWorkerMessage(event: { data: WorkerResultMessage }): void {
		const data = event?.data;
		if (!data || typeof data.taskId !== "number") {
			return;
		}

		const pending = this.#pendingTasks.get(data.taskId);
		if (!pending) {
			// Ignore late replies for tasks that already timed out, aborted, or were terminated.
			return;
		}

		this.#pendingTasks.delete(data.taskId);
		pending.cleanup?.();

		if (data.error !== undefined && data.error !== null) {
			pending.reject(new Error(String(data.error)));
		} else {
			pending.resolve(data.result);
		}
	}

	get concurrency(): number {
		return this.#concurrency;
	}

	get maxPendingTasks(): number {
		return this.#maxPendingTasks;
	}

	get pendingTaskCount(): number {
		return this.#pendingTasks.size;
	}

	get isInitialized(): boolean {
		return this.#isInitialized;
	}

	get isTerminated(): boolean {
		return this.#isTerminated;
	}
}
