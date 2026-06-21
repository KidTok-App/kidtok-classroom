import { supabase } from "./supabase";

export interface EpisodeIndexRow {
  episodeId: string;
  childName: string | null;
  topic: string;
  ageBand: number;
  status: string;
  promptVersionUsed: string | null;
  reviewScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export function subscribeMyEpisodesIndex(
  uid: string,
  callback: (episodes: EpisodeIndexRow[]) => void
) {
  let active = true;

  const fetchAndCallback = async () => {
    const { data, error } = await supabase
      .from("episodes_index")
      .select("*")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[subscribeMyEpisodesIndex] Fetch failed:", error.message);
      return;
    }

    if (!active) return;

    const episodes: EpisodeIndexRow[] = (data || []).map((row) => ({
      episodeId: row.episode_id,
      childName: row.child_name || null,
      topic: row.topic,
      ageBand: row.age_band,
      status: row.status,
      promptVersionUsed: row.prompt_version_used,
      reviewScore: row.review_score,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    callback(episodes);
  };

  // 1. Fetch initial list
  void fetchAndCallback();

  // 2. Setup Realtime subscription
  const channel = supabase
    .channel(`public:episodes_index:owner:${uid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "episodes_index",
        filter: `owner_id=eq.${uid}`,
      },
      () => {
        void fetchAndCallback();
      }
    )
    .subscribe();

  // Return unsubscribe cleanup function
  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export async function recordEpisode(
  uid: string,
  input: {
    episodeId: string;
    childName: string | null;
    topic: string;
    ageBand: number;
  }
) {
  // Safe upsert, since episodes row already exists at this point
  const { error } = await supabase
    .from("episodes_index")
    .upsert({
      episode_id: input.episodeId,
      owner_id: uid,
      child_name: input.childName || null,
      topic: input.topic,
      age_band: input.ageBand,
      status: "scripting",
      updated_at: new Date().toISOString(),
    }, { onConflict: "episode_id" });

  if (error) {
    console.warn("[recordEpisode] warning (might be handled by trigger):", error.message);
  }
}
