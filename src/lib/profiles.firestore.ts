import { db } from "./firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

export interface ChildProfile {
  name: string;
  ageBand: number;
  interests: string;
  artStyle: string;
}

export async function listChildProfiles(uid: string): Promise<ChildProfile[]> {
  const colRef = collection(db, "users", uid, "childProfiles");
  const q = query(colRef, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      name: data.name || d.id,
      ageBand: typeof data.ageBand === "number" ? data.ageBand : 6,
      interests: Array.isArray(data.interests) ? data.interests.join(", ") : (data.interests || ""),
      artStyle: data.artStyle || "crayon sketch",
    };
  });
}

export async function upsertChildProfile(
  uid: string,
  profile: { name: string; ageBand: number; interests: string; artStyle: string }
) {
  const docRef = doc(db, "users", uid, "childProfiles", profile.name);
  const interestsArray = profile.interests
    ? profile.interests
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const snap = await getDoc(docRef);
  const exists = snap.exists();

  await setDoc(
    docRef,
    {
      name: profile.name,
      ageBand: profile.ageBand,
      interests: interestsArray,
      artStyle: profile.artStyle,
      updatedAt: serverTimestamp(),
      ...(exists ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function deleteChildProfile(uid: string, name: string) {
  const docRef = doc(db, "users", uid, "childProfiles", name);
  await deleteDoc(docRef);
}

export async function getLastSelectedChild(uid: string): Promise<string | null> {
  const docRef = doc(db, "users", uid, "preferences", "app");
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data().lastSelectedChild || null;
  }
  return null;
}

export async function setLastSelectedChild(uid: string, name: string | null) {
  const docRef = doc(db, "users", uid, "preferences", "app");
  await setDoc(
    docRef,
    {
      lastSelectedChild: name,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
