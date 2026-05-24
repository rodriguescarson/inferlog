import { EventEmitter } from "node:events";
import type { InferenceEvent } from "./types";

/**
 * In-process event bus — the decoupling seam.
 *
 * The chat hot-path only ever does `bus.emit("inference", event)`. It does NOT
 * know or care how that event reaches Postgres. A subscriber (transport.ts)
 * picks it up and ships it. This is the small, honest version of an
 * event-driven pipeline: swapping this bus for Kafka / QStash / SQS / Redis
 * Streams is a one-file change because producers never touch the transport.
 *
 * On serverless we can't rely on a long-lived background consumer, so the
 * default subscriber flushes per-request via `after()` (see transport.ts).
 * The bus still earns its keep: it keeps producers ignorant of the sink and
 * gives us one place to add fan-out (e.g. also emit to a metrics counter).
 */
class InferenceBus extends EventEmitter {
  emitInference(event: InferenceEvent) {
    this.emit("inference", event);
  }
  onInference(handler: (event: InferenceEvent) => void) {
    this.on("inference", handler);
  }
}

const globalForBus = globalThis as unknown as { __inferenceBus?: InferenceBus };

export const inferenceBus =
  globalForBus.__inferenceBus ?? (globalForBus.__inferenceBus = new InferenceBus());
