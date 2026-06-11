/**
 * Google Cloud clients: Firestore (episode store), Cloud Storage (asset
 * uploads), Cloud Text-to-Speech (narration).
 */

import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type { AssetStorage, EpisodeStore, SpeechSynth } from "./interfaces.js";
import type { EpisodeDoc } from "../types.js";

export class FirestoreEpisodeStore implements EpisodeStore {
  private readonly db: Firestore;
  constructor(
    projectId: string,
    private readonly collection: string,
  ) {
    this.db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  }

  async create(doc: EpisodeDoc): Promise<void> {
    await this.db.collection(this.collection).doc(doc.id).set(doc);
  }

  async update(id: string, patch: Partial<EpisodeDoc>): Promise<void> {
    await this.db.collection(this.collection).doc(id).set(patch, { merge: true });
  }

  async get(id: string): Promise<EpisodeDoc | null> {
    const snap = await this.db.collection(this.collection).doc(id).get();
    return snap.exists ? (snap.data() as EpisodeDoc) : null;
  }

  async list(ownerId?: string, limit = 50): Promise<EpisodeDoc[]> {
    let query: any = this.db.collection(this.collection);
    if (ownerId) {
      query = query.where("ownerId", "==", ownerId);
    }
    const snap = await query.get();
    let docs = snap.docs.map((d: any) => d.data() as EpisodeDoc);
    
    // Sort descending by createdAt in memory to avoid Firestore composite index requirement
    docs.sort((a: EpisodeDoc, b: EpisodeDoc) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    if (limit) {
      docs = docs.slice(0, limit);
    }
    return docs;
  }
}

export class GcsAssetStorage implements AssetStorage {
  private readonly storage: Storage;
  constructor(
    projectId: string,
    private readonly bucket: string,
  ) {
    this.storage = new Storage({ projectId });
  }

  async uploadBuffer(objectPath: string, data: Buffer, contentType: string): Promise<string> {
    const file = this.storage.bucket(this.bucket).file(objectPath);
    await file.save(data, { contentType, resumable: false, metadata: { cacheControl: "public, max-age=31536000" } });
    try {
      // Works when uniform bucket-level access is OFF; otherwise the bucket
      // itself must grant allUsers objectViewer (documented in README).
      await file.makePublic();
    } catch {
      /* uniform bucket-level access — rely on bucket-level public read */
    }
    return `https://storage.googleapis.com/${this.bucket}/${objectPath}`;
  }
}

export class GoogleSpeechSynth implements SpeechSynth {
  private readonly client = new TextToSpeechClient();

  async synthesizeMp3(
    text: string,
    cfg: { voiceName: string; languageCode: string; speakingRate: number; pitch: number },
  ): Promise<Buffer> {
    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: { languageCode: cfg.languageCode, name: cfg.voiceName },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: cfg.speakingRate,
        pitch: cfg.pitch,
      },
    });
    if (!response.audioContent) {
      throw new Error("GOOGLE_TTS_EMPTY: API returned no audioContent");
    }
    return Buffer.from(response.audioContent as Uint8Array);
  }
}
