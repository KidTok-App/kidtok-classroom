import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export async function getInsights(uid: string, childName: string | null): Promise<string> {
  const docId = childName || "__default__";
  const docRef = doc(db, "users", uid, "childInsights", docId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data().insightsText || "";
  }
  return "";
}

export async function saveInsights(uid: string, childName: string | null, insightsText: string) {
  const docId = childName || "__default__";
  const docRef = doc(db, "users", uid, "childInsights", docId);
  await setDoc(
    docRef,
    {
      insightsText,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
