declare module "node:test" {
	export function describe(name: string, fn: () => void | Promise<void>): void;
	export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
	function assert(value: unknown, message?: string): asserts value;
	namespace assert {
		function match(value: string, pattern: RegExp, message?: string): void;
		function ok(value: unknown, message?: string): asserts value;
		function equal<T>(actual: T, expected: T, message?: string): void;
		function notEqual<T>(actual: T, expected: T, message?: string): void;
		function deepEqual(actual: unknown, expected: unknown, message?: string): void;
		function throws(block: () => unknown, error?: RegExp | Function | Object, message?: string): void;
		function rejects(block: (() => Promise<unknown>) | Promise<unknown>, error?: RegExp | Function | Object, message?: string): Promise<void>;
	}
	export default assert;
}

declare module "node:fs" {
	export function cpSync(src: string, dest: string, options?: { recursive?: boolean }): void;
	export function existsSync(path: string): boolean;
	export function mkdtempSync(prefix: string): string;
	export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
	export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
	export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	export function readdirSync(path: string, options?: { withFileTypes?: boolean; recursive?: boolean }): string[];
}

declare module "node:path" {
	export function join(...paths: string[]): string;
	export function resolve(...paths: string[]): string;
	export function dirname(p: string): string;
}

declare module "node:os" {
	export function tmpdir(): string;
}

declare module "node:url" {
	export function fileURLToPath(url: string | URL): string;
	export function pathToFileURL(path: string): URL;
}

declare module "node:child_process" {
	export interface SpawnSyncReturns {
		status: number | null;
		stdout: string;
		stderr: string;
		error?: Error;
	}
	export function spawnSync(
		command: string,
		args?: readonly string[],
		options?: {
			cwd?: string;
			encoding?: "utf8" | "utf-8";
			shell?: boolean;
			env?: Record<string, string | undefined>;
		}
	): SpawnSyncReturns;
}

declare module "node:worker_threads" {
	export class Worker {
		constructor(filename: string | URL, options?: { workerData?: unknown });
		postMessage(value: unknown, transferList?: readonly unknown[]): void;
		on(event: "message", listener: (value: any) => void): this;
		on(event: "error", listener: (err: Error) => void): this;
		on(event: "exit", listener: (exitCode: number) => void): this;
		terminate(): Promise<number>;
	}
	export const parentPort: {
		on(event: "message", listener: (value: any) => void): void;
		postMessage(value: unknown): void;
	} | null;
	export const workerData: any;
}

declare const process: {
	exit(code?: number): never;
	cwd(): string;
	env: Record<string, string | undefined>;
	platform: string;
	stderr: { write(chunk: string): boolean };
	stdout: { write(chunk: string): boolean };
};

declare function setImmediate(callback: (...args: any[]) => void): any;
