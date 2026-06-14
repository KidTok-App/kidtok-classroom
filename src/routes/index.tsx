import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sparkles, Zap, Shield, Heart, BookOpen, Film, Presentation, Plus, Trash2, Baby, Smile, LogIn, Lock } from "lucide-react";
import { createEpisode, isApiConfigured } from "@/lib/agentApi";
import { StarSparkle } from "@/components/StarSparkle";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const OMNI_ALLOWED_EMAIL = "wiktor@kidtok.co";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KidTok Classroom — Create a learning cartoon" },
      {
        name: "description",
        content:
          "Type a topic, pick an age, and our multi-agent AI makes an animated educational cartoon for kids 5–8.",
      },
      { property: "og:title", content: "KidTok Classroom" },
      {
        property: "og:description",
        content: "Multi-agent AI that turns any topic into an animated cartoon for kids.",
      },
    ],
  }),
  component: HomePage,
});

const AGES = [5, 6, 7, 8] as const;

const SAMPLE_TOPICS = [
  { label: "Alphabet", emoji: "🅰️", prompt: "Learning the alphabet with fun examples" },
  { label: "Counting", emoji: "🔢", prompt: "Counting from 1 to 20 with friendly animals" },
  { label: "Colors", emoji: "🎨", prompt: "Discovering the rainbow and primary colors" },
  { label: "Animals", emoji: "🐶", prompt: "Meet farm animals and the sounds they make" },
  { label: "Shapes", emoji: "⭐", prompt: "Circles, squares, triangles and stars" },
  { label: "Plants", emoji: "🌱", prompt: "How a tiny seed grows into a tall plant" },
];

interface ChildProfile {
  name: string;
  ageBand: number;
  interests: string;
  artStyle: string;
}

const DEFAULT_PROFILES: ChildProfile[] = [
  {
    name: "Zosia",
    ageBand: 5,
    interests: "dinosaurs, volcanoes, and cookies",
    artStyle: "crayon sketch"
  }
];

function HomePage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [ageBand, setAgeBand] = useState<number>(6);
  const [generationMode, setGenerationMode] = useState<"slides" | "video">("slides");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  // Child Profiles State
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState<number>(5);
  const [newInterests, setNewInterests] = useState("");
  const [newArtStyle, setNewArtStyle] = useState("crayon sketch");
  
  const isLocal = typeof window !== "undefined" && 
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isMockUser = !!(user?.email?.endsWith("@kidtokai.com") || user?.email?.endsWith("@kidtok.co"));
  const canUseOmni = user?.email === OMNI_ALLOWED_EMAIL || isLocal || isMockUser;

  // Per-user storage keys so profiles don't bleed across accounts
  const storageScope = user?.id ?? "guest";
  const profilesKey = `kidtok_child_profiles:${storageScope}`;
  const lastSelectedKey = `kidtok_last_child_profile:${storageScope}`;

  // Load Child Profiles whenever the active user changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(profilesKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setChildProfiles(parsed);
          if (parsed.length === 0) {
            setSelectedChildIdx(null);
            return;
          }
          const lastSelected = localStorage.getItem(lastSelectedKey);
          const idx = parsed.findIndex((p: any) => p.name === lastSelected);
          if (idx !== -1) {
            setSelectedChildIdx(idx);
            setAgeBand(parsed[idx].ageBand);
          } else {
            setSelectedChildIdx(0);
            setAgeBand(parsed[0].ageBand);
          }
          return;
        }
      } catch (e) {
        console.error("Failed to parse child profiles", e);
      }
    }

    // No stored profiles yet for this account.
    // Seed the Zosia demo profile ONLY for the dev/demo accounts so judges
    // see a populated example; real users start with an empty carousel.
    if (isMockUser) {
      setChildProfiles(DEFAULT_PROFILES);
      setSelectedChildIdx(0);
      setAgeBand(DEFAULT_PROFILES[0].ageBand);
    } else {
      setChildProfiles([]);
      setSelectedChildIdx(null);
    }
  }, [profilesKey, lastSelectedKey, isMockUser]);

  const saveProfilesToStorage = (profiles: ChildProfile[]) => {
    setChildProfiles(profiles);
    if (typeof window !== "undefined") {
      localStorage.setItem(profilesKey, JSON.stringify(profiles));
    }
  };

  const selectChild = (idx: number) => {
    setSelectedChildIdx(idx);
    const child = childProfiles[idx];
    if (child) {
      setAgeBand(child.ageBand);
      if (typeof window !== "undefined") {
        localStorage.setItem(lastSelectedKey, child.name);
      }
    }
  };

  const handleAddChild = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Please enter a name!");
      return;
    }
    const isDup = childProfiles.some(p => p.name.toLowerCase() === newName.trim().toLowerCase());
    if (isDup) {
      toast.error("A child profile with this name already exists!");
      return;
    }
    const newProfile: ChildProfile = {
      name: newName.trim(),
      ageBand: newAge,
      interests: newInterests.trim() || "anything fun",
      artStyle: newArtStyle
    };
    const updated = [...childProfiles, newProfile];
    saveProfilesToStorage(updated);
    setSelectedChildIdx(updated.length - 1);
    setAgeBand(newAge);
    if (typeof window !== "undefined") {
      localStorage.setItem(lastSelectedKey, newProfile.name);
    }

    // Reset Form
    setNewName("");
    setNewAge(5);
    setNewInterests("");
    setNewArtStyle("crayon sketch");
    setShowAddForm(false);
    toast.success(`${newProfile.name}'s profile added!`);
  };

  const handleDeleteChild = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const childName = childProfiles[idx]?.name;
    const updated = childProfiles.filter((_, i) => i !== idx);

    saveProfilesToStorage(updated);

    if (updated.length === 0) {
      setSelectedChildIdx(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem(lastSelectedKey);
      }
    } else {
      // Keep selection sensible: pick the first remaining profile
      setSelectedChildIdx(0);
      setAgeBand(updated[0].ageBand);
      if (typeof window !== "undefined") {
        localStorage.setItem(lastSelectedKey, updated[0].name);
      }
    }
    toast.success(`Removed ${childName}'s profile.`);
  };

  const requestSignIn = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kidtok:open-signin"));
    }
  };

  const submit = async (rawTopic: string) => {
    const t = rawTopic.trim();
    if (!t) {
      toast.error("Tell us what to learn about first!");
      return;
    }
    if (!user) {
      toast.error("Sign in to generate a cartoon.");
      requestSignIn();
      return;
    }
    if (!isApiConfigured()) {
      toast.error("Backend not configured. Set VITE_AGENT_API_URL.");
      return;
    }

    const effectiveMode = generationMode === "video" && !canUseOmni ? "slides" : generationMode;
    setSubmitting(true);

    // Retrieve active steering constraints from local storage (set on Self-Improvement page)
    let storedSteerage = "";
    if (typeof window !== "undefined") {
      storedSteerage = localStorage.getItem("kidtok_user_steerage") || "";
    }

    let effectiveChildIdx = selectedChildIdx;
    if (effectiveChildIdx === null && childProfiles.length === 1) {
      effectiveChildIdx = 0;
      toast.info(`Tagging this cartoon for ${childProfiles[0].name}.`);
    } else if (effectiveChildIdx === null && childProfiles.length > 1) {
      toast.error("Pick which child this cartoon is for so the AI can personalize it.");
      setSubmitting(false);
      return;
    }
    const childProfile = effectiveChildIdx !== null ? childProfiles[effectiveChildIdx] : undefined;

    try {
      const { id } = await createEpisode({ 
        topic: t, 
        ageBand, 
        generationMode: effectiveMode,
        userSteerage: canUseOmni ? (storedSteerage || undefined) : undefined,
        childProfile
      });
      navigate({ to: "/episode/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start your cartoon.");
      setSubmitting(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(topic);
  };

  return (
    <div className="relative">
      {/* Hero — full-bleed bloom backdrop, centered content */}
      <section className="bloom-host relative w-full overflow-hidden">
        <Decor />
        <div className="relative mx-auto max-w-5xl px-4 pt-12 sm:pt-20 pb-12 text-center">

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border shadow-soft text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Multi-agent learning studio
          </span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.02] tracking-tight mb-5">
          What should we
          <br />
          <span className="text-gradient-primary">learn today?</span>
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground/90 max-w-xl mx-auto mb-10 leading-relaxed">
          Type any topic. Our AI agents write, draw, and narrate an animated cartoon for your
          classroom in minutes.
        </p>


        <form onSubmit={onSubmit} className="space-y-7 max-w-2xl mx-auto">
          <div className="relative">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Why is the sky blue?"
              maxLength={140}
              className="w-full text-lg sm:text-xl px-6 py-5 rounded-full bg-card border-2 border-border shadow-soft focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition"
              disabled={submitting}
            />
          </div>

          {/* Child Profile Carousel Section — requires sign-in (profiles are per-account) */}
          {!user ? (
            <button
              type="button"
              onClick={requestSignIn}
              className="w-full text-left p-5 rounded-2xl border-2 border-dashed border-border bg-card/50 hover:border-primary/50 hover:bg-card transition-all flex items-center gap-3 cursor-pointer"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                <Baby className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-extrabold text-sm text-foreground">Sign in to personalize cartoons</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Save child profiles, tag each cartoon to the right kid, and let the AI learn what works for them.
                </p>
              </div>
            </button>
          ) : (
          <div className="space-y-4 text-left">

            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Baby className="h-4.5 w-4.5 text-primary" /> Personalized Child Profiles
              </p>
              <button
                type="button"
                onClick={() => setShowAddForm(!showAddForm)}
                className="text-xs font-extrabold text-primary hover:text-primary/80 flex items-center gap-1 transition"
              >
                <Plus className="h-3.5 w-3.5" /> Add Child Profile
              </button>
            </div>

            {showAddForm ? (
              <div className="bg-card border-2 border-primary/20 rounded-3xl p-5 space-y-4 shadow-medium animate-in fade-in zoom-in duration-200">
                <h4 className="font-extrabold text-sm text-foreground flex items-center gap-1.5">
                  <Smile className="h-4 w-4 text-primary" /> Create New Profile
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Child's Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Zosia"
                      className="w-full text-xs p-2.5 rounded-xl bg-background border border-border focus:border-primary transition"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Age</label>
                    <select
                      value={newAge}
                      onChange={(e) => setNewAge(Number(e.target.value))}
                      className="w-full text-xs p-2.5 rounded-xl bg-background border border-border focus:border-primary transition font-bold text-foreground"
                    >
                      {[5, 6, 7, 8].map(age => (
                        <option key={age} value={age}>Age {age}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Interests (influence cartoons!)</label>
                    <input
                      type="text"
                      value={newInterests}
                      onChange={(e) => setNewInterests(e.target.value)}
                      placeholder="e.g. volcanoes, dinosaurs, baking"
                      className="w-full text-xs p-2.5 rounded-xl bg-background border border-border focus:border-primary transition"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Favorite Art Style</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {["crayon sketch", "claymation", "retro cartoon", "watercolor"].map(style => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setNewArtStyle(style)}
                          className={`py-2 rounded-xl text-xs font-bold border transition capitalize ${
                            newArtStyle === style
                              ? "bg-primary/10 border-primary text-primary shadow-soft"
                              : "bg-background border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2.5 justify-end pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 text-xs font-bold rounded-xl border border-border bg-background text-muted-foreground hover:bg-secondary transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddChild}
                    className="px-4 py-2 text-xs font-extrabold rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 transition shadow-soft"
                  >
                    Save Profile
                  </button>
                </div>
              </div>
            ) : childProfiles.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="w-full text-left p-5 rounded-2xl border-2 border-dashed border-border bg-card/50 hover:border-primary/50 hover:bg-card transition-all flex items-center gap-3 cursor-pointer"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                  <Plus className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-extrabold text-sm text-foreground">No child profile yet</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Add your child to personalize cartoons by name, age, interests and art style. You can still create cartoons without one.
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x">
                {childProfiles.map((p, idx) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => selectChild(idx)}
                    className={`relative text-left shrink-0 w-52 p-4 rounded-2xl border-2 cursor-pointer snap-start transition-all shadow-soft group ${
                      selectedChildIdx === idx
                        ? "border-primary bg-primary/5 shadow-medium scale-[1.01]"
                        : "border-border bg-card hover:border-primary/45"
                    }`}
                  >
                    <span
                      onClick={(e) => handleDeleteChild(idx, e)}
                      className="absolute top-2 right-2 text-muted-foreground/30 hover:text-destructive p-1 rounded-lg transition-colors z-10"
                      title={`Delete profile for ${p.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xl">🧒</span>
                      <div>
                        <h4 className="font-extrabold text-sm text-foreground truncate max-w-[110px]">{p.name}</h4>
                        <p className="text-[10px] font-bold text-muted-foreground">Age {p.ageBand}</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground leading-snug line-clamp-1">
                        💖 <span className="font-semibold text-foreground/80">{p.interests}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        🎨 <span className="font-semibold text-foreground/80 capitalize">{p.artStyle}</span>
                      </p>
                    </div>
                    {selectedChildIdx === idx && (
                      <span className="absolute bottom-2.5 right-2.5 bg-primary/10 text-primary text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                        Selected
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}



          {/* Mode Switch Cards */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Generation Mode
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
              <button
                type="button"
                onClick={() => setGenerationMode("slides")}
                disabled={submitting}
                className={`relative flex items-center gap-4 p-4 rounded-3xl border-2 text-left transition-all ${
                  generationMode === "slides"
                    ? "border-primary bg-primary/5 shadow-medium scale-[1.01]"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <div className={`p-3 rounded-2xl ${generationMode === "slides" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Presentation className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm sm:text-base">🎒 Classroom Slides</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">Classic step-by-step cartoon pages with voice narration.</p>
                </div>
                {generationMode === "slides" && (
                  <span className="absolute top-2.5 right-2.5 bg-primary/10 text-primary text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Default
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canUseOmni) return;
                  setGenerationMode("video");
                }}
                disabled={submitting || !canUseOmni}
                aria-disabled={!canUseOmni}
                title={!canUseOmni ? "Coming soon — not part of the hackathon submission" : undefined}
                className={`relative flex items-center gap-4 p-4 rounded-3xl border-2 text-left transition-all ${
                  !canUseOmni
                    ? "border-border bg-muted/40 opacity-60 grayscale cursor-not-allowed"
                    : generationMode === "video"
                      ? "border-accent bg-accent/5 shadow-medium scale-[1.01]"
                      : "border-border bg-card hover:border-accent/50"
                }`}
              >
                <div className={`p-3 rounded-2xl ${!canUseOmni ? "bg-muted text-muted-foreground" : generationMode === "video" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Film className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm sm:text-base">🎬 Omni Movie</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">Contiguous Gemini Omni-video premium animation.</p>
                </div>
                <span className={`absolute top-2.5 right-2.5 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${!canUseOmni ? "bg-muted text-muted-foreground" : "bg-accent/10 text-accent"}`}>
                  {!canUseOmni ? "Coming soon" : "Premium"}
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              For age
              {selectedChildIdx !== null && childProfiles[selectedChildIdx] && (
                <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
                  · locked to {childProfiles[selectedChildIdx].name}'s age ({childProfiles[selectedChildIdx].ageBand})
                </span>
              )}
            </p>
            <div className="flex gap-2">
              {AGES.map((age) => {
                const childLocked = selectedChildIdx !== null && childProfiles[selectedChildIdx] !== undefined;
                const lockedAge = childLocked ? childProfiles[selectedChildIdx!].ageBand : null;
                const isLockedOut = childLocked && age !== lockedAge;
                return (
                  <button
                    key={age}
                    type="button"
                    onClick={() => {
                      if (isLockedOut) {
                        toast.info(`Age is locked to ${childProfiles[selectedChildIdx!].name} (${lockedAge}). Deselect the child profile to pick a different age.`);
                        return;
                      }
                      setAgeBand(age);
                      if (!childLocked) {
                        setSelectedChildIdx(null); // Clear active child selection if custom age selected manually
                      }
                    }}
                    disabled={submitting || isLockedOut}
                    aria-pressed={ageBand === age}
                    aria-disabled={isLockedOut}
                    title={isLockedOut ? `Locked to ${childProfiles[selectedChildIdx!].name}'s age (${lockedAge})` : undefined}
                    className={`h-14 w-14 rounded-2xl font-extrabold text-xl transition-all ${
                      ageBand === age
                        ? "btn-gradient scale-110"
                        : isLockedOut
                          ? "bg-muted/40 border-2 border-border text-muted-foreground opacity-50 cursor-not-allowed"
                          : "bg-card border-2 border-border text-foreground hover:border-primary"
                    }`}
                  >
                    {age}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            {user ? (
              <button
                type="submit"
                disabled={submitting}
                className="btn-gradient hover:[--tw:0] inline-flex items-center gap-2 font-extrabold text-base sm:text-lg px-8 py-4 rounded-full hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0"
              >
                <Sparkles className="h-5 w-5" />
                {submitting ? "Starting…" : "Create cartoon"}
              </button>
            ) : (
              <button
                type="button"
                onClick={requestSignIn}
                className="btn-gradient inline-flex items-center gap-2 font-extrabold text-base sm:text-lg px-8 py-4 rounded-full hover:-translate-y-0.5 active:translate-y-0"
              >
                <Sparkles className="h-5 w-5" />
                Sign in to generate
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                document.getElementById("topics")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 px-6 py-4 rounded-full border-2 border-border bg-card font-bold text-base hover:border-primary transition"
            >
              <BookOpen className="h-5 w-5" />
              Browse topics
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="softchip"><Shield className="h-3.5 w-3.5" /> Parent‑approved</span>
            <span className="softchip"><Zap className="h-3.5 w-3.5 text-primary" /> Ready in minutes</span>
            <span className="softchip"><Heart className="h-3.5 w-3.5 text-accent" /> Kid‑friendly</span>
          </div>
        </form>
        </div>
      </section>

      {/* Popular topics */}
      <section id="topics" className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Try one in a tap
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold">Popular topics</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {SAMPLE_TOPICS.map((t) => (
            <button
              key={t.label}
              type="button"
              disabled={submitting}
              onClick={() => void submit(t.prompt)}
              className="group relative bg-card border-2 border-border rounded-3xl p-4 sm:p-5 text-left hover:border-primary hover:shadow-medium hover:-translate-y-0.5 transition-all"
            >
              <div className="text-3xl sm:text-4xl mb-2 group-hover:scale-110 transition-transform">
                {t.emoji}
              </div>
              <div className="font-extrabold text-sm sm:text-base">{t.label}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Feature row */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FeatureCard icon={<Zap className="h-5 w-5" />} title="Ready fast" body="From topic to cartoon in just a few minutes — no editing required." />
          <FeatureCard icon={<Heart className="h-5 w-5" />} title="Kid‑friendly" body="Age‑appropriate vocabulary, bright art, and a warm narrator voice." />
          <FeatureCard icon={<Shield className="h-5 w-5" />} title="Parent‑approved" body="A reviewer agent checks every cartoon before it reaches the player." />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="bg-card border border-border rounded-3xl p-6 shadow-soft">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
        {icon}
      </div>
      <h3 className="font-extrabold text-lg mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Decor() {
  // Positions as % so they scale well on mobile too.
  const stars: Array<{
    top?: string; bottom?: string; left?: string; right?: string;
    size: number; color: string; delay: string; dur: string;
  }> = [
    { top: "6%",  left: "4%",   size: 26, color: "text-sunshine", delay: "0s",   dur: "2.2s" },
    { top: "12%", left: "22%",  size: 14, color: "text-primary",  delay: "0.4s", dur: "1.8s" },
    { top: "4%",  left: "48%",  size: 18, color: "text-accent",   delay: "0.9s", dur: "2.6s" },
    { top: "10%", right: "20%", size: 16, color: "text-primary",  delay: "1.3s", dur: "2.1s" },
    { top: "8%",  right: "5%",  size: 24, color: "text-sunshine", delay: "0.2s", dur: "2.4s" },
    { top: "30%", left: "8%",   size: 12, color: "text-accent",   delay: "0.7s", dur: "1.7s" },
    { top: "38%", right: "8%",  size: 20, color: "text-accent",   delay: "0.5s", dur: "2.3s" },
    { top: "52%", left: "3%",   size: 18, color: "text-primary",  delay: "1.0s", dur: "2.0s" },
    { top: "58%", right: "4%",  size: 14, color: "text-sunshine", delay: "0.3s", dur: "1.9s" },
    { bottom: "18%", left: "18%", size: 16, color: "text-accent", delay: "1.4s", dur: "2.5s" },
    { bottom: "8%",  left: "42%", size: 12, color: "text-primary",delay: "0.6s", dur: "1.8s" },
    { bottom: "14%", right: "22%",size: 22, color: "text-sunshine",delay: "0.1s",dur: "2.7s" },
    { bottom: "6%",  right: "6%", size: 18, color: "text-accent", delay: "0.8s", dur: "2.0s" },
    { bottom: "26%", left: "30%", size: 10, color: "text-sunshine",delay: "1.2s",dur: "1.6s" },
    { top: "22%", left: "38%",   size: 10, color: "text-primary", delay: "1.5s", dur: "1.7s" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((s, i) => (
        <div
          key={i}
          className={`absolute twinkle ${s.color} drop-shadow-[0_2px_6px_rgba(0,0,0,0.08)]`}
          style={{
            top: s.top,
            bottom: s.bottom,
            left: s.left,
            right: s.right,
            animationDelay: s.delay,
            animationDuration: s.dur,
          }}
        >
          <StarSparkle size={s.size} />
        </div>
      ))}
    </div>
  );
}
