import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "./supabase";

export interface User {
  id: string;
  name: string;
  email: string;
  picture: string;
  isMock?: boolean;
}

interface AuthContextType {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  googleClientId: string | null;
  signInWithMock: (mockUser: User) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Retrieve client ID from Vite env or dynamic state
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || null
  );

  // Fetch secure GOOGLE_CLIENT_ID dynamically if not provided at build-time
  useEffect(() => {
    if (!googleClientId) {
      fetch("/api/agent/config")
        .then((res) => res.json())
        .then((data) => {
          if (data.googleClientId) {
            setGoogleClientId(data.googleClientId);
          }
        })
        .catch((err) => console.warn("Failed to load Google Client ID dynamically:", err));
    }
  }, [googleClientId]);

  // Initialize auth and listen to state changes from Supabase
  useEffect(() => {
    const savedUser = localStorage.getItem("kidtok_user");
    const savedToken = localStorage.getItem("kidtok_id_token");
    if (savedUser && savedToken) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        setIdToken(savedToken);
      } catch {
        // clear corrupted data
        localStorage.removeItem("kidtok_user");
        localStorage.removeItem("kidtok_id_token");
      }
    }
    setLoading(false);

    // Subscribe to Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        const supabaseUser = session.user;
        const activeToken = session.access_token;
        // Don't overwrite mock tokens, EXCEPT when we are explicitly signing in
        const currentToken = localStorage.getItem("kidtok_id_token");
        if (event !== "SIGNED_IN" && currentToken && currentToken.startsWith("mock-token-")) {
          return;
        }

        const authenticatedUser: User = {
          id: supabaseUser.id,
          name: supabaseUser.user_metadata.full_name || supabaseUser.user_metadata.name || supabaseUser.email || "Google User",
          email: supabaseUser.email || "",
          picture: supabaseUser.user_metadata.avatar_url || supabaseUser.user_metadata.picture || "",
        };
        setUser(authenticatedUser);
        setIdToken(activeToken);
        localStorage.setItem("kidtok_user", JSON.stringify(authenticatedUser));
        localStorage.setItem("kidtok_id_token", activeToken);
      } else {
        const currentToken = localStorage.getItem("kidtok_id_token");
        if (currentToken && !currentToken.startsWith("mock-token-")) {
          setUser(null);
          setIdToken(null);
          localStorage.removeItem("kidtok_user");
          localStorage.removeItem("kidtok_id_token");
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Helper to parse base64 JWT payload (kept for backup or local inspection)
  const parseJwt = (token: string) => {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  };

  // Google login success callback
  useEffect(() => {
    if (!googleClientId || typeof window === "undefined") return;

    // Check if Google GIS is available
    const initGoogleGis = () => {
      const google = (window as any).google;
      if (google?.accounts?.id) {
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: any) => {
            const token = response.credential;
            // Clear any active mock token before signing in to let onAuthStateChange process the actual user session
            localStorage.removeItem("kidtok_user");
            localStorage.removeItem("kidtok_id_token");

            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: token,
            });
            if (error) {
              console.error("Supabase Auth credential exchange failed:", error.message);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Prompt Google One Tap optionally
        google.accounts.id.prompt();
      }
    };

    // If script already loaded, init. Otherwise let __root async load handle it.
    if ((window as any).google?.accounts?.id) {
      initGoogleGis();
    } else {
      const interval = setInterval(() => {
        if ((window as any).google?.accounts?.id) {
          initGoogleGis();
          clearInterval(interval);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [googleClientId]);

  const signInWithMock = (mockUser: User) => {
    const fakeToken = `mock-token-${mockUser.id}`;
    setUser(mockUser);
    setIdToken(fakeToken);
    localStorage.setItem("kidtok_user", JSON.stringify(mockUser));
    localStorage.setItem("kidtok_id_token", fakeToken);
  };

  const signOut = () => {
    setUser(null);
    setIdToken(null);
    localStorage.removeItem("kidtok_user");
    localStorage.removeItem("kidtok_id_token");
    
    // Sign out from Supabase Auth
    supabase.auth.signOut().catch((err) => console.error("Supabase signOut failed:", err));
    
    // Also disable GIS session
    const google = (window as any).google;
    if (google?.accounts?.id && googleClientId) {
      google.accounts.id.disableAutoSelect();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        idToken,
        loading,
        googleClientId,
        signInWithMock,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
