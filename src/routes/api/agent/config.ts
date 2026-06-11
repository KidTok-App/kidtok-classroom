import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent/config")({
  server: {
    handlers: {
      GET: async () => {
        const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || null;
        return new Response(
          JSON.stringify({ googleClientId }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
});
