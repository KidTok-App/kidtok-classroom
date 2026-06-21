import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { EpisodeStore, UserIndex } from "./interfaces.js";
import type { EpisodeDoc } from "../types.js";

function mapToDb(patch: Partial<EpisodeDoc>) {
  const dbPatch: any = {};
  if (patch.id !== undefined) dbPatch.id = patch.id;
  if (patch.ownerId !== undefined) dbPatch.owner_id = patch.ownerId;
  if (patch.topic !== undefined) dbPatch.topic = patch.topic;
  if (patch.ageBand !== undefined) dbPatch.age_band = patch.ageBand;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.generationMode !== undefined) dbPatch.generation_mode = patch.generationMode;
  if (patch.videoUrl !== undefined) dbPatch.video_url = patch.videoUrl;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.scenes !== undefined) dbPatch.scenes = patch.scenes;
  if (patch.review !== undefined) dbPatch.review = patch.review;
  if (patch.error !== undefined) dbPatch.error = patch.error;
  if (patch.userSteerage !== undefined) dbPatch.user_steerage = patch.userSteerage;
  if (patch.metrics !== undefined) dbPatch.metrics = patch.metrics;
  if (patch.childProfile !== undefined) dbPatch.child_profile = patch.childProfile;
  if (patch.createdAt !== undefined) dbPatch.created_at = patch.createdAt;
  if (patch.updatedAt !== undefined) dbPatch.updated_at = patch.updatedAt;
  return dbPatch;
}

function mapFromDb(row: any): EpisodeDoc {
  return {
    id: row.id,
    ownerId: row.owner_id,
    topic: row.topic,
    ageBand: row.age_band,
    status: row.status,
    generationMode: row.generation_mode || undefined,
    videoUrl: row.video_url || undefined,
    title: row.title || undefined,
    scenes: row.scenes || undefined,
    review: row.review || undefined,
    error: row.error || undefined,
    userSteerage: row.user_steerage || undefined,
    metrics: row.metrics || undefined,
    childProfile: row.child_profile || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseEpisodeStore implements EpisodeStore {
  public readonly client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseServiceRoleKey: string) {
    this.client = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async create(doc: EpisodeDoc): Promise<void> {
    const dbDoc = mapToDb(doc);
    const { error } = await this.client.from("episodes").insert(dbDoc);
    if (error) {
      throw new Error(`[SupabaseEpisodeStore] Failed to create episode: ${error.message}`);
    }
  }

  async update(id: string, patch: Partial<EpisodeDoc>): Promise<void> {
    const dbPatch = mapToDb(patch);
    const { error } = await this.client.from("episodes").update(dbPatch).eq("id", id);
    if (error) {
      throw new Error(`[SupabaseEpisodeStore] Failed to update episode ${id}: ${error.message}`);
    }
  }

  async get(id: string): Promise<EpisodeDoc | null> {
    const { data, error } = await this.client
      .from("episodes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`[SupabaseEpisodeStore] Failed to get episode ${id}: ${error.message}`);
    }
    return data ? mapFromDb(data) : null;
  }

  async list(ownerId?: string, limit = 50): Promise<EpisodeDoc[]> {
    let query = this.client.from("episodes").select("*");
    if (ownerId) {
      query = query.eq("owner_id", ownerId);
    }
    query = query.order("created_at", { ascending: false });
    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`[SupabaseEpisodeStore] Failed to list episodes: ${error.message}`);
    }
    return (data || []).map(mapFromDb);
  }
}

export class SupabaseUserIndex implements UserIndex {
  constructor(private readonly client: SupabaseClient) {}

  async syncEpisode(doc: EpisodeDoc): Promise<void> {
    const ownerId = doc.ownerId;
    if (!ownerId) {
      return;
    }

    const { error } = await this.client.from("episodes_index").upsert({
      episode_id: doc.id,
      owner_id: ownerId,
      child_name: doc.childProfile?.name || "default",
      topic: doc.topic,
      age_band: doc.ageBand,
      status: doc.status,
      prompt_version_used: doc.review?.promptVersionUsed || doc.metrics?.scenePromptVersion || null,
      review_score: doc.review?.score !== undefined ? doc.review.score : null,
      created_at: doc.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error(`[SupabaseUserIndex] Failed to sync index for ${doc.id}:`, error.message);
    } else {
      console.log(`[SupabaseUserIndex] Synced index for episode ${doc.id}`);
    }
  }
}
