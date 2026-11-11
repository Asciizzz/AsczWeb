// ================================================================
//  Awasm - Threading: AtomicQueue (Single-Producer / Single-Consumer)
// ================================================================

const MAX_QUEUE_CAPACITY = 0x40000000;

export interface AtomicQueueOptions {
	/**
	 * When true, zeroes the head and tail sequence counters in shared memory during construction.
	 * Defaults to `false` so attaching a second endpoint in a worker does not reset a live queue.
	 */
	reset?: boolean;
}

/**
 * Lock-free Single-Producer / Single-Consumer (SPSC) circular ring buffer in `SharedArrayBuffer`.
 *
 * Concurrency and memory contract:
 * - Strictly SPSC: at most one producer thread may call `enqueue()` and at most one consumer thread
 *   may call `dequeue()` concurrently. Multi-producer or multi-consumer access is not supported.
 * - Sequence counters (`head` and `tail`) are 32-bit unsigned modular integers (`(tail - head) >>> 0`),
 *   preserving FIFO ordering across both the signed `0x7fffffff` boundary and `0xffffffff` wraparound.
 * - Construction attaches to the shared memory span without resetting counters unless `options.reset` is true
 *   (or `AtomicQueue.initialize(...)` / `reset()` is called prior to concurrent use).
 *
 * Memory layout:
 * - `byteOffset + 0`: Atomic Head sequence counter (4 bytes)
 * - `byteOffset + 4`: Atomic Tail sequence counter (4 bytes)
 * - `byteOffset + 8`: Ring buffer data slots (`capacity * 4` bytes)
 */
export class AtomicQueue {
	readonly #view: Int32Array;
	readonly #headIndex: number;
	readonly #tailIndex: number;
	readonly #dataBaseIndex: number;
	readonly #capacity: number;
	readonly #mask: number;

	constructor(
		buffer: SharedArrayBuffer,
		byteOffset: number,
		capacityPowerOfTwo = 256,
		options?: AtomicQueueOptions
	) {
		if (typeof SharedArrayBuffer === "undefined" || !(buffer instanceof SharedArrayBuffer)) {
			throw new TypeError("AtomicQueue: buffer must be a SharedArrayBuffer.");
		}
		if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % 4 !== 0) {
			throw new RangeError(
				`AtomicQueue: byteOffset must be a non-negative 4-byte-aligned integer, received ${byteOffset}.`
			);
		}
		const required = AtomicQueue.requiredBytes(capacityPowerOfTwo);
		if (byteOffset + required > buffer.byteLength) {
			throw new RangeError(
				`AtomicQueue: queue span [${byteOffset}, ${byteOffset + required}) exceeds SharedArrayBuffer byteLength (${buffer.byteLength}).`
			);
		}

		this.#view = new Int32Array(buffer);
		const base = byteOffset / 4;
		this.#headIndex = base;
		this.#tailIndex = base + 1;
		this.#dataBaseIndex = base + 2;
		this.#capacity = capacityPowerOfTwo;
		this.#mask = capacityPowerOfTwo - 1;

		if (options?.reset) {
			this.reset();
		}
	}

	/**
	 * Creates an `AtomicQueue` and explicitly zeroes its head and tail sequence counters.
	 */
	static initialize(
		buffer: SharedArrayBuffer,
		byteOffset: number,
		capacityPowerOfTwo = 256
	): AtomicQueue {
		return new AtomicQueue(buffer, byteOffset, capacityPowerOfTwo, { reset: true });
	}

	/**
	 * Attaches an `AtomicQueue` to an already initialized shared memory region without resetting counters.
	 */
	static attach(
		buffer: SharedArrayBuffer,
		byteOffset: number,
		capacityPowerOfTwo = 256
	): AtomicQueue {
		return new AtomicQueue(buffer, byteOffset, capacityPowerOfTwo, { reset: false });
	}

	/**
	 * Calculates the total byte size required to host ring buffer metadata and slots (`(2 + capacity) * 4`).
	 */
	static requiredBytes(capacityPowerOfTwo: number): number {
		if (
			!Number.isSafeInteger(capacityPowerOfTwo) ||
			capacityPowerOfTwo < 1 ||
			capacityPowerOfTwo > MAX_QUEUE_CAPACITY ||
			(capacityPowerOfTwo & (capacityPowerOfTwo - 1)) !== 0
		) {
			throw new RangeError(
				`AtomicQueue: capacity must be a power of two in [1, ${MAX_QUEUE_CAPACITY}], received ${capacityPowerOfTwo}.`
			);
		}
		return (2 + capacityPowerOfTwo) * 4;
	}

	/**
	 * Resets both head and tail sequence counters to 0.
	 * Must only be called when no producer or consumer is concurrently accessing the queue.
	 */
	reset(): void {
		Atomics.store(this.#view, this.#headIndex, 0);
		Atomics.store(this.#view, this.#tailIndex, 0);
	}

	/**
	 * Appends a 32-bit signed integer to the ring buffer (producer only).
	 * Returns `false` when full.
	 */
	enqueue(value: number): boolean {
		const head = Atomics.load(this.#view, this.#headIndex) >>> 0;
		const tail = Atomics.load(this.#view, this.#tailIndex) >>> 0;
		const count = (tail - head) >>> 0;

		if (count >= this.#capacity) {
			return false;
		}

		const slotIndex = this.#dataBaseIndex + (tail & this.#mask);
		Atomics.store(this.#view, slotIndex, value | 0);
		Atomics.store(this.#view, this.#tailIndex, (tail + 1) | 0);

		return true;
	}

	/**
	 * Reads and removes the next 32-bit signed integer from the ring buffer (consumer only).
	 * Returns `null` when empty.
	 */
	dequeue(): number | null {
		const head = Atomics.load(this.#view, this.#headIndex) >>> 0;
		const tail = Atomics.load(this.#view, this.#tailIndex) >>> 0;

		if (head === tail) {
			return null;
		}

		const slotIndex = this.#dataBaseIndex + (head & this.#mask);
		const value = Atomics.load(this.#view, slotIndex);
		Atomics.store(this.#view, this.#headIndex, (head + 1) | 0);

		return value;
	}

	/** Current number of queued items (`(tail - head) >>> 0`). */
	get length(): number {
		const head = Atomics.load(this.#view, this.#headIndex) >>> 0;
		const tail = Atomics.load(this.#view, this.#tailIndex) >>> 0;
		return (tail - head) >>> 0;
	}

	/** Maximum number of items the ring buffer can hold. */
	get capacity(): number {
		return this.#capacity;
	}
}

export { AtomicQueue as SpscAtomicQueue };
