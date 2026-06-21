import { supabase } from "./supabase";

export interface ChildProfile {
  name: string;
  ageBand: number;
  interests: string;
  artStyle: string;
}

export async function listChildProfiles(uid: string): Promise<ChildProfile[]> {
  const { data, error } = await supabase
    .from("child_profiles")
    .select("name, age_band, interests, art_style")
    .eq("owner_id", uid)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listChildProfiles] error:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    name: row.name,
    ageBand: row.age_band,
    interests: row.interests || "",
    artStyle: row.art_style || "crayon sketch",
  }));
}

export async function upsertChildProfile(
  uid: string,
  profile: { name: string; ageBand: number; interests: string; artStyle: string }
) {
  // Ensure parent profile row exists first to satisfy FK constraint
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: uid }, { onConflict: "id" });

  if (profileError) {
    console.error("[upsertChildProfile] error creating user profile:", profileError.message);
  }

  const { error } = await supabase
    .from("child_profiles")
    .upsert({
      owner_id: uid,
      name: profile.name,
      age_band: profile.ageBand,
      interests: profile.interests,
      art_style: profile.artStyle,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to upsert child profile: ${error.message}`);
  }
}

export async function deleteChildProfile(uid: string, name: string) {
  const { error } = await supabase
    .from("child_profiles")
    .delete()
    .eq("owner_id", uid)
    .eq("name", name);

  if (error) {
    throw new Error(`Failed to delete child profile: ${error.message}`);
  }
}

export async function getLastSelectedChild(uid: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("last_selected_child")
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    console.error("[getLastSelectedChild] error:", error.message);
    return null;
  }
  return data?.last_selected_child || null;
}

export async function setLastSelectedChild(uid: string, name: string | null) {
  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: uid,
      last_selected_child: name,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    throw new Error(`Failed to set last selected child: ${error.message}`);
  }
}
