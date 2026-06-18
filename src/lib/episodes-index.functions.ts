import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EpisodeIndexRow = {
  episodeId: string;
  childName: string | null;
  topic: string;
  ageBand: number;
  status: string;
  promptVersionUsed: string | null;
  reviewScore: number | null;
  createdAt: string;
  updatedAt: string;
};

export const listMyEpisodeIndex = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EpisodeIndexRow[]> => {
    const { data, error } = await context.supabase
      .from("episodes_index")
      .select(
        "episode_id, child_name, topic, age_band, status, prompt_version_used, review_score, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      episodeId: r.episode_id,
      childName: r.child_name,
      topic: r.topic,
      ageBand: r.age_band,
      status: r.status,
      promptVersionUsed: r.prompt_version_used,
      reviewScore: r.review_score,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

export const recordEpisode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        episodeId: z.string().min(1).max(128),
        childName: z.string().trim().min(1).max(64).nullable().optional(),
        topic: z.string().min(1).max(500),
        ageBand: z.number().int().min(2).max(14),
      })
      .parse(data)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("episodes_index")
      .upsert(
        {
          episode_id: data.episodeId,
          user_id: context.userId,
          child_name: data.childName ?? null,
          topic: data.topic,
          age_band: data.ageBand,
          status: "scripting",
        },
        { onConflict: "episode_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
