import { SharedMemory } from "./shared-memory.js";

export interface WorkerTaskMessage {
    type: "init" | "task" | "terminate";
    taskId?: number;
    module?: WebAssembly.Module;
    memory?: WebAssembly.Memory;
    arg0?: number;
    arg1?: number;
}

export interface WorkerResultMessage {
    taskId: number;
    result: unknown;
    error?: string;
}

/**
 * Multi-threaded worker pool coordinating tasks on shared WebAssembly instances.
 *
 * Class Responsibility:
 * Spawns and manages dedicated Web Workers. Broadcasts compiled modules and
 * SharedMemory handles, and dispatches compute tasks across worker threads.
 *
 * Method Contracts:
 * - initialize(module: WebAssembly.Module, memory: SharedMemory): Injects module and memory into all workers.
 * - dispatch(taskIndex: number, arg0?: number, arg1?: number): Dispatches task to next available worker.
 * - terminate(): Halts and cleans up all active worker threads.
 *
 * Operational Invariants:
 * - Broadcasts WebAssembly.Module and WebAssembly.Memory handles via structured clone.
 * - Workers access linear memory without cross-thread data serialization.
 */
export class WorkerPool {
    private readonly _workers: Worker[];
    private readonly _concurrency: number;
    private _roundRobinIndex: number;
    private _isInitialized: boolean;
    private _pendingTasks: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>;
    private _nextTaskId: number;

    constructor(workerScriptUrl: string | URL, concurrency?: number) {
        const detectedConcurrency =
            typeof navigator !== "undefined" && navigator.hardwareConcurrency
                ? navigator.hardwareConcurrency
                : 4;

        this._concurrency = concurrency ?? detectedConcurrency;
        this._workers = [];
        this._roundRobinIndex = 0;
        this._isInitialized = false;
        this._pendingTasks = new Map();
        this._nextTaskId = 1;

        if (typeof Worker !== "undefined") {
            for (let i = 0; i < this._concurrency; i++) {
                const worker = new Worker(workerScriptUrl, { type: "module" });
                worker.onmessage = this.handleWorkerMessage.bind(this);
                this._workers.push(worker);
            }
        }
    }

    public async initialize(module: WebAssembly.Module, memory: SharedMemory): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        const promises: Promise<void>[] = [];

        for (let i = 0; i < this._workers.length; i++) {
            const worker = this._workers[i];
            const p = new Promise<void>((resolve, reject) => {
                const initId = this._nextTaskId++;
                this._pendingTasks.set(initId, { resolve, reject });

                const msg: WorkerTaskMessage = {
                    type: "init",
                    taskId: initId,
                    module,
                    memory: memory.handle,
                };
                worker.postMessage(msg);
            });
            promises.push(p);
        }

        await Promise.all(promises);
        this._isInitialized = true;
    }

    public dispatch<T = unknown>(taskIndex: number, arg0: number = 0, arg1: number = 0): Promise<T> {
        if (!this._isInitialized) {
            throw new Error("WorkerPool must be initialized with module and shared memory before dispatching tasks");
        }
        if (this._workers.length === 0) {
            throw new Error("No active workers available in pool");
        }

        const worker = this._workers[this._roundRobinIndex];
        this._roundRobinIndex = (this._roundRobinIndex + 1) % this._workers.length;

        const taskId = this._nextTaskId++;
        return new Promise<T>((resolve, reject) => {
            this._pendingTasks.set(taskId, { resolve, reject });

            const msg: WorkerTaskMessage = {
                type: "task",
                taskId,
                arg0: taskIndex,
                arg1,
            };
            worker.postMessage(msg);
        });
    }

    public terminate(): void {
        for (let i = 0; i < this._workers.length; i++) {
            this._workers[i].terminate();
        }
        this._workers.length = 0;
        this._pendingTasks.clear();
        this._isInitialized = false;
    }

    private handleWorkerMessage(event: MessageEvent<WorkerResultMessage>): void {
        const data = event.data;
        if (!data || typeof data.taskId !== "number") {
            return;
        }

        const pending = this._pendingTasks.get(data.taskId);
        if (!pending) {
            return;
        }

        this._pendingTasks.delete(data.taskId);
        if (data.error) {
            pending.reject(new Error(data.error));
        } else {
            pending.resolve(data.result);
        }
    }

    public get concurrency(): number {
        return this._concurrency;
    }

    public get isInitialized(): boolean {
        return this._isInitialized;
    }
}
