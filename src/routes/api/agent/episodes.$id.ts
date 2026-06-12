import { createFileRoute } from "@tanstack/react-router";

function upstreamBase(): string | null {
  const base = process.env.AGENT_API_URL;
  return base ? base.replace(/\/$/, "") : null;
}

async function proxy(
  method: "GET" | "PATCH",
  id: string,
  request: Request,
): Promise<Response> {
  const base = upstreamBase();
  if (!base) {
    return new Response(
      JSON.stringify({ error: "AGENT_API_URL is not configured on the server." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const authHeader = request.headers.get("Authorization");
    const headers: HeadersInit = {};
    if (authHeader) headers["Authorization"] = authHeader;
    let body: BodyInit | undefined;
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      body = await request.text();
    }
    const upstream = await fetch(
      `${base}/episodes/${encodeURIComponent(id)}`,
      { method, headers, body },
    );
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Could not reach agent backend.",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/agent/episodes/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => proxy("GET", params.id, request),
      PATCH: async ({ params, request }) => proxy("PATCH", params.id, request),
    },
  },
});
