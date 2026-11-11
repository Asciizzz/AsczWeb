/**
 * Severity level for a diagnostic event.
 */
export type DiagnosticSeverity = "info" | "warn" | "error";

/**
 * Category label for a diagnostic event (for example "info", "warn", "error", or a custom subsystem tag).
 */
export type DiagnosticCategory = string;

/**
 * Legacy alias for DiagnosticCategory.
 */
export type ResultCategory = DiagnosticCategory;

/**
 * Immutable diagnostic record emitted by a Bus.
 *
 * Causal linking uses numeric causeId rather than retaining a direct object reference to the parent
 * Diagnostic, ensuring evicted records are not kept alive by long causal chains.
 * Note: user-supplied data payloads are stored by reference without deep copying.
 */
export interface Diagnostic<T = unknown> {
	/** Monotonically increasing 1-based sequence identifier within the issuing Bus. */
	readonly id: number;
	/** Category tag assigned to this diagnostic. */
	readonly category: DiagnosticCategory;
	/** Severity level of this diagnostic. */
	readonly severity: DiagnosticSeverity;
	/** High-resolution timestamp in milliseconds. */
	readonly timestamp: number;
	/** Human-readable diagnostic message. */
	readonly message: string;
	/** Optional structured payload attached by the caller (stored by reference). */
	readonly data?: T;
	/** Sequence ID of the causal predecessor diagnostic, if one was linked. */
	readonly causeId?: number;
}

/**
 * Compatibility alias for Diagnostic<T>.
 */
export type Result<T = unknown> = Diagnostic<T>;

export type BusListener = (diagnostic: Diagnostic<any>) => void;

export type SubscriberErrorHandler = (error: unknown, diagnostic: Diagnostic<any>) => void;

export interface BusOptions {
	/**
	 * Maximum number of diagnostic records retained in the ring buffer.
	 * Must be a non-negative integer; 0 disables history retention while still notifying subscribers.
	 * Defaults to 256.
	 */
	maxHistory?: number;
	/**
	 * Maximum number of links traversed by trace(). Must be a positive integer.
	 * Defaults to 64.
	 */
	maxCausalDepth?: number;
	/**
	 * Optional callback invoked if a subscriber throws during event dispatch.
	 * Errors thrown by this handler are ignored to prevent recursive diagnostic loops.
	 */
	onSubscriberError?: SubscriberErrorHandler;
}

const now = (): number =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Bounded ring-buffer diagnostic bus with isolated subscriber dispatch and ID-based causal tracing.
 */
export class Bus {
	readonly #buffer: Array<Diagnostic<any> | undefined>;
	readonly #maxHistory: number;
	readonly #maxCausalDepth: number;
	readonly #byId = new Map<number, Diagnostic<any>>();
	#head = 0;
	#count = 0;
	#seq = 0;
	readonly #listeners = new Set<BusListener>();
	#onSubscriberError?: SubscriberErrorHandler;

	constructor(options: number | BusOptions = 256) {
		const opts: BusOptions = typeof options === "number" ? { maxHistory: options } : options;
		const maxHistory = opts.maxHistory ?? 256;
		const maxCausalDepth = opts.maxCausalDepth ?? 64;

		if (!Number.isInteger(maxHistory) || maxHistory < 0) {
			throw new RangeError(`Bus: maxHistory must be a non-negative integer, got ${maxHistory}.`);
		}
		if (!Number.isInteger(maxCausalDepth) || maxCausalDepth < 1) {
			throw new RangeError(`Bus: maxCausalDepth must be a positive integer, got ${maxCausalDepth}.`);
		}

		this.#maxHistory = maxHistory;
		this.#maxCausalDepth = maxCausalDepth;
		this.#buffer = new Array<Diagnostic<any> | undefined>(maxHistory);
		this.#onSubscriberError = opts.onSubscriberError;
	}

	/** Maximum number of records retained in history. */
	get maxHistory(): number {
		return this.#maxHistory;
	}

	/** Current number of retained records in the ring buffer. */
	get size(): number {
		return this.#count;
	}

	/** Sets or clears the handler invoked when a subscriber throws. */
	setSubscriberErrorHandler(handler?: SubscriberErrorHandler): void {
		this.#onSubscriberError = handler;
	}

	#add<T>(
		category: DiagnosticCategory,
		severity: DiagnosticSeverity,
		message: string,
		data?: T,
		cause?: Diagnostic<any> | number
	): Diagnostic<T> {
		let causeId: number | undefined;
		if (typeof cause === "number") {
			if (Number.isInteger(cause) && cause > 0) {
				causeId = cause;
			}
		} else if (cause !== undefined && cause !== null && typeof cause.id === "number") {
			if (Number.isInteger(cause.id) && cause.id > 0) {
				causeId = cause.id;
			}
		}

		const record: Diagnostic<T> = Object.freeze({
			id: ++this.#seq,
			category,
			severity,
			timestamp: now(),
			message,
			data,
			causeId,
		});

		if (this.#maxHistory > 0) {
			if (this.#count === this.#maxHistory) {
				const evicted = this.#buffer[this.#head];
				if (evicted !== undefined) {
					this.#byId.delete(evicted.id);
				}
			} else {
				this.#count++;
			}
			this.#buffer[this.#head] = record;
			this.#byId.set(record.id, record);
			this.#head = (this.#head + 1) % this.#maxHistory;
		}

		if (this.#listeners.size > 0) {
			const snapshot = Array.from(this.#listeners);
			for (let i = 0; i < snapshot.length; i++) {
				const listener = snapshot[i];
				if (!this.#listeners.has(listener)) {
					continue;
				}
				try {
					listener(record);
				} catch (err) {
					if (this.#onSubscriberError) {
						try {
							this.#onSubscriberError(err, record);
						} catch {
							// Prevent recursive error storms if the error handler itself throws.
						}
					}
				}
			}
		}

		return record;
	}

	/** Emits an informational diagnostic. */
	info<T = unknown>(message: string, data?: T, cause?: Diagnostic<any> | number): Diagnostic<T> {
		return this.#add("info", "info", message, data, cause);
	}

	/** Emits a warning diagnostic. */
	warn<T = unknown>(message: string, data?: T, cause?: Diagnostic<any> | number): Diagnostic<T> {
		return this.#add("warn", "warn", message, data, cause);
	}

	/** Emits an error diagnostic. */
	error<T = unknown>(message: string, data?: T, cause?: Diagnostic<any> | number): Diagnostic<T> {
		return this.#add("error", "error", message, data, cause);
	}

	/** Emits a diagnostic with a custom category and optional severity (defaulting to "info"). */
	emit<T = unknown>(
		category: DiagnosticCategory,
		message: string,
		data?: T,
		cause?: Diagnostic<any> | number,
		severity?: DiagnosticSeverity
	): Diagnostic<T> {
		const resolvedSeverity: DiagnosticSeverity =
			severity ?? (category === "error" || category === "warn" ? category : "info");
		return this.#add(category, resolvedSeverity, message, data, cause);
	}

	/** Subscribes a listener to all future diagnostics. Returns an unsubscribe function. */
	on(listener: BusListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** Retrieves a currently retained diagnostic by its sequence ID, or undefined if evicted/unknown. */
	getById(id: number): Diagnostic<any> | undefined {
		return this.#byId.get(id);
	}

	/** Returns all currently retained diagnostics in chronological order (oldest to newest). */
	history(): Diagnostic<any>[] {
		if (this.#count === 0 || this.#maxHistory === 0) {
			return [];
		}
		const result = new Array<Diagnostic<any>>(this.#count);
		const start = this.#count < this.#maxHistory ? 0 : this.#head;
		for (let i = 0; i < this.#count; i++) {
			result[i] = this.#buffer[(start + i) % this.#maxHistory]!;
		}
		return result;
	}

	/**
	 * Reconstructs the retained causal chain leading up to entryOrId, ordered from earliest
	 * retained root cause to entryOrId.
	 * Stops if a predecessor was evicted from the ring buffer, if a cycle is detected, or if
	 * maxCausalDepth is reached.
	 */
	trace(entryOrId: Diagnostic<any> | number): Diagnostic<any>[] {
		const startRecord = typeof entryOrId === "number" ? this.#byId.get(entryOrId) : entryOrId;
		if (!startRecord) {
			return [];
		}

		const chain: Diagnostic<any>[] = [];
		const visited = new Set<number>();
		let curr: Diagnostic<any> | undefined = startRecord;

		while (curr && chain.length < this.#maxCausalDepth) {
			if (visited.has(curr.id)) {
				break;
			}
			visited.add(curr.id);
			chain.push(curr);
			if (curr.causeId === undefined) {
				break;
			}
			curr = this.#byId.get(curr.causeId);
		}

		return chain.reverse();
	}

	/** Clears all retained diagnostics from the ring buffer. */
	clear(): void {
		this.#buffer.fill(undefined);
		this.#byId.clear();
		this.#head = 0;
		this.#count = 0;
	}
}
