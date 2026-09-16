# Adiag

Structured diagnostic collector, telemetry bus, and causal error tracer. Replaces cross-boundary thrown exceptions with queryable records, bounded ring-buffer history, and pointer-based causal error chains.

---

## Architecture Overview

Adiag structures diagnostics across three core primitives:

1. `Result`: Diagnostic record with category type, machine-readable code, template text, payload data, and causal reference pointer.
2. `Bus`: Diagnostic telemetry bus backed by a fixed-capacity circular ring buffer.
3. Causal chain tracer: Traversal functions generating root cause failure traces across subsystem boundaries.

---

## 1. Diagnostic Records and Logging

`Result` captures structured diagnostics. `Bus` logs records into a pre-allocated circular ring buffer in O(1) time without unbounded memory growth.

```typescript
import { Bus, type Result } from "./index.js";

const bus = new Bus(1000);

// Basic logging
bus.ok({ code: "RENDER_INIT_OK" });

// Warning with template parameters
bus.warn({
    code: "FALLBACK_FORMAT",
    raw: "Target format '$format$' unsupported; using fallback",
    data: { format: "depth32float" },
});

// Error with structured payload
const fileErr = bus.err({
    code: "FILE_NOT_FOUND",
    raw: "Resource '$path$' could not be located",
    data: { path: "models/mesh.bin" },
});
```

- Storage layout: Pre-allocated `#buffer: (Result | null)[]` of length `maxHistory` (default 1000). `#head` tracks the circular insertion index and `#count` tracks total active records. Once `maxHistory` is reached, subsequent additions overwrite the oldest slots in O(1).
- `ok(args)` / `err(args)` / `warn(args)` / `info(args)`: Appends record with corresponding category type (`"ok"`, `"err"`, `"warn"`, `"info"`), returns the created `Result` instance.
- `results`: Getter returning chronological snapshot array ordered from oldest active record to newest.
- `clear()`: Resets `#head` and `#count` to 0 and clears backing buffer slots.

---

## 2. Causal Error Reference Chaining

High-level failures link directly to low-level root causes via the `ref` causal reference pointer.

```typescript
import { Bus } from "./index.js";

const bus = new Bus();

// Root cause: low-level hardware or file failure
const hardwareErr = bus.err({
    code: "BUFFER_CREATION_FAILED",
    raw: "Failed to allocate uniform buffer of size $size$ bytes",
    data: { size: 1048576 },
});

// High-level failure: points to underlying cause via ref
const pipelineErr = bus.err({
    code: "PIPELINE_INIT_FAILED",
    raw: "Failed to initialize pipeline '$name$'",
    data: { name: "ForwardRenderer" },
    ref: hardwareErr, // Causal link
});

// Print formatted causal trace
console.log(Bus.resultToChainMsg(pipelineErr));
// Output:
// Failed to initialize pipeline 'ForwardRenderer'
//   -> Caused by: Failed to allocate uniform buffer of size 1048576 bytes
```

- `Result.ref`: Optional pointer to another `Result` instance, linking downstream orchestrator failures directly to upstream cause.
- `Bus.getCauseChain(result)`: Traverses `ref` pointers into an ordered array starting at `result` down to the root cause. Uses a `Set<Result>` to detect and break circular references safely.
- `Bus.resultToChainMsg(result)`: Formats the entire causal chain into an indented, multi-line error trace:
  ```
  Top-level failure message
    -> Root cause failure message
  ```

---

## 3. Telemetry Queries and Inspection

`Bus` provides non-allocating backward-scanning inspection methods.

```typescript
import { Bus } from "./index.js";

const bus = new Bus();

// Fast status checks
const isClean = bus.allOk();    // true if no errors, warnings, or info
const hasErrors = bus.hasErrs(); // true if at least one error exists
const latestErr = bus.lastErr(); // Retrieves newest error record without allocating arrays

// Filtered array queries
const allErrors = bus.findErrs();
const allWarnings = bus.findWarns();
```

- `last()`: Returns the most recently logged record in O(1).
- `lastErr()`: Scans backwards from current `#head` index to find the most recent record with `type === "err"`. Returns `null` if no errors exist, operating without allocating intermediate arrays.
- `hasErrs()` / `hasWarns()` / `hasInfos()`: Scans backwards from `#head` to check for the presence of specific record types without allocating arrays.
- `allOk()`: Scans backward through active records, returning `false` immediately if any record possesses a type other than `"ok"`.
- `findErrs()` / `findWarns()` / `findInfos()` / `findOk()`: Filters `results` returning arrays of matching category records.

---

## 4. Message Template Compilation

`compileMsg` compiles `$key$` and dot-nested `$key.subkey$` placeholders against structured `data` objects.

```typescript
import { Bus } from "./index.js";

const message = Bus.compileMsg(
    "Shader module '$shader.label$' failed at line $line$:$col$",
    {
        shader: { label: "MainVS" },
        line: 42,
        col: 10,
    }
);
// "Shader module 'MainVS' failed at line 42:10"
```

- `Bus.compileMsg(raw, data)`: Evaluates string templates by matching token patterns `/\$([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\$/g`. Traverses dot-nested property paths on `data`. Automatically extracts `Error.message`, handles primitives, and falls back to JSON serialization for objects.
- `Bus.resultToMsg(result)`: Convenience method compiling `result.raw` against `result.data`.
