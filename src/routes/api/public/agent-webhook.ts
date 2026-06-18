import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const BodySchema = z.object({
  episodeId: z.string().min(1).max(128),
  userId: z.string().uuid(),
  status: z.enum(["scripting", "planning", "imaging", "narrating", "reviewing", "ready", "failed"]),
  promptVersionUsed: z.string().max(64).nullable().optional(),
  reviewScore: z.number().int().min(0).max(100).nullable().optional(),
});

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Public webhook: the agent-service POSTs episode lifecycle updates here so
// the per-user episode index in Cloud stays in sync with the agent's
// authoritative episode doc. Phoenix remains the source of truth for prompt
// evolution — this just records WHICH prompt version produced each cartoon
// so the per-user UI can show it without trusting the client.
//
// Auth: HMAC-SHA256 over the raw request body, hex-encoded, in the
// `x-agent-signature` header. Shared secret = AGENT_WEBHOOK_SECRET.
export const Route = createFileRoute("/api/public/agent-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.AGENT_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook secret not configured", { status: 503 });
        }
        const signature = request.headers.get("x-agent-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        if (!signature || !safeEqualHex(signature, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (err) {
          return new Response(
            err instanceof Error ? err.message : "Invalid body",
            { status: 400 }
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Only update fields the agent actually sent; preserve existing row data.
        const update: {
          status: string;
          prompt_version_used?: string | null;
          review_score?: number | null;
        } = {
          status: parsed.status,
        };
        if (parsed.promptVersionUsed !== undefined)
          update.prompt_version_used = parsed.promptVersionUsed;
        if (parsed.reviewScore !== undefined)
          update.review_score = parsed.reviewScore;

        const { error } = await supabaseAdmin
          .from("episodes_index")
          .update(update)
          .eq("episode_id", parsed.episodeId)
          .eq("user_id", parsed.userId);

        if (error) {
          console.error("[agent-webhook] update failed", error);
          return new Response("Update failed", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
