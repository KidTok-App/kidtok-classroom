import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent/prompts/history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get("Authorization");
        const base = process.env.AGENT_API_URL;
        if (!base) {
          return new Response(
            JSON.stringify({ error: "AGENT_API_URL is not configured on the server." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        try {
          const headers: HeadersInit = {};
          if (authHeader) headers["Authorization"] = authHeader;
          const upstream = await fetch(
            `${base.replace(/\/$/, "")}/prompts/history`,
            { headers }
          );
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
      },
    },
  },
});
