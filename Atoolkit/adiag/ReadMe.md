# Adiag

Structured diagnostic collector, telemetry bus, and causal error tracer. Provides bounded ring-buffer history, subscriber error isolation, and ID-linked causal chain traversal.

---

## Architecture Overview

Adiag structures diagnostics across three core primitives:

1. `Diagnostic<T>`: Immutable diagnostic record with numeric `id`, `category`, `severity` (`"info"`, `"warn"`, `"error"`), `timestamp`, `message`, optional `data`, and optional causal parent `causeId`.
2. `Bus`: Diagnostic telemetry bus backed by a bounded circular ring buffer with isolated subscriber dispatch.
3. Causal chain tracing: `bus.trace()` traverses `causeId` links across retained history while guarding against cycles, evicted ancestors, and `maxCausalDepth`.

---

## 1. Diagnostic Records and Logging

`Bus` emits `Diagnostic` records, stores them in a bounded ring buffer (default `maxHistory = 256`, or `0` to disable history retention while still notifying live subscribers), and dispatches each record to registered subscribers.

```typescript
import { Bus, type Diagnostic } from "@asciiz/atoolkit/adiag";

const bus = new Bus({ maxHistory: 256 });

// Info diagnostic
bus.info("RENDER_INIT_OK", { backend: "webgpu" });

// Warning diagnostic
bus.warn("FALLBACK_FORMAT", { format: "depth24plus" });

// Error diagnostic
const fileErr: Diagnostic<{ path: string }> = bus.error("FILE_NOT_FOUND", {
	path: "models/mesh.bin",
});
void fileErr;
```

- Constructor options (`BusOptions`):
  - `maxHistory?: number`: Maximum retained records in the ring buffer (must be a non-negative integer; defaults to `256`). When `maxHistory === 0`, no history is retained in memory.
  - `maxCausalDepth?: number`: Maximum number of links traversed by `trace()` (must be a positive integer; defaults to `64`).
  - `onSubscriberError?: (error: unknown, diagnostic: Diagnostic) => void`: Optional handler invoked when a subscriber throws during event dispatch.
- `emit(category, message, data?, cause?, severity?)`: Creates a frozen `Diagnostic` record, appends it to bounded history if `maxHistory > 0`, notifies subscribers, and returns the record.
- `info(message, data?, cause?)` / `warn(message, data?, cause?)` / `error(message, data?, cause?)`: Severity convenience helpers.
- `size`: Current number of diagnostics retained in the history buffer.
- `history()`: Returns a chronological array snapshot ordered from oldest retained record to newest.
- `getById(id)`: Looks up a retained diagnostic by its numeric `id` in O(1).
- `clear()`: Clears retained history and ID lookup index.

---

## 2. Subscriber Isolation

Subscribers receive live diagnostics via `bus.on(subscriber)`. If a subscriber throws, `Bus` catches the exception, forwards it to `onSubscriberError` (if configured), and continues delivering the diagnostic to all remaining subscribers.

```typescript
import { Bus } from "@asciiz/atoolkit/adiag";

const capturedErrors: unknown[] = [];
const capturedLogs: string[] = [];

const bus = new Bus({
	onSubscriberError: (err, diag) => {
		capturedErrors.push({ id: diag.id, err });
	},
});

const unsubscribe = bus.on((diag) => {
	capturedLogs.push(`[${diag.severity}] ${diag.message}`);
});

bus.info("SYSTEM_READY");
unsubscribe();
```

---

## 3. Causal Error Reference Chaining

Downstream failures link to upstream root causes via the `cause` parameter (which accepts either a parent `Diagnostic` object or a numeric diagnostic ID).

```typescript
import { Bus } from "@asciiz/atoolkit/adiag";

const bus = new Bus();

const rootErr = bus.error("BUFFER_ALLOC_FAILED", { requestedBytes: 1048576 });
const passErr = bus.error("PASS_EXEC_FAILED", { pass: "GBuffer" }, rootErr);
const frameErr = bus.emit("fatal", "FRAME_ABORTED", { frame: 42 }, passErr.id, "error");

// Ordered from earliest retained root cause to entryOrId:
// [rootErr, passErr, frameErr]
const chain = bus.trace(frameErr);
void chain;
```

- `trace(entryOrId)`: Follows `causeId` links through retained history and returns `[root, ..., parent, entry]`. Stops cleanly if an ancestor has been evicted from the bounded ring buffer, if a cycle is encountered, or if `maxCausalDepth` is reached.
