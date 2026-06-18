import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProfileInput = z.object({
  name: z.string().trim().min(1).max(64),
  ageBand: z.number().int().min(2).max(14),
  interests: z.string().max(500).default(""),
  artStyle: z.string().max(120).default("crayon sketch"),
});

export type ChildProfileRow = {
  name: string;
  ageBand: number;
  interests: string;
  artStyle: string;
};

export const listChildProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChildProfileRow[]> => {
    const { data, error } = await context.supabase
      .from("child_profiles")
      .select("name, age_band, interests, art_style")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      name: r.name,
      ageBand: r.age_band,
      interests: r.interests ?? "",
      artStyle: r.art_style ?? "crayon sketch",
    }));
  });

export const upsertChildProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ProfileInput.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("child_profiles")
      .upsert(
        {
          user_id: context.userId,
          name: data.name,
          age_band: data.ageBand,
          interests: data.interests,
          art_style: data.artStyle,
        },
        { onConflict: "user_id,name" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChildProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ name: z.string().trim().min(1) }).parse(data)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("child_profiles")
      .delete()
      .eq("name", data.name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getUserPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_preferences")
      .select("last_selected_child")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { lastSelectedChild: data?.last_selected_child ?? null };
  });

export const setLastSelectedChild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ name: z.string().trim().min(1).nullable() }).parse(data)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_preferences")
      .upsert(
        { user_id: context.userId, last_selected_child: data.name },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
