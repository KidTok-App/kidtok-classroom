import { initTracing, type TracingHandle } from "./tracing.js";
import { loadConfig } from "./config.js";

// Boot config and tracing synchronously before ESM hoists client dependencies!
console.log("[instrumentation] Sync boot of OpenTelemetry...");
const config = loadConfig(process.env);
export const tracingHandle: TracingHandle = initTracing(config);
