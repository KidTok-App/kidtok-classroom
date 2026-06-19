import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { upsertChildProfile } from "./profiles.firestore";
import { User } from "./auth";

export async function runFirebaseMigration(user: User) {
  if (typeof window === "undefined") return;
  const uid = user.id;
  const migrationFlag = `kidtok_firebase_migrated:${uid}`;
  
  if (localStorage.getItem(migrationFlag)) {
    return;
  }

  try {
    // Check if the user document is already marked as migrated in Firestore
    const userDocRef = doc(db, "users", uid);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists() && userSnap.data().profile?.migrated) {
      localStorage.setItem(migrationFlag, "true");
      return;
    }

    console.log(`Starting Firebase migration for user: ${uid}`);

    // Create user profile node in Firestore
    await setDoc(
      userDocRef,
      {
        profile: {
          displayName: user.name,
          email: user.email,
          picture: user.picture,
          createdAt: serverTimestamp(),
          migrated: true,
        },
      },
      { merge: true }
    );

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
      const prefsDocRef = doc(db, "users", uid, "preferences", "app");
      await setDoc(
        prefsDocRef,
        {
          lastSelectedChild: storedLastSelected,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    localStorage.setItem(migrationFlag, "true");
    console.log(`Firebase migration completed for user: ${uid}`);
  } catch (err) {
    console.error("Firebase migration error:", err);
  }
}
