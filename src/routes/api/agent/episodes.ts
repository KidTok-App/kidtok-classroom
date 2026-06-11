import { createFileRoute } from "@tanstack/react-router";

function base(): string | null {
  const url = process.env.AGENT_API_URL;
  return url ? url.replace(/\/$/, "") : null;
}

async function forward(path: string, init?: RequestInit): Promise<Response> {
  const b = base();
  if (!b) {
    return new Response(
      JSON.stringify({ error: "AGENT_API_URL is not configured on the server." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const upstream = await fetch(`${b}${path}`, init);
    const body = await upstream.arrayBuffer();
    return new Response(body, {
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

export const Route = createFileRoute("/api/agent/episodes")({
  server: {
    handlers: {
      GET: async () => forward("/episodes"),
      POST: async ({ request }) => {
        const body = await request.text();
        return forward("/episodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      },
    },
  },
});
