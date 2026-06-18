import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ChildNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .nullable()
  .optional();

export const getInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ childName: ChildNameSchema }).parse(data ?? {})
  )
  .handler(async ({ data, context }) => {
    const childName = data.childName ?? null;
    let q = context.supabase
      .from("child_insights")
      .select("insights_text")
      .eq("user_id", context.userId);
    q = childName === null ? q.is("child_name", null) : q.eq("child_name", childName);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    return { insightsText: row?.insights_text ?? "" };
  });

export const saveInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        childName: ChildNameSchema,
        insightsText: z.string().max(4000),
      })
      .parse(data)
  )
  .handler(async ({ data, context }) => {
    const childName = data.childName ?? null;
    // Manual upsert because PostgREST upsert doesn't honor partial unique
    // indexes the way we'd need for "one default row per user".
    let existsQ = context.supabase
      .from("child_insights")
      .select("id")
      .eq("user_id", context.userId);
    existsQ =
      childName === null
        ? existsQ.is("child_name", null)
        : existsQ.eq("child_name", childName);
    const { data: existing, error: existsErr } = await existsQ.maybeSingle();
    if (existsErr) throw new Error(existsErr.message);

    if (existing?.id) {
      const { error } = await context.supabase
        .from("child_insights")
        .update({ insights_text: data.insightsText })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("child_insights")
        .insert({
          user_id: context.userId,
          child_name: childName,
          insights_text: data.insightsText,
        });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
