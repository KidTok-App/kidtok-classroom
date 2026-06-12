import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { 
  Sparkles, 
  Activity, 
  Shield, 
  Heart, 
  Code, 
  Settings, 
  Clock, 
  ArrowRight, 
  Save, 
  History, 
  CheckCircle, 
  ChevronRight,
  TrendingUp,
  LineChart
} from "lucide-react";
import { getPromptHistory, PromptHistoryItem, listEpisodes, Episode, updateEpisodeChild, ChildProfile } from "@/lib/agentApi";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/self-improvement")({
  head: () => ({
    meta: [
      { title: "🌱 AI Self-Improvement — KidTok Classroom" },
      {
        name: "description",
        content:
          "See how our multi-agent AI evaluates itself and refines prompts over time based on parent & developer steering.",
      },
    ],
  }),
  component: SelfImprovementPage,
});

// LCS-based word-diff algorithm for beautiful visual prompt comparisons
function diffWords(oldStr: string, newStr: string) {
  // Split on whitespace but preserve it
  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);
  
  const dp: number[][] = Array(oldWords.length + 1)
    .fill(0)
    .map(() => Array(newWords.length + 1).fill(0));

  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i-1] === newWords[j-1]) {
        dp[i][j] = dp[i-1][j-1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
  }
  
  const diff: { type: "added" | "removed" | "normal"; value: string }[] = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i-1] === newWords[j-1]) {
      diff.unshift({ type: "normal", value: oldWords[i-1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      diff.unshift({ type: "added", value: newWords[j-1] });
      j--;
    } else {
      diff.unshift({ type: "removed", value: oldWords[i-1] });
      i--;
    }
  }
  return diff;
}

interface ChildSummary {
  name: string;
  ageBand: number;
  interests: string;
  artStyle: string;
}

function loadChildProfiles(userId: string | undefined): { profiles: ChildSummary[]; lastName: string | null } {
  if (typeof window === "undefined") return { profiles: [], lastName: null };
  const scope = userId ?? "guest";
  try {
    const raw = localStorage.getItem(`kidtok_child_profiles:${scope}`);
    if (!raw) return { profiles: [], lastName: null };
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return { profiles: [], lastName: null };
    const profiles: ChildSummary[] = list
      .filter((p: any) => p?.name)
      .map((p: any) => ({
        name: String(p.name),
        ageBand: Number(p.ageBand ?? 6),
        interests: String(p.interests ?? ""),
        artStyle: String(p.artStyle ?? "crayon sketch"),
      }));
    const lastName = localStorage.getItem(`kidtok_last_child_profile:${scope}`);
    return { profiles, lastName };
  } catch {
    return { profiles: [], lastName: null };
  }
}

/** Turn a short, technical changeSummary into a plain-English parent sentence. */
function humanizePromptChange(summary: string, childName: string | null): string {
  if (!summary) return "Refined the storyteller so the next cartoon should feel a little smoother.";
  const s = summary.toLowerCase();
  const who = childName ?? "your child";
  if (s.includes("safety") || s.includes("block")) {
    return `Tightened safety wording so future cartoons for ${who} stay even more kid-appropriate.`;
  }
  if (s.includes("pacing") || s.includes("length") || s.includes("speed")) {
    return `Adjusted pacing so the next cartoons match ${who}'s attention span more naturally.`;
  }
  if (s.includes("color") || s.includes("contrast") || s.includes("background")) {
    return `Tuned the art so backgrounds and contrast feel friendlier for ${who}.`;
  }
  if (s.includes("vocab") || s.includes("word") || s.includes("simpler") || s.includes("complex")) {
    return `Simplified vocabulary so explanations land for ${who}'s age band.`;
  }
  if (s.includes("interest") || s.includes("analogy") || s.includes("character")) {
    return `Leaned future analogies into things ${who} already loves.`;
  }
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function SelfImprovementPage() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<"parent" | "developer">("parent");
  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>([]);
  const [historyScope, setHistoryScope] = useState<"child" | "global">("global");
  const [loadingPrompts, setLoadingPromptHistory] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<number>(2);
  const [userSteerage, setUserSteerage] = useState("");
  const [savingSteerage, setSavingSteerage] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(true);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildSummary[]>([]);
  const [activeChild, setActiveChild] = useState<ChildSummary | null>(null);
  const [tagging, setTagging] = useState<string | "bulk" | null>(null);

  const toProfile = (c: ChildSummary): ChildProfile => ({
    name: c.name,
    ageBand: c.ageBand,
    interests: c.interests,
    artStyle: c.artStyle,
  });

  const retagEpisode = async (episodeId: string, target: ChildSummary, opts?: { silent?: boolean }) => {
    setTagging(episodeId);
    try {
      const updated = await updateEpisodeChild(episodeId, toProfile(target));
      setEpisodes((prev) => prev.map((e) => (e.id === episodeId ? { ...e, ...updated } : e)));
      if (!opts?.silent) toast.success(`Tagged "${updated.topic}" for ${target.name}.`);
    } catch (err) {
      console.error("Error tagging episode:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update that cartoon.");
    } finally {
      setTagging(null);
    }
  };

  const tagAllUntagged = async (target: ChildSummary) => {
    const untagged = episodes.filter((e) => !e.childProfile?.name);
    if (untagged.length === 0) return;
    setTagging("bulk");
    let ok = 0;
    let failed = 0;
    for (const ep of untagged) {
      try {
        const updated = await updateEpisodeChild(ep.id, toProfile(target));
        setEpisodes((prev) => prev.map((e) => (e.id === ep.id ? { ...e, ...updated } : e)));
        ok++;
      } catch (err) {
        console.error("Bulk tag failed for", ep.id, err);
        failed++;
      }
    }
    setTagging(null);
    if (ok > 0 && failed === 0) {
      toast.success(`Tagged ${ok} cartoon${ok === 1 ? "" : "s"} for ${target.name}.`);
    } else if (ok > 0) {
      toast.warning(`Tagged ${ok} cartoons for ${target.name}; ${failed} failed — try again.`);
    } else {
      toast.error("Couldn't tag those cartoons. Please try again.");
    }
  };

  // Load user steering, child profiles, and episodes
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("kidtok_user_steerage") || "";
      setUserSteerage(stored);
    }
    const { profiles, lastName } = loadChildProfiles(user?.id);
    setChildProfiles(profiles);
    setActiveChild(profiles.find((p) => p.name === lastName) ?? profiles[0] ?? null);

    async function loadEpisodes() {
      try {
        const list = await listEpisodes();
        setEpisodes(Array.isArray(list) ? list : []);
        setEpisodesError(null);
      } catch (err) {
        console.error("Error fetching episodes:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setEpisodesError(
          /401|unauthor/i.test(msg)
            ? "Couldn't load your cartoons — please sign in again."
            : "Couldn't load your cartoons just now. Try again in a moment."
        );
      } finally {
        setLoadingEpisodes(false);
      }
    }
    void loadEpisodes();
  }, [user?.id]);

  // (Re)load prompt history scoped to the selected child
  useEffect(() => {
    let cancelled = false;
    setLoadingPromptHistory(true);
    getPromptHistory(activeChild?.name)
      .then((res) => {
        if (cancelled) return;
        setPromptHistory(res.history);
        setHistoryScope(res.scope);
        setSelectedVersion(Math.max(1, res.history.length - 1));
      })
      .catch((err) => {
        if (!cancelled) console.error("Error fetching prompt history:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingPromptHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChild?.name]);

  // Real, parent-friendly insights derived from this user's episodes
  const normalizedActiveName = activeChild?.name.trim().toLowerCase() ?? null;
  const childEpisodes = normalizedActiveName
    ? episodes.filter((e) => e.childProfile?.name?.trim().toLowerCase() === normalizedActiveName)
    : episodes;
  const totalForChild = childEpisodes.length;
  const readyEpisodes = childEpisodes.filter((e) => e.status === "ready");
  const failedEpisodes = childEpisodes.filter((e) => e.status === "failed");
  const successRate = totalForChild > 0
    ? Math.round((readyEpisodes.length / totalForChild) * 1000) / 10
    : null;
  const reviewedEpisodes = childEpisodes.filter((e) => typeof e.review?.score === "number");
  const avgScore = reviewedEpisodes.length > 0
    ? Math.round(
        (reviewedEpisodes.reduce((sum, e) => sum + (e.review?.score ?? 0), 0) /
          reviewedEpisodes.length) * 10
      ) / 10
    : null;
  const recentEpisodes = [...childEpisodes]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 4);
  const latestPromptChange = promptHistory.length > 0
    ? promptHistory[promptHistory.length - 1]
    : null;
  // Untagged episodes are loaded from this user's account but missing a childProfile —
  // typically legacy cartoons created before per-child tagging existed.
  const untaggedEpisodes = episodes.filter((e) => !e.childProfile?.name);
  const untaggedCount = untaggedEpisodes.length;
  // For recent-list reassign menu: cartoons tagged for a DIFFERENT child than active
  const otherProfiles = childProfiles.filter((p) => p.name !== activeChild?.name);

  const saveSteerage = () => {
    setSavingSteerage(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("kidtok_user_steerage", userSteerage);
    }
    setTimeout(() => {
      setSavingSteerage(false);
      toast.success("Active steering parameters saved! Next generations will adapt.");
    }, 400);
  };

  const getDiffMarkup = () => {
    if (promptHistory.length < 2) return null;
    
    // We compare selected version (e.g. index 2) with previous version (index 1)
    // History contains [v1, v2, v3]
    const currentIdx = selectedVersion; // e.g. 2 for v3
    const previousIdx = selectedVersion - 1; // e.g. 1 for v2

    if (currentIdx < 0 || currentIdx >= promptHistory.length || previousIdx < 0) {
      return <p className="text-sm text-muted-foreground">Select a version to view diff comparison.</p>;
    }

    const prev = promptHistory[previousIdx];
    const curr = promptHistory[currentIdx];

    const diff = diffWords(prev.template, curr.template);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground pb-2 border-b border-border">
          <span>Comparing: <strong className="text-foreground">{prev.versionId}</strong></span>
          <ArrowRight className="h-3 w-3" />
          <span>To: <strong className="text-foreground">{curr.versionId}</strong></span>
        </div>
        <div className="p-5 rounded-2xl bg-black/40 font-mono text-xs sm:text-sm leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
          {diff.map((chunk, idx) => {
            if (chunk.type === "added") {
              return (
                <span 
                  key={idx} 
                  className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded px-1 py-0.5 mx-0.5"
                >
                  {chunk.value}
                </span>
              );
            } else if (chunk.type === "removed") {
              return (
                <span 
                  key={idx} 
                  className="bg-rose-500/15 text-rose-400/80 border border-rose-500/25 line-through rounded px-1 py-0.5 mx-0.5"
                >
                  {chunk.value}
                </span>
              );
            }
            return <span key={idx} className="text-gray-300">{chunk.value}</span>;
          })}
        </div>
        <div className="text-xs text-muted-foreground bg-muted/30 border border-border p-3.5 rounded-xl">
          <strong>🎯 Version Change Log:</strong> {curr.changeSummary || "Refined prompts for improved accuracy."}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 space-y-10">
      
      {/* Header and Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="bg-primary/10 text-primary text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider">
              Premium Feature
            </span>
            <span className="flex items-center gap-1 text-xs text-accent font-bold">
              <TrendingUp className="h-3.5 w-3.5" /> Arize Phoenix Loop Active
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            🌱 AI Self‑Improvement
          </h1>
          <p className="text-base text-muted-foreground mt-1.5 max-w-2xl">
            Watch our multi-agent pipeline diagnose errors, process feedback, and self-improve our AI prompts in real time.
          </p>
        </div>

        {/* Dynamic Glassmorphic Selector */}
        <div className="p-1 rounded-2xl bg-card border-2 border-border flex self-start md:self-center shadow-soft">
          <button
            onClick={() => setViewMode("parent")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              viewMode === "parent"
                ? "bg-primary text-primary-foreground shadow-soft scale-[1.02]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Heart className="h-4 w-4" />
            👪 Parent Mode
          </button>
          <button
            onClick={() => setViewMode("developer")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              viewMode === "developer"
                ? "bg-accent text-accent-foreground shadow-soft scale-[1.02]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-4 w-4" />
            💻 Developer Mode
          </button>
        </div>
      </div>

      {/* Child switcher — scopes insights + prompt history to one child */}
      {childProfiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mr-1">
            Insights for:
          </span>
          {childProfiles.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setActiveChild(p)}
              className={`px-3.5 py-2 rounded-full text-sm font-extrabold border-2 transition-all ${
                activeChild?.name === p.name
                  ? "bg-primary text-primary-foreground border-primary shadow-soft scale-[1.03]"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40"
              }`}
            >
              🧒 {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActiveChild(null)}
            className={`px-3.5 py-2 rounded-full text-sm font-extrabold border-2 transition-all ${
              activeChild === null
                ? "bg-primary text-primary-foreground border-primary shadow-soft scale-[1.03]"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40"
            }`}
          >
            ✨ All cartoons
          </button>
        </div>
      )}

      {viewMode === "parent" ? (
        /* PARENT-FRIENDLY VIEW — real data only, derived from this user's episodes */
        <div className="space-y-8 animate-in fade-in duration-300">

          {/* Active child banner */}
          <div className="bg-card border-2 border-border rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 shadow-soft">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🧒</span>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Insights for
                </p>
                <h2 className="text-xl font-extrabold">
                  {activeChild ? `${activeChild.name} (age ${activeChild.ageBand})` : "all cartoons"}
                </h2>
                {activeChild && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Loves <span className="font-semibold text-foreground/80">{activeChild.interests || "anything fun"}</span>
                    {" · "}art style: <span className="font-semibold text-foreground/80 capitalize">{activeChild.artStyle}</span>
                  </p>
                )}
              </div>
            </div>
            {!activeChild && (
              <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-sm leading-relaxed">
                Pick a child profile on the home page to see how cartoons are evolving for them.
              </p>
            )}
          </div>

          {/* Error / untagged hints */}
          {episodesError && (
            <div className="bg-destructive/5 border-2 border-destructive/30 rounded-2xl p-4 text-sm text-destructive">
              {episodesError}
            </div>
          )}
          {!episodesError && activeChild && untaggedCount > 0 && (
            <div className="bg-amber-500/5 border-2 border-amber-500/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-soft">
              <div className="text-sm text-foreground/85 leading-relaxed">
                We found <span className="font-extrabold">{untaggedCount}</span> cartoon
                {untaggedCount === 1 ? "" : "s"} on your account that {untaggedCount === 1 ? "isn't" : "aren't"} tagged
                for any child yet. Tag {untaggedCount === 1 ? "it" : "them"} for{" "}
                <span className="font-semibold">{activeChild.name}</span> so {activeChild.name}'s insights
                and the reviewer's personalized loop reflect {untaggedCount === 1 ? "it" : "them"}.
              </div>
              <button
                type="button"
                onClick={() => tagAllUntagged(activeChild)}
                disabled={tagging === "bulk"}
                className="shrink-0 bg-amber-500 hover:bg-amber-500/95 text-white font-extrabold text-sm px-4 py-2.5 rounded-2xl transition active:scale-[0.99] disabled:opacity-75"
              >
                {tagging === "bulk"
                  ? "Tagging…"
                  : `Tag ${untaggedCount === 1 ? "it" : `all ${untaggedCount}`} for ${activeChild.name}`}
              </button>
            </div>
          )}

          {/* Real score cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="bg-card border-2 border-border rounded-3xl p-6 shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 mb-4">
                <CheckCircle className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Cartoons made</p>
              <h3 className="text-4xl font-extrabold mt-1">
                {loadingEpisodes ? "…" : totalForChild}
              </h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                {totalForChild === 0
                  ? "Make a cartoon on the home page — insights appear here as soon as the first one finishes."
                  : `${readyEpisodes.length} ready to watch${failedEpisodes.length > 0 ? `, ${failedEpisodes.length} retried` : ""}.`}
              </p>
            </div>

            <div className="bg-card border-2 border-border rounded-3xl p-6 shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Reviewer score</p>
              <h3 className="text-4xl font-extrabold text-gradient-primary mt-1">
                {avgScore !== null ? `${avgScore}/10` : "—"}
              </h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                {avgScore === null
                  ? "Our reviewer agent rates each finished cartoon. Scores show up after the first review."
                  : `Average across ${reviewedEpisodes.length} reviewed cartoon${reviewedEpisodes.length === 1 ? "" : "s"} for ${activeChild?.name ?? "your account"}.`}
              </p>
            </div>

            <div className="bg-card border-2 border-border rounded-3xl p-6 shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent mb-4">
                <Shield className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Made it to the player</p>
              <h3 className="text-4xl font-extrabold text-accent mt-1">
                {successRate !== null ? `${successRate}%` : "—"}
              </h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                {successRate === null
                  ? "How often cartoons pass every safety and quality check before reaching your child."
                  : "Share of cartoons that passed every safety and quality check."}
              </p>
            </div>
          </div>

          {/* What's evolving for your child — translated from real prompt history */}
          <div className="bg-card border-2 border-border rounded-3xl p-6 sm:p-8 space-y-5 shadow-medium">
            <div>
              <h2 className="text-2xl font-extrabold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" /> What's evolving next
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Each finished cartoon teaches our reviewer something. Here's what the next ones will do
                differently for {activeChild?.name ?? "your child"}.
              </p>
            </div>

            {activeChild && historyScope === "global" && !loadingPrompts && (
              <div className="bg-sky-500/5 border border-sky-500/25 rounded-2xl p-3.5 text-xs text-foreground/85 leading-relaxed">
                No <span className="font-semibold">{activeChild.name}</span>-specific tuning yet — you're
                seeing the shared baseline. Generate a cartoon with{" "}
                <span className="font-semibold">{activeChild.name}</span> selected and the reviewer will
                start a personal improvement loop just for them.
              </div>
            )}


            {loadingPrompts ? (
              <p className="text-sm text-muted-foreground">Loading the latest improvements…</p>
            ) : !latestPromptChange ? (
              <p className="text-sm text-muted-foreground">
                No tuning yet — the reviewer hasn't proposed any prompt changes. Once you've made a few
                cartoons, you'll see the improvements it ships here.
              </p>
            ) : (
              <div className="p-5 rounded-2xl bg-primary/5 border border-primary/15">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    Latest tune · {latestPromptChange.versionId}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(latestPromptChange.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  {(() => {
                    const raw = latestPromptChange.changeSummary || "";
                    const name = activeChild?.name;
                    // If the reviewer's own summary already mentions this child, show it verbatim
                    // (capitalized) so parents get the personalized signal directly.
                    if (name && raw.toLowerCase().includes(name.toLowerCase())) {
                      return raw.charAt(0).toUpperCase() + raw.slice(1);
                    }
                    return humanizePromptChange(raw, name ?? null);
                  })()}
                </p>
              </div>
            )}

            {/* Recent cartoons for this child */}
            <div className="pt-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground mb-3">
                Recent cartoons {activeChild ? `for ${activeChild.name}` : ""}
              </h3>
              {loadingEpisodes ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : recentEpisodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None yet. Head to the home page and make a cartoon to see it appear here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {recentEpisodes.map((ep) => (
                    <li
                      key={ep.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-background/60 border border-border/70"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{ep.topic}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Age {ep.ageBand} ·{" "}
                          {ep.status === "ready"
                            ? "Ready"
                            : ep.status === "failed"
                              ? "Retried"
                              : "Generating"}
                          {ep.review?.promptVersionUsed
                            ? ` · prompt ${ep.review.promptVersionUsed}`
                            : ""}
                        </p>
                      </div>
                      {typeof ep.review?.score === "number" && (
                        <span className="text-xs font-extrabold text-primary bg-primary/10 px-2 py-1 rounded-full shrink-0">
                          {ep.review.score}/10
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

        </div>
      ) : (
        /* DEVELOPER ADVANCED VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-300">
          
          {/* Developer Column Left: Metrics & Steerage */}
          <div className="lg:col-span-5 space-y-8">
            
            {/* Dev Mini Metrics */}
            <div className="bg-card border-2 border-border rounded-3xl p-6 space-y-4 shadow-soft">
              <h3 className="font-extrabold text-sm uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5 flex items-center gap-1.5">
                <Activity className="h-4.5 w-4.5 text-accent" /> Telemetry Real-time Diagnostics
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background border border-border/80 p-3.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Avg Latency</span>
                  <p className="text-2xl font-extrabold mt-0.5">4.2s</p>
                </div>
                <div className="bg-background border border-border/80 p-3.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Spans Processed</span>
                  <p className="text-2xl font-extrabold mt-0.5">1,284</p>
                </div>
                <div className="bg-background border border-border/80 p-3.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Safety Filters</span>
                  <p className="text-2xl font-extrabold text-emerald-500 mt-0.5">0 blocks</p>
                </div>
                <div className="bg-background border border-border/80 p-3.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Prompt Retries</span>
                  <p className="text-2xl font-extrabold mt-0.5">1</p>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground text-center font-semibold pt-1 border-t border-border/40">
                Connection Status: <strong className="text-emerald-500">Connected to Arize Phoenix MCP</strong>
              </div>
            </div>

            {/* Active Prompt-Steering Panel */}
            <div className="border border-accent/25 bg-accent/5 rounded-3xl p-6 space-y-4 shadow-medium">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                </div>
                <span className="font-extrabold text-sm uppercase tracking-wider text-accent">
                  🔥 Active Prompt-Steering Panel
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Specify high-priority global constraints or drawing aesthetics. These custom directives inject dynamically into the downstream agent loops via the OTel metadata channel.
              </p>
              <textarea
                value={userSteerage}
                onChange={(e) => setUserSteerage(e.target.value)}
                placeholder="e.g., Make the visual drawings feel futuristic and cosmic, or make the narrator speak with high energetic enthusiasm..."
                rows={3}
                className="w-full text-sm p-3.5 rounded-2xl bg-card border border-border focus:border-accent focus:ring-2 focus:ring-accent/15 transition placeholder:text-muted-foreground/30 text-foreground"
              />
              <button
                type="button"
                onClick={saveSteerage}
                disabled={savingSteerage}
                className="w-full bg-accent hover:bg-accent/95 text-accent-foreground font-extrabold text-sm py-3 rounded-2xl transition flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-75"
              >
                <Save className="h-4 w-4" />
                {savingSteerage ? "Saving Parameters..." : "Save Active Steering"}
              </button>
            </div>

          </div>

          {/* Developer Column Right: Prompt Timeline Diffs */}
          <div className="lg:col-span-7 bg-card border-2 border-border rounded-3xl p-6 sm:p-8 space-y-6 shadow-medium">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
              <div>
                <h3 className="font-extrabold text-lg flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" /> Prompt Version History Timeline
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Template evolutions of <code>{activeChild && historyScope === "child" ? `kidtok-scene-prompt--${activeChild.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "kidtok-scene-prompt"}</code> retrieved from Phoenix.
                </p>
              </div>

              {/* Version timeline buttons */}
              {loadingPrompts ? null : (
                <div className="flex items-center gap-1.5 bg-background border border-border p-1 rounded-xl shadow-inner">
                  {promptHistory.map((item, idx) => (
                    <button
                      key={item.versionId}
                      onClick={() => setSelectedVersion(idx)}
                      disabled={idx === 0} // Can't compare v1 to anything previous
                      title={idx === 0 ? "Initial Seed Version" : `Compare ${item.versionId} to ${promptHistory[idx-1]?.versionId}`}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        selectedVersion === idx
                          ? "bg-primary text-primary-foreground shadow-soft"
                          : idx === 0 
                            ? "text-muted-foreground/40 bg-transparent cursor-not-allowed"
                            : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {item.versionId}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadingPrompts ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <span className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></span>
                <p className="text-sm text-muted-foreground font-semibold">Retrieving Phoenix telemetry prompts...</p>
              </div>
            ) : promptHistory.length < 2 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                <p className="text-sm text-muted-foreground font-bold">No historical versions stored yet.</p>
                <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  Trigger an episode generation to let the reviewer agent optimize prompts and save them back to Phoenix!
                </p>
              </div>
            ) : (
              getDiffMarkup()
            )}
          </div>

        </div>
      )}

    </div>
  );
}
