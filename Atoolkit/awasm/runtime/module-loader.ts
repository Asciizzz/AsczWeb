// ================================================================
//  Awasm - Runtime: ModuleLoader
// ================================================================

/**
 * WebAssembly binary acquisition and compilation coordinator.
 * Supports streaming compilation for Response streams and optional IndexedDB bytecode caching.
 */
export class ModuleLoader {
    /**
     * Compiles a WebAssembly module from streaming network responses or in-memory buffers.
     */
    public static async compile(source: BufferSource | Response | Promise<Response>): Promise<WebAssembly.Module> {
        if (typeof Response !== "undefined" && (source instanceof Response || source instanceof Promise)) {
            if (typeof WebAssembly.compileStreaming === "function") {
                try {
                    return await WebAssembly.compileStreaming(source);
                } catch {
                    // Fall back to buffer extraction on streaming failure (e.g. content-type mismatch)
                    const response = await source;
                    const buffer = await response.arrayBuffer();
                    return await WebAssembly.compile(buffer);
                }
            } else {
                const response = await source;
                const buffer = await response.arrayBuffer();
                return await WebAssembly.compile(buffer);
            }
        }

        return await WebAssembly.compile(source as BufferSource);
    }

    /**
     * Compiles a WebAssembly module with persistent IndexedDB bytecode caching across sessions.
     */
    public static async compileCached(
        key: string,
        sourceProvider: () => Promise<BufferSource | Response>
    ): Promise<WebAssembly.Module> {
        const cached = await this.readFromCache(key);
        if (cached) {
            return cached;
        }

        const source = await sourceProvider();
        const compiled = await this.compile(source);

        this.writeToCache(key, compiled).catch(() => {});

        return compiled;
    }

    private static async readFromCache(key: string): Promise<WebAssembly.Module | null> {
        if (typeof indexedDB === "undefined") {
            return null;
        }

        return new Promise((resolve) => {
            try {
                const req = indexedDB.open("awasm_bytecode_cache", 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore("modules");
                };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction("modules", "readonly");
                    const store = tx.objectStore("modules");
                    const getReq = store.get(key);
                    getReq.onsuccess = () => {
                        resolve(getReq.result ?? null);
                    };
                    getReq.onerror = () => resolve(null);
                };
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    private static async writeToCache(key: string, module: WebAssembly.Module): Promise<void> {
        if (typeof indexedDB === "undefined") {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open("awasm_bytecode_cache", 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore("modules");
                };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction("modules", "readwrite");
                    const store = tx.objectStore("modules");
                    store.put(module, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                };
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }
}
