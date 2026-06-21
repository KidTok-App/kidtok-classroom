import { supabase } from "./supabase";

export async function getInsights(uid: string, childName: string | null): Promise<string> {
  const kidName = childName || "__default__";
  const { data, error } = await supabase
    .from("child_insights")
    .select("insights_text")
    .eq("owner_id", uid)
    .eq("child_name", kidName)
    .maybeSingle();

  if (error) {
    console.error("[getInsights] error:", error.message);
    return "";
  }
  return data?.insights_text || "";
}

export async function saveInsights(uid: string, childName: string | null, insightsText: string) {
  const kidName = childName || "__default__";

  // Ensure parent profile row exists first to satisfy FK constraint
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: uid }, { onConflict: "id" });

  if (profileError) {
    console.error("[saveInsights] error creating user profile:", profileError.message);
  }

  const { error } = await supabase
    .from("child_insights")
    .upsert({
      owner_id: uid,
      child_name: kidName,
      insights_text: insightsText,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to save insights: ${error.message}`);
  }
}
