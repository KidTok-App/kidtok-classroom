/**
 * OpenInference / OpenTelemetry tracing → Arize Phoenix.
 *
 * Every pipeline stage runs inside a span; the root span carries the
 * `episodeId` attribute so QualityReviewerAgent can pull THIS episode's spans
 * back out of Phoenix via MCP (get-spans) and grade the run.
 *
 * In fake-provider smoke mode the OTLP exporter is replaced by an in-memory
 * exporter; the fake Phoenix MCP serves the reviewer from that buffer so the
 * full review loop is exercised offline.
 */

import { trace, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import {
  SEMRESATTRS_PROJECT_NAME,
  SemanticConventions,
  OpenInferenceSpanKind,
} from "@arizeai/openinference-semantic-conventions";
import type { ServiceConfig } from "./config.js";
import type { SpanSummary } from "./types.js";

export const SPAN_KIND_ATTR = SemanticConventions.OPENINFERENCE_SPAN_KIND;
export const SPAN_KINDS = OpenInferenceSpanKind;
export const EPISODE_ID_ATTR = "episodeId";

export interface TracingHandle {
  tracer: Tracer;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
  /** Only set in fake-provider mode. */
  memoryExporter?: InMemorySpanExporter;
}

export function initTracing(cfg: ServiceConfig): TracingHandle {
  const resource = new Resource({
    "service.name": "kidtok-agent-service",
    [SEMRESATTRS_PROJECT_NAME]: cfg.phoenixProject,
  });

  const provider = new NodeTracerProvider({ resource });

  let memoryExporter: InMemorySpanExporter | undefined;
  if (cfg.fakeProviders) {
    memoryExporter = new InMemorySpanExporter();
    provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
  } else {
    const exporter = new OTLPTraceExporter({
      url: `${cfg.phoenixHost}/v1/traces`,
      headers: cfg.phoenixApiKey
        ? { api_key: cfg.phoenixApiKey, Authorization: `Bearer ${cfg.phoenixApiKey}` }
        : {},
    });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter, { scheduledDelayMillis: 1000 }));
  }

  provider.register();

  return {
    tracer: trace.getTracer("kidtok-classroom"),
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
    memoryExporter,
  };
}

/** Run `fn` inside a span, recording errors + duration. */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

function hrTimeToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1e6;
}

/** Convert in-memory ReadableSpans to the reviewer's SpanSummary shape (fake mode). */
export function readableSpanToSummary(span: ReadableSpan): SpanSummary {
  const ctx = span.spanContext();
  return {
    name: span.name,
    spanId: ctx.spanId,
    traceId: ctx.traceId,
    startTime: new Date(hrTimeToMs(span.startTime)).toISOString(),
    endTime: new Date(hrTimeToMs(span.endTime)).toISOString(),
    latencyMs: hrTimeToMs(span.duration),
    statusCode: span.status.code === SpanStatusCode.ERROR ? "ERROR" : "OK",
    attributes: { ...span.attributes },
  };
}
