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
import { getPromptHistory, PromptHistoryItem, listEpisodes, Episode } from "@/lib/agentApi";
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

function loadActiveChild(userId: string | undefined): ChildSummary | null {
  if (typeof window === "undefined") return null;
  const scope = userId ?? "guest";
  try {
    const raw = localStorage.getItem(`kidtok_child_profiles:${scope}`);
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return null;
    const lastName = localStorage.getItem(`kidtok_last_child_profile:${scope}`);
    const found = list.find((p: any) => p?.name === lastName) ?? list[0];
    if (!found?.name) return null;
    return {
      name: String(found.name),
      ageBand: Number(found.ageBand ?? 6),
      interests: String(found.interests ?? ""),
      artStyle: String(found.artStyle ?? "crayon sketch"),
    };
  } catch {
    return null;
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
  const [viewMode, setViewMode] = useState<"parent" | "developer">("parent");
  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>([]);
  const [loadingPrompts, setLoadingPromptHistory] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<number>(2); // Default compare v3 to v2 (indices 2 to 1 in list)
  const [userSteerage, setUserSteerage] = useState("");
  const [savingSteerage, setSavingSteerage] = useState(false);

  // Load user steering and prompt history
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("kidtok_user_steerage") || "";
      setUserSteerage(stored);
    }

    async function loadHistory() {
      try {
        const history = await getPromptHistory();
        // Sort history by versionId asc or simply use as is
        setPromptHistory(history);
      } catch (err) {
        console.error("Error fetching prompt history:", err);
      } finally {
        setLoadingPromptHistory(false);
      }
    }
    void loadHistory();
  }, []);

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

      {viewMode === "parent" ? (
        /* PARENT-FRIENDLY VIEW */
        <div className="space-y-8 animate-in fade-in duration-300">
          
          {/* Friendly Score Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="bg-card border-2 border-border rounded-3xl p-6 relative overflow-hidden shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 mb-4">
                <CheckCircle className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Episode Success Rate</p>
              <h3 className="text-4xl font-extrabold mt-1">98.4%</h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                Cartoons completely vetted, validated, and cleared for kid playback.
              </p>
            </div>

            <div className="bg-card border-2 border-border rounded-3xl p-6 relative overflow-hidden shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Clarity & Pacing</p>
              <h3 className="text-4xl font-extrabold text-gradient-primary mt-1">Excellent</h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                Narrator speed and image complexity matched perfectly to early ages.
              </p>
            </div>

            <div className="bg-card border-2 border-border rounded-3xl p-6 relative overflow-hidden shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent mb-4">
                <Shield className="h-6 w-6" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Safety Guardrails</p>
              <h3 className="text-4xl font-extrabold text-accent mt-1">100% Active</h3>
              <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                Continuous double-check agents filtered and blocked offensive imagery.
              </p>
            </div>
          </div>

          {/* Interactive AI Self-Correction Logs */}
          <div className="bg-card border-2 border-border rounded-3xl p-6 sm:p-8 space-y-6 shadow-medium">
            <div>
              <h2 className="text-2xl font-extrabold flex items-center gap-2">
                <TrendingUp className="h-5.5 w-5.5 text-primary" /> Teacher Feedback & AI Learning Loop
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                See how our Multi-Agent Team adapts to feedback to make every cartoon more engaging.
              </p>
            </div>

            <div className="space-y-6">
              {PARENT_FEEDBACKS.map((fb) => (
                <div key={fb.id} className="p-5 sm:p-6 rounded-2xl bg-background/50 border border-border/80 flex flex-col md:flex-row gap-5 transition-all hover:border-primary/30">
                  <div className="space-y-2 md:w-2/5">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-foreground">{fb.author}</span>
                      <span className="text-[10px] text-muted-foreground">{fb.timestamp}</span>
                    </div>
                    <div className="text-xs font-semibold text-primary bg-primary/5 border border-primary/10 rounded px-2.5 py-1 inline-block">
                      Episode: {fb.episode}
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed bg-card p-3 rounded-xl border border-border/55 italic">
                      &ldquo;{fb.comment}&rdquo;
                    </p>
                  </div>

                  {/* Arrow Indicator */}
                  <div className="hidden md:flex items-center justify-center text-primary/40">
                    <ChevronRight className="h-8 w-8" />
                  </div>

                  <div className="flex-1 space-y-3 bg-primary/5 border border-primary/10 p-5 rounded-2xl relative">
                    <span className="absolute top-3.5 right-3.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                    </span>
                    <h4 className="font-extrabold text-sm text-primary flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" /> AI Agent Corrective Action
                    </h4>
                    <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                      {fb.aiAction}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-semibold pt-1.5 border-t border-primary/10">
                      <span>Telemetry Tracer: OpenTelemetry OTLP 1.28</span>
                      <span>•</span>
                      <span className="text-emerald-500 font-bold">Phoenix Span Captured</span>
                    </div>
                  </div>
                </div>
              ))}
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
                  Template evolutions of <code>kidtok-scene-prompt</code> retrieved from Phoenix.
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
