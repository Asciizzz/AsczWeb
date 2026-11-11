// ================================================================
//  Awasm - Runtime: ModuleLoader
// ================================================================

export interface ModuleCacheOptions {
	/**
	 * Optional diagnostic callback invoked when reading or writing the IndexedDB cache fails.
	 * Cache failures are treated as cache misses and do not abort compilation.
	 */
	onCacheError?: (error: unknown) => void;
}

/**
 * WebAssembly binary acquisition and compilation coordinator.
 *
 * Caching and streaming contract:
 * - When given a `Response` or `Promise<Response>`, resolves the `Response` once and clones it prior
 *   to attempting `WebAssembly.compileStreaming`. If `compileStreaming` fails due to environment or
 *   MIME-type restrictions, falls back to compiling the cloned response's `ArrayBuffer`.
 * - Invalid WebAssembly bytecode (`WebAssembly.CompileError`) is propagated directly.
 * - `compileCached` is an optional IndexedDB cache (where supported by the runtime/browser for
 *   `WebAssembly.Module` structured cloning). Callers must include a content hash or version in `key`;
 *   a URL alone does not invalidate stale cached modules.
 */
export class ModuleLoader {
	/**
	 * Compiles a `WebAssembly.Module` from a `BufferSource`, `Response`, or `Promise<Response>`.
	 */
	static async compile(
		source: BufferSource | ArrayBufferView | Response | Promise<Response>
	): Promise<WebAssembly.Module> {
		if (
			typeof Response !== "undefined" &&
			(source instanceof Response || source instanceof Promise)
		) {
			const response = await source;
			if (!response.ok) {
				throw new Error(
					`ModuleLoader.compile: failed to fetch WebAssembly response (HTTP ${response.status} ${response.statusText}).`
				);
			}

			if (typeof WebAssembly.compileStreaming === "function") {
				const fallbackClone =
					typeof response.clone === "function" && !response.bodyUsed
						? response.clone()
						: null;
				try {
					return await WebAssembly.compileStreaming(response);
				} catch (err) {
					if (err instanceof WebAssembly.CompileError || !fallbackClone) {
						throw err;
					}
					const buffer = await fallbackClone.arrayBuffer();
					return await WebAssembly.compile(buffer);
				}
			}

			const buffer = await response.arrayBuffer();
			return await WebAssembly.compile(buffer);
		}

		return await WebAssembly.compile(source as BufferSource);
	}

	/**
	 * Compiles a `WebAssembly.Module` with optional persistent IndexedDB caching.
	 * Note: `key` must uniquely identify the bytecode version/digest.
	 */
	static async compileCached(
		key: string,
		sourceProvider: () => Promise<BufferSource | ArrayBufferView | Response>,
		options?: ModuleCacheOptions
	): Promise<WebAssembly.Module> {
		if (!key || typeof key !== "string") {
			throw new TypeError("ModuleLoader.compileCached: key must be a non-empty string.");
		}

		const cached = await this.#readFromCache(key, options?.onCacheError);
		if (cached) {
			return cached;
		}

		const source = await sourceProvider();
		const compiled = await this.compile(source);

		await this.#writeToCache(key, compiled, options?.onCacheError);

		return compiled;
	}

	static async #readFromCache(
		key: string,
		onCacheError?: (error: unknown) => void
	): Promise<WebAssembly.Module | null> {
		if (typeof indexedDB === "undefined") {
			return null;
		}

		return new Promise((resolve) => {
			try {
				const req = indexedDB.open("awasm_bytecode_cache", 1);
				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains("modules")) {
						db.createObjectStore("modules");
					}
				};
				req.onsuccess = () => {
					const db = req.result;
					let closed = false;
					const closeDb = (): void => {
						if (!closed) {
							closed = true;
							try {
								db.close();
							} catch {
								// Ignore close errors.
							}
						}
					};

					try {
						const tx = db.transaction("modules", "readonly");
						const store = tx.objectStore("modules");
						const getReq = store.get(key);
						tx.oncomplete = () => closeDb();
						tx.onabort = () => closeDb();
						tx.onerror = () => {
							onCacheError?.(tx.error);
							closeDb();
						};
						getReq.onsuccess = () => {
							const val = getReq.result;
							resolve(val instanceof WebAssembly.Module ? val : null);
						};
						getReq.onerror = () => {
							onCacheError?.(getReq.error);
							resolve(null);
						};
					} catch (err) {
						onCacheError?.(err);
						closeDb();
						resolve(null);
					}
				};
				req.onerror = () => {
					onCacheError?.(req.error);
					resolve(null);
				};
			} catch (err) {
				onCacheError?.(err);
				resolve(null);
			}
		});
	}

	static async #writeToCache(
		key: string,
		module: WebAssembly.Module,
		onCacheError?: (error: unknown) => void
	): Promise<void> {
		if (typeof indexedDB === "undefined") {
			return;
		}

		return new Promise((resolve) => {
			try {
				const req = indexedDB.open("awasm_bytecode_cache", 1);
				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains("modules")) {
						db.createObjectStore("modules");
					}
				};
				req.onsuccess = () => {
					const db = req.result;
					let closed = false;
					const closeDb = (): void => {
						if (!closed) {
							closed = true;
							try {
								db.close();
							} catch {
								// Ignore close errors.
							}
						}
					};

					try {
						const tx = db.transaction("modules", "readwrite");
						const store = tx.objectStore("modules");
						store.put(module, key);
						tx.oncomplete = () => {
							closeDb();
							resolve();
						};
						tx.onabort = () => {
							onCacheError?.(tx.error);
							closeDb();
							resolve();
						};
						tx.onerror = () => {
							onCacheError?.(tx.error);
							closeDb();
							resolve();
						};
					} catch (err) {
						onCacheError?.(err);
						closeDb();
						resolve();
					}
				};
				req.onerror = () => {
					onCacheError?.(req.error);
					resolve();
				};
			} catch (err) {
				onCacheError?.(err);
				resolve();
			}
		});
	}
}
