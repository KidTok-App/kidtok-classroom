import { db } from "./firebase";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

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
  const colRef = collection(db, "users", uid, "episodesIndex");
  const q = query(colRef, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const episodes = snap.docs.map((d) => {
      const data = d.data();
      return {
        episodeId: d.id,
        childName: data.childName || null,
        topic: data.topic || "",
        ageBand: typeof data.ageBand === "number" ? data.ageBand : 6,
        status: data.status || "scripting",
        promptVersionUsed: data.promptVersionUsed || null,
        reviewScore: typeof data.reviewScore === "number" ? data.reviewScore : null,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate
          ? data.updatedAt.toDate().toISOString()
          : data.updatedAt || new Date().toISOString(),
      };
    });
    callback(episodes);
  });
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
  const docRef = doc(db, "users", uid, "episodesIndex", input.episodeId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    await setDoc(docRef, {
      episodeId: input.episodeId,
      childName: input.childName || null,
      topic: input.topic,
      ageBand: input.ageBand,
      status: "scripting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}
