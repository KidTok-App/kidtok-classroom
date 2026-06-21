import { supabase } from "./supabase";
import { upsertChildProfile } from "./profiles.firestore";
import { User } from "./auth";

export async function runSupabaseMigration(user: User) {
  if (typeof window === "undefined") return;
  const uid = user.id;
  const migrationFlag = `kidtok_supabase_migrated:${uid}`;
  
  if (localStorage.getItem(migrationFlag)) {
    return;
  }

  try {
    // Check if the user document is already marked as migrated in Supabase
    const { data: userProfile, error: fetchError } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", uid)
      .maybeSingle();

    if (fetchError) {
      console.error("[runSupabaseMigration] failed to fetch profile:", fetchError.message);
    }

    if (userProfile && userProfile.display_name) {
      localStorage.setItem(migrationFlag, "true");
      return;
    }

    console.log(`Starting Supabase migration for user: ${uid}`);

    // Create user profile in Supabase profiles table
    const { error: insertError } = await supabase
      .from("profiles")
      .upsert({
        id: uid,
        display_name: user.name,
        email: user.email,
        picture: user.picture,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (insertError) {
      throw new Error(`Failed to create user profile in migration: ${insertError.message}`);
    }

    // Migrate child profiles
    const profilesKey = `kidtok_child_profiles:${uid}`;
    const storedProfiles = localStorage.getItem(profilesKey);
    if (storedProfiles) {
      try {
        const parsed = JSON.parse(storedProfiles);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            if (p && p.name) {
              await upsertChildProfile(uid, {
                name: p.name,
                ageBand: typeof p.ageBand === "number" ? p.ageBand : 6,
                interests: p.interests || "",
                artStyle: p.artStyle || "crayon sketch",
              });
            }
          }
        }
      } catch (e) {
        console.error("Failed to migrate child profiles during migration:", e);
      }
    }

    // Migrate last selected child preference
    const lastSelectedKey = `kidtok_last_child_profile:${uid}`;
    const storedLastSelected = localStorage.getItem(lastSelectedKey);
    if (storedLastSelected) {
      const { error: prefError } = await supabase
        .from("profiles")
        .update({
          last_selected_child: storedLastSelected,
          updated_at: new Date().toISOString(),
        })
        .eq("id", uid);

      if (prefError) {
        console.error("Failed to migrate preference during migration:", prefError.message);
      }
    }

    localStorage.setItem(migrationFlag, "true");
    console.log(`Supabase migration completed for user: ${uid}`);
  } catch (err) {
    console.error("Supabase migration error:", err);
  }
}
