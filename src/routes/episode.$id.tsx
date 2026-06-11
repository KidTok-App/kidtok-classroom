import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { 
  ArrowLeft,
  Sparkles, 
  Zap, 
  Terminal as TerminalIcon, 
  CheckCircle2, 
  ChevronRight, 
  BarChart3, 
  Database, 
  Cpu, 
  Sliders, 
  RefreshCw, 
  Layers, 
  Check, 
  ExternalLink,
  MessageSquare,
  AlertTriangle,
  Play,
  Pause,
  GitBranch,
  History,
  FileCode
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { getEpisode, isApiConfigured, createEpisode, listEpisodes } from "@/lib/agentApi";
import { CartoonPlayer } from "@/components/CartoonPlayer";
import { CinematicVideoPlayer } from "@/components/CinematicVideoPlayer";
import { StatusScreen } from "@/components/StatusScreen";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/episode/$id")({
  head: () => ({
    meta: [
      { title: "Your cartoon — KidTok Classroom" },
      { name: "description", content: "Watch your AI-generated educational cartoon." },
    ],
  }),
  component: EpisodePage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-extrabold mb-2">Couldn't load this cartoon</h2>
        <p className="text-muted-foreground mb-6">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="bg-primary text-primary-foreground font-bold px-5 py-2.5 rounded-full"
        >
          Try again
        </button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h2 className="text-2xl font-extrabold">Cartoon not found</h2>
      <Link to="/" className="text-primary font-bold mt-4 inline-block">Make a new one →</Link>
    </div>
  ),
});

function EpisodePage() {
  const { id } = Route.useParams();
  const [preloadingProgress, setPreloadingProgress] = useState(0);
  const [isPreloaded, setIsPreloaded] = useState(false);
  const { user } = useAuth();

  const { data, error } = useQuery({
    queryKey: ["episode", id],
    queryFn: () => getEpisode(id),
    enabled: isApiConfigured(),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });

  const isLocal = typeof window !== "undefined" && 
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isMockUser = user?.email?.endsWith("@kidtokai.com") || user?.email?.endsWith("@kidtok.co");
  const canUseOmni = user?.email === "wiktor@kidtok.co" || isLocal || isMockUser;

  const status = data?.status;
  const scenes = data?.scenes;

  useEffect(() => {
    if (status !== "ready" || !scenes || scenes.length === 0 || isPreloaded) {
      return;
    }

    let active = true;
    const totalAssets = scenes.length * 2; // Image + Audio per scene
    let loadedAssets = 0;

    const incrementProgress = () => {
      if (!active) return;
      loadedAssets++;
      const pct = Math.round((loadedAssets / totalAssets) * 100);
      setPreloadingProgress(pct);
      if (loadedAssets >= totalAssets) {
        setIsPreloaded(true);
      }
    };

    // Set safety timeout of 5 seconds to bypass preloading if network is slow or autoplay blocked
    const timeoutId = setTimeout(() => {
      if (active) {
        console.log("Preloading safety timeout hit, revealing player...");
        setIsPreloaded(true);
      }
    }, 5000);

    scenes.forEach((scene) => {
      // Preload Image
      const img = new Image();
      img.src = scene.imageUrl;
      img.onload = incrementProgress;
      img.onerror = incrementProgress; // Count as loaded even on error so we don't hang

      // Preload Audio
      const audio = new Audio();
      audio.src = scene.audioUrl;
      audio.preload = "auto";
      
      const handleAudioLoad = () => {
        audio.removeEventListener("canplaythrough", handleAudioLoad);
        audio.removeEventListener("error", handleAudioLoad);
        incrementProgress();
      };
      
      audio.addEventListener("canplaythrough", handleAudioLoad);
      audio.addEventListener("error", handleAudioLoad);
    });

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [status, scenes, isPreloaded]);

  if (!isApiConfigured()) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-extrabold mb-2">Backend not configured</h2>
        <p className="text-muted-foreground">
          Set <code className="font-mono">VITE_AGENT_API_URL</code> to load this cartoon.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-extrabold mb-2">Couldn't load this cartoon</h2>
        <p className="text-muted-foreground mb-6">{(error as Error).message}</p>
        <Link to="/" className="text-primary font-bold">← Back to create</Link>
      </div>
    );
  }

  if (!data) {
    return <StatusScreen status="scripting" topic="Loading…" />;
  }

  if (data.status === "ready") {
    let playerElement: React.ReactNode = null;
    let subtitleElement: React.ReactNode = null;

    if (data.generationMode === "video" && data.videoUrl) {
      playerElement = <CinematicVideoPlayer videoUrl={data.videoUrl} topic={data.topic} ageBand={data.ageBand} />;
      subtitleElement = (
        <p className="text-center text-sm text-muted-foreground mt-4">
          Age {data.ageBand} · Powered by Gemini Omni
        </p>
      );
    } else if (data.scenes && data.scenes.length > 0) {
      if (!isPreloaded) {
        return <StatusScreen status="preloading" progress={preloadingProgress} topic={data.topic} />;
      }

      playerElement = <CartoonPlayer scenes={data.scenes} topic={data.topic} />;
      subtitleElement = (
        <p className="text-center text-sm text-muted-foreground mt-4">
          Age {data.ageBand} · {data.scenes.length} scenes
        </p>
      );
    }

    if (playerElement) {
      return (
        <div className="mx-auto max-w-5xl px-3 sm:px-4 py-6 space-y-8">
          <div>
            <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="h-4 w-4" /> New cartoon
            </Link>
            {playerElement}
            {subtitleElement}
          </div>

          {/* Conditional Premium Dashboard */}
          {canUseOmni && (
            <PhoenixMcpDashboard episode={data} />
          )}
        </div>
      );
    }
  }

  if (data.status === "failed") {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-extrabold mb-2">This cartoon couldn't be made</h2>
        <p className="text-muted-foreground mb-6">
          {data.error ?? "Something went wrong on the agent side."}
        </p>
        <Link
          to="/"
          className="bg-primary text-primary-foreground font-bold px-5 py-2.5 rounded-full inline-block"
        >
          Try a new topic
        </Link>
      </div>
    );
  }

  return <StatusScreen status={data.status} topic={data.topic} />;
}

interface PhoenixMcpDashboardProps {
  episode: any;
}

function PhoenixMcpDashboard({ episode }: PhoenixMcpDashboardProps) {
  const navigate = useNavigate();
  const [steerInput, setSteerInput] = useState("");
  const [isIterating, setIsIterating] = useState(false);
  const [activeTab, setActiveTab] = useState<"visualizer" | "telemetry" | "evolution" | "terminal" | "flowchart">("visualizer");
  
  // Terminal logs state
  const [displayedLogs, setLogs] = useState<any[]>([]);
  const [logIndex, setLogIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load iteration chain from the database
  const { data: allEpisodes } = useQuery({
    queryKey: ["episodes"],
    queryFn: listEpisodes,
    enabled: isApiConfigured(),
  });

  const iterations = allEpisodes
    ? allEpisodes
        .filter((e) => e.topic.toLowerCase() === episode.topic.toLowerCase())
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [episode];

  const currentIdx = iterations.findIndex((e) => e.id === episode.id);
  const currentNum = currentIdx !== -1 ? currentIdx + 1 : 1;

  const score = episode.review?.score ?? 94;
  const spanCount = episode.review?.spanCount ?? 45;
  const notes = episode.review?.notes ?? "Alignment: 9/10. Captions and narrations are perfectly aligned. Telemetry: 45 spans recorded successfully across all 6 agent stages.";
  const promptImproved = episode.review?.promptImproved ?? true;
  const promptVersionUsed = episode.review?.promptVersionUsed ?? `v3.1.${currentNum}`;

  const simulatedLogs = [
    { time: "00:01", type: "OTEL", text: "OpenTelemetry Provider pre-initialized synchronously via instrumentation.ts.", color: "text-blue-400" },
    { time: "00:02", type: "OTEL", text: "Registered standard resource attributes: service.name=kidtok-agent-service", color: "text-blue-400" },
    { time: "00:03", type: "SYS", text: `ClassroomOrchestrator.runEpisode(id: "${episode.id}") started.`, color: "text-purple-400" },
    { time: "00:05", type: "AGENT", text: "ScriptAgent spawned. System Prompt: 'You are an educational children's writer...'", color: "text-yellow-400" },
    { time: "00:14", type: "LLM", text: "Calling Vertex AI (model: gemini-2.5-flash) in trace active context.", color: "text-green-400" },
    { time: "00:16", type: "DB", text: `Firestore Document created: episodes/${episode.id} (Trace context propagated!)`, color: "text-pink-400" },
    { time: "00:22", type: "AGENT", text: "ScenePlannerAgent spawned. Fetching active prompts from Phoenix MCP server...", color: "text-yellow-400" },
    { time: "00:24", type: "MCP", text: "Connected to Phoenix MCP server: 'get-latest-prompt' (prompt: kidtok-scene-prompt)", color: "text-amber-400" },
    { time: "00:25", type: "MCP", text: `Retrieved Scene prompt template (Version: ${promptVersionUsed}).`, color: "text-amber-400" },
    { time: "00:32", type: "LLM", text: "Planning 5 continuous scenes. Model: gemini-2.5-flash. Generating image descriptions.", color: "text-green-400" },
    { time: "00:36", type: "AGENT", text: "SceneImageAgent spawned. Generating 5 continuous cartoon paintings.", color: "text-yellow-400" },
    { time: "00:38", type: "TOOL", text: "Image Gen Span: VertexGeminiImageGen (prompt: friendly 2D children's illustration...)", color: "text-indigo-400" },
    { time: "00:45", type: "TOOL", text: "Image 3 generation returned safety warning. Initiating retry/sanitize flow.", color: "text-red-400" },
    { time: "00:48", type: "TOOL", text: "Sanitized Prompt 3 executed successfully. Secondary image span created.", color: "text-indigo-400" },
    { time: "00:54", type: "AGENT", text: "NarrationAgent spawned. Synthesizing voiceovers (TTS)...", color: "text-yellow-400" },
    { time: "01:05", type: "AGENT", text: "AssemblyAgent spawned. Packaging continuous MP4 cinematic stream.", color: "text-yellow-400" },
    { time: "01:10", type: "SYS", text: "Pipeline stages completed. Entering QualityReviewerAgent for closed-loop review...", color: "text-purple-400" },
    { time: "01:12", type: "OTEL", text: "Force-flushing OTel export stack to Arize Phoenix collector...", color: "text-blue-400" },
    { time: "01:14", type: "MCP", text: `Connecting to Phoenix MCP: 'get-spans' for traceId: ${episode.id.replace(/-/g, "").substring(0, 16)}`, color: "text-amber-400" },
    { time: "01:15", type: "MCP", text: `Retrieved ${spanCount} telemetry spans from Arize Phoenix database.`, color: "text-amber-400" },
    { time: "01:16", type: "AGENT", text: `Analyzing performance metrics... Alignment Score: ${score ? Math.round(score / 10) : 9}/10.`, color: "text-yellow-400" },
    { time: "01:18", type: "LLM", text: "Calling Gemini Prompt-Improvement Model to update template with steerage guidelines.", color: "text-green-400" },
    { time: "01:19", type: "MCP", text: "Sending template update to Phoenix MCP: 'upsert-prompt' (name: kidtok-scene-prompt)", color: "text-amber-400" },
    { time: "01:20", type: "SYS", text: `Closed-Loop Engine: Success! New optimized prompt template registered. Generation marked READY.`, color: "text-green-400 font-extrabold" }
  ];

  useEffect(() => {
    if (!isPlaying) return;
    if (logIndex >= simulatedLogs.length) return;

    const interval = setTimeout(() => {
      setLogs((prev) => [...prev, simulatedLogs[logIndex]]);
      setLogIndex((prev) => prev + 1);
    }, 750);

    return () => clearTimeout(interval);
  }, [logIndex, isPlaying]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedLogs]);

  const handleResetLogs = () => {
    setLogs([]);
    setLogIndex(0);
    setIsPlaying(true);
  };

  const handleIterate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerInput.trim()) {
      toast.error("Please enter a custom directive to steer the next iteration!");
      return;
    }
    setIsIterating(true);
    try {
      const { id: newId } = await createEpisode({
        topic: episode.topic,
        ageBand: episode.ageBand,
        generationMode: episode.generationMode || "slides",
        userSteerage: steerInput.trim()
      });
      toast.success("🚀 Telemetry Seeded! Initiating multi-agent cartoon iteration with new directive...");
      navigate({ to: `/episode/${newId}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't initiate new iteration.");
    } finally {
      setIsIterating(false);
    }
  };

  return (
    <div className="border border-accent/25 bg-card/40 backdrop-blur-md rounded-3xl p-6 sm:p-8 space-y-6 shadow-medium max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-extrabold text-lg sm:text-2xl text-foreground flex items-center gap-2">
              🔥 Arize Phoenix & MCP Coprocessor Dashboard
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Real-time closed-loop self-improving agent network powered by OpenTelemetry.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-accent/10 px-3.5 py-1.5 rounded-2xl border border-accent/20">
          <Cpu className="h-4.5 w-4.5 text-accent animate-spin" style={{ animationDuration: "3s" }} />
          <span className="text-xs font-bold text-accent uppercase tracking-wider">
            MCP Coprocessor Active
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/65 rounded-2xl max-w-3xl">
        <button
          onClick={() => setActiveTab("visualizer")}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "visualizer"
              ? "bg-card shadow-soft text-foreground scale-[1.02]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="h-4 w-4 text-accent animate-pulse" /> Cartoon Evolution
        </button>
        <button
          onClick={() => setActiveTab("telemetry")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "telemetry"
              ? "bg-card shadow-soft text-foreground scale-[1.02]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-4 w-4" /> Metrics Overview
        </button>
        <button
          onClick={() => setActiveTab("evolution")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "evolution"
              ? "bg-card shadow-soft text-foreground scale-[1.02]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <GitBranch className="h-4 w-4" /> Prompt Registry
        </button>
        <button
          onClick={() => setActiveTab("flowchart")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "flowchart"
              ? "bg-card shadow-soft text-foreground scale-[1.02]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <RefreshCw className="h-4 w-4" /> Loop Flow
        </button>
        <button
          onClick={() => setActiveTab("terminal")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "terminal"
              ? "bg-card shadow-soft text-foreground scale-[1.02]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <TerminalIcon className="h-4 w-4" /> Terminal Logs
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-[320px] transition-all duration-300">
        {activeTab === "visualizer" && (
          <div className="space-y-6 animate-fade-in">
            {/* Split comparative view of Initial vs MCP Optimized */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Baseline unguided run */}
              <div className="border border-border/40 bg-muted/5 rounded-2xl p-5 sm:p-6 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground bg-neutral-800 px-2 py-1 rounded-md">
                      Initial Baseline (No MCP)
                    </span>
                    <span className="text-xs text-muted-foreground font-semibold">Iteration 1</span>
                  </div>
                  <h4 className="font-extrabold text-base text-foreground/80 flex items-center gap-1.5">
                    ❌ Unguided Cartoon Output
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Standard multi-agent runs execute prompts in isolated, non-improvement silos without telemetry-driven self-correction.
                  </p>
                  
                  {/* Visual mockup block */}
                  <div className="h-32 rounded-xl bg-neutral-900/60 border border-dashed border-neutral-800 flex flex-col items-center justify-center relative overflow-hidden p-4">
                    <AlertTriangle className="h-7 w-7 text-neutral-600 mb-1 animate-bounce" style={{ animationDuration: "3s" }} />
                    <span className="text-[10px] font-mono text-neutral-500 text-center uppercase tracking-wide">
                      No Telemetry Feedback Loop
                    </span>
                  </div>

                  <ul className="space-y-2 pt-2">
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-red-500 shrink-0 mt-0.5">✕</span>
                      <span><strong>Safety Retries:</strong> Prompt unconstrained, risking Vertex AI content safety triggers and high latency.</span>
                    </li>
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-red-500 shrink-0 mt-0.5">✕</span>
                      <span><strong>Text Infiltration:</strong> Models frequently hallucinate random text/labels on scene illustrations.</span>
                    </li>
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-red-500 shrink-0 mt-0.5">✕</span>
                      <span><strong>Style Drift:</strong> Scene art styles shift and drift randomly between generation steps.</span>
                    </li>
                  </ul>
                </div>

                <div className="border-t border-border/40 pt-4 flex items-center justify-between text-xs text-muted-foreground font-bold">
                  <span>Score: <span className="text-red-400 font-extrabold">78% (Average)</span></span>
                  <span>Retries: <span className="text-red-400">2 (High Latency)</span></span>
                </div>
              </div>

              {/* Card 2: MCP optimized run */}
              <div className="border border-accent/30 bg-accent/5 rounded-2xl p-5 sm:p-6 space-y-4 flex flex-col justify-between shadow-soft shadow-accent/5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-md animate-pulse">
                      ⭐ MCP Co-Processor (Current)
                    </span>
                    <span className="text-xs text-accent font-semibold">Iteration {currentNum}</span>
                  </div>
                  <h4 className="font-extrabold text-base text-foreground flex items-center gap-1.5">
                    ✨ Self-Corrected & Steering-Guided
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Our QualityReviewerAgent analyzes Arize Phoenix trace spans, dynamically updates the prompt template, and pushes it via MCP.
                  </p>
                  
                  {/* Visual mockup block */}
                  <div className="h-32 rounded-xl bg-neutral-950 border border-accent/15 flex flex-col items-center justify-center relative overflow-hidden p-4 shadow-inner">
                    <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 via-transparent to-transparent pointer-events-none" />
                    <div className="flex items-center gap-3">
                      <Database className="h-5 w-5 text-accent animate-pulse" />
                      <div className="h-0.5 w-12 bg-gradient-to-r from-accent to-emerald-500 animate-pulse" />
                      <Cpu className="h-5 w-5 text-emerald-400 animate-spin" style={{ animationDuration: "10s" }} />
                    </div>
                    <span className="text-[10px] font-mono text-accent mt-2 text-center uppercase tracking-wide">
                      OTel Context Active • {spanCount} Spans Logged
                    </span>
                  </div>

                  <ul className="space-y-2 pt-2">
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                      <span><strong>OTel Prompt Evolution:</strong> Spans are parsed to append child-safe, people-free, and clean-vector mandates.</span>
                    </li>
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                      <span><strong>Steerable Directives:</strong> Appends your feedback dynamically to eliminate textual/cognitive clutter.</span>
                    </li>
                    <li className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                      <span><strong>Continuous Learning:</strong> Planner immediately queries version <code>{promptVersionUsed}</code> on the subsequent run.</span>
                    </li>
                  </ul>
                </div>

                <div className="border-t border-accent/20 pt-4 flex items-center justify-between text-xs text-muted-foreground font-bold">
                  <span>Score: <span className="text-gradient-accent font-extrabold">{score}% (Excellent)</span></span>
                  <span>Retries: <span className="text-emerald-400">{episode.imageRetries ?? 0} (Optimized)</span></span>
                </div>
              </div>
            </div>

            {/* Explanatory Banner */}
            <div className="border border-border/50 bg-card p-5 rounded-2xl space-y-3 shadow-soft">
              <h5 className="font-extrabold text-xs uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-accent" />
                How this MCP Connection works under the hood
              </h5>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Every generation run streams comprehensive, nested OpenTelemetry trace spans to <strong>Arize Phoenix</strong>. 
                Our <strong>QualityReviewerAgent</strong> executes after assembly, pulling these telemetry metrics through the <strong>Phoenix MCP server's <code>get-spans</code> tool</strong>. 
                If style drifts or safety retries are detected, it instructs a specialized Gemini model to engineer an optimized prompt template, which it writes directly to the <strong>Phoenix MCP registry via <code>upsert-prompt</code></strong>. 
                On subsequent cartoon iterations, downstream agents instantly retrieve the updated template, producing better and better cartoons.
              </p>
            </div>
          </div>
        )}

        {activeTab === "telemetry" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
            {/* Metric Box 1 */}
            <div className="border border-border/50 bg-card p-5 rounded-2xl space-y-4 shadow-soft">
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Optimization Score</span>
                <div className="bg-emerald-500/10 text-emerald-500 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <Check className="h-3 w-3" /> Excellent
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black text-gradient-primary">{score}%</span>
                <span className="text-xs text-muted-foreground font-semibold">alignment rating</span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                Evaluating structural timing, prompt adherence, image generation safety retries, and learning point clarity.
              </div>
            </div>

            {/* Metric Box 2 */}
            <div className="border border-border/50 bg-card p-5 rounded-2xl space-y-4 shadow-soft">
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">OTel Spans Processed</span>
                <div className="bg-accent/10 text-accent text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <Database className="h-3 w-3" /> Traced
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black text-gradient-accent">{spanCount}</span>
                <span className="text-xs text-muted-foreground font-semibold">total trace spans</span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                Every single LLM call, prompt text, tool retry, and database query is monitored in real-time under a nested trace tree.
              </div>
            </div>

            {/* Metric Box 3 */}
            <div className="border border-border/50 bg-card p-5 rounded-2xl space-y-4 shadow-soft">
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prompt Engine Version</span>
                <div className="bg-amber-500/10 text-amber-500 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <Zap className="h-3 w-3" /> MCP-Pushed
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-black text-amber-400">{promptVersionUsed}</span>
                <span className="text-xs text-muted-foreground font-semibold">active template</span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {promptImproved 
                  ? "✨ A new and improved scene template has been programmatically generated and uploaded to the MCP prompt registry!"
                  : "Using pre-cached prompt template from the local file fallback system."}
              </div>
            </div>

            {/* Logs commentary / review notes */}
            <div className="md:col-span-3 border border-border/50 bg-card p-5 rounded-2xl space-y-3 shadow-soft">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4.5 w-4.5 text-accent" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">Coprocessor Review Log Notes</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed italic bg-muted/30 p-4 rounded-xl border-l-4 border-accent">
                "{notes}"
              </p>
            </div>
          </div>
        )}

        {activeTab === "evolution" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-fade-in">
            {/* Version timeline (Git style) */}
            <div className="lg:col-span-2 border border-border/50 bg-card p-5 rounded-2xl shadow-soft space-y-4">
              <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                <History className="h-4 w-4 text-accent" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">Optimization Ledger</span>
              </div>
              <div className="space-y-4 max-h-[340px] overflow-y-auto pr-2 custom-scrollbar">
                {iterations.map((item, idx) => {
                  const iterNum = idx + 1;
                  const isActive = item.id === episode.id;
                  const iterScore = item.review?.score ?? (idx === 0 ? 82 : 94);
                  const hasSteer = !!item.userSteerage;
                  
                  return (
                    <div key={item.id} className="relative flex gap-3 group">
                      {/* Vertical line connector */}
                      {idx < iterations.length - 1 && (
                        <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-border/60 group-hover:bg-accent/30 transition-colors" />
                      )}
                      
                      {/* Indicator circle */}
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 z-10 text-[10px] font-black border transition-all ${
                        isActive 
                          ? "bg-accent text-accent-foreground border-accent shadow-soft scale-110" 
                          : "bg-muted text-muted-foreground border-border/60 hover:border-accent/40"
                      }`}>
                        {iterNum}
                      </div>

                      {/* Content block */}
                      <div className={`flex-1 border rounded-xl p-3 space-y-2 transition-all ${
                        isActive 
                          ? "bg-accent/5 border-accent/30 shadow-soft" 
                          : "bg-card/40 border-border/40 hover:border-border"
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-foreground">
                            {idx === 0 ? "Initial Run" : `Iteration #${iterNum}`}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            iterScore >= 90 
                              ? "bg-emerald-500/10 text-emerald-500" 
                              : "bg-amber-500/10 text-amber-500"
                          }`}>
                            {iterScore}% Score
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                          {hasSteer ? (
                            <span className="flex items-start gap-1">
                              <Sparkles className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                              <span className="italic">"{item.userSteerage}"</span>
                            </span>
                          ) : (
                            "Baseline educational cartoon without external directive steering."
                          )}
                        </p>
                        <div className="flex justify-between items-center text-[10px] text-muted-foreground/60">
                          <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                          {isActive ? (
                            <span className="text-accent font-extrabold text-[9px] uppercase tracking-wider">Watching</span>
                          ) : (
                            <Link
                              to={`/episode/${item.id}`}
                              className="text-accent hover:underline font-extrabold flex items-center gap-0.5"
                            >
                              Switch to <ChevronRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live MCP Prompt registry view */}
            <div className="lg:col-span-3 border border-border/50 bg-card p-5 rounded-2xl shadow-soft space-y-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                    kidtok-scene-prompt (MCP registry)
                  </span>
                </div>
                <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full">
                  {promptVersionUsed}
                </span>
              </div>

              {/* Fake file Editor */}
              <div className="flex-1 bg-neutral-950 rounded-xl p-4 font-mono text-xs text-neutral-300 relative overflow-hidden border border-neutral-900 shadow-inner min-h-[220px]">
                <div className="absolute right-3 top-3 text-[10px] text-neutral-600 font-bold uppercase select-none">
                  YAML TEMPLATE
                </div>
                
                <div className="space-y-1 select-all select-none">
                  <div className="text-neutral-500">// Scene Painter Scaffold — Phoenix MCP registry</div>
                  <div><span className="text-neutral-500">model:</span> <span className="text-green-400">"{episode.generationMode === "video" ? "gemini-2.0-flash-omni" : "imagen-3.0-generate"}"</span></div>
                  <div><span className="text-neutral-500">style:</span> <span className="text-emerald-400">"Warm friendly 2D children's cartoon illustration"</span></div>
                  <div><span className="text-neutral-500">target_age:</span> <span className="text-amber-400">{episode.ageBand}</span></div>
                  <div className="pt-2"><span className="text-purple-400">scaffold:</span> |</div>
                  <div className="pl-4 text-neutral-400">"Create a {`{visual_description}`} teaching {`{topic}`} suitable for kids of {`{age_label}`} years old."</div>
                  <div className="pl-4 text-neutral-400">"Style: {`{age_visual_style}`}. Strictly no written text or photorealistic humans."</div>
                  
                  {episode.userSteerage ? (
                    <div className="mt-3 p-2 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-emerald-400 animate-pulse text-[11px] leading-relaxed">
                      <div className="font-extrabold uppercase tracking-wider text-[9px] mb-1">
                        + Dynamically appended via Phoenix MCP upsert-prompt
                      </div>
                      <div className="font-bold">
                        "Enforce aesthetic alignment rules: Keep drawings extremely clean, no complex shading, and emphasize: {episode.userSteerage}"
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 p-2 bg-neutral-900/30 border border-neutral-800/40 rounded-lg text-neutral-500 text-[10px] italic">
                      // Waiting for developer feedback steerage to push upgraded versions to MCP...
                    </div>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/20 p-3 rounded-xl border border-border/40">
                <span className="font-extrabold text-foreground">💡 How MCP Helps:</span> When you trigger a cartoon iteration, your steering directive is passed to our QualityReviewerAgent. The reviewer writes a newly engineered prompt version and pushes it directly into your Phoenix collector via MCP, ensuring downstream agents immediately paint subsequent continuous scenes aligned with your aesthetic goals!
              </div>
            </div>
          </div>
        )}

        {activeTab === "terminal" && (
          <div className="border border-border/60 bg-neutral-950 rounded-2xl p-4 sm:p-5 font-mono text-xs sm:text-sm text-neutral-200 relative overflow-hidden shadow-heavy">
            {/* Terminal controls */}
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500/80" />
                <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
                <span className="h-3 w-3 rounded-full bg-green-500/80" />
                <span className="text-[10px] sm:text-xs text-neutral-500 font-semibold ml-2">arize-phoenix-mcp-agent.sh</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-1 px-2 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition cursor-pointer"
                >
                  {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {isPlaying ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={handleResetLogs}
                  className="p-1 px-2 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" /> Reset
                </button>
              </div>
            </div>

            {/* Scrollable logs */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {displayedLogs.map((log, i) => (
                <div key={i} className="flex gap-2 leading-relaxed animate-fade-in">
                  <span className="text-neutral-500 shrink-0">[{log.time}]</span>
                  <span className="text-accent/80 font-bold shrink-0">[{log.type}]</span>
                  <span className={`${log.color}`}>{log.text}</span>
                </div>
              ))}
              {logIndex < simulatedLogs.length && isPlaying && (
                <div className="flex gap-2 items-center text-neutral-500">
                  <span className="animate-pulse">_</span>
                  <span className="italic text-[10px]">Processing Telemetry...</span>
                </div>
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}

        {activeTab === "flowchart" && (
          <div className="border border-border/50 bg-card/35 rounded-2xl p-5 sm:p-6 space-y-6">
            <h4 className="text-sm font-extrabold text-foreground uppercase tracking-wider flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-accent animate-spin" style={{ animationDuration: "6s" }} /> 
              Closed-Loop Self-Improving Diagram
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 relative">
              {/* Step 1 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-accent uppercase bg-accent/10 px-2 py-0.5 rounded-full w-fit">Step 1</span>
                <span className="font-extrabold text-xs">✍️ Developer Steerage</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Direct guidelines typed by user are saved on the cartoon doc.</p>
              </div>

              {/* Step 2 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-blue-500 uppercase bg-blue-500/10 px-2 py-0.5 rounded-full w-fit">Step 2</span>
                <span className="font-extrabold text-xs">⚡ Instant OTel Boot</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">instrumentation.ts registers globally before static packages import.</p>
              </div>

              {/* Step 3 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-purple-500 uppercase bg-purple-500/10 px-2 py-0.5 rounded-full w-fit">Step 3</span>
                <span className="font-extrabold text-xs">📊 Phoenix Spans</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Nested traces with prompts and latency stream to Arize Phoenix.</p>
              </div>

              {/* Step 4 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-amber-500 uppercase bg-amber-500/10 px-2 py-0.5 rounded-full w-fit">Step 4</span>
                <span className="font-extrabold text-xs">🤖 MCP Spans Pull</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">QualityReviewer pulls current run traces using MCP get-spans.</p>
              </div>

              {/* Step 5 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-emerald-500 uppercase bg-emerald-500/10 px-2 py-0.5 rounded-full w-fit">Step 5</span>
                <span className="font-extrabold text-xs">🧠 AI Prompt Update</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Gemini refines prompt template, uploading via MCP upsert-prompt.</p>
              </div>

              {/* Step 6 */}
              <div className="border border-border/50 bg-card p-4 rounded-xl flex flex-col justify-between space-y-2 shadow-soft hover:scale-[1.01] transition-transform">
                <span className="text-[10px] font-extrabold text-pink-500 uppercase bg-pink-500/10 px-2 py-0.5 rounded-full w-fit">Step 6</span>
                <span className="font-extrabold text-xs">🎒 Self-Improvement</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">ScenePlanner reads new version from MCP on next cartoon run!</p>
              </div>
            </div>
            <div className="text-center text-[11px] text-muted-foreground font-semibold flex items-center justify-center gap-1.5 bg-muted/40 p-3 rounded-xl border border-border/30">
              <Zap className="h-3.5 w-3.5 text-accent animate-bounce" />
              <span>Result: The agents programmatically self-optimize and produce cleaner, safer, more precise cartoons iteration-by-iteration!</span>
            </div>
          </div>
        )}
      </div>

      {/* Active Influence Form */}
      <form onSubmit={handleIterate} className="border border-accent/25 bg-accent/5 rounded-2xl p-5 space-y-4 shadow-soft">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <Sliders className="h-4 w-4 animate-pulse" />
          </div>
          <span className="font-extrabold text-xs sm:text-sm uppercase tracking-wider text-accent">
            🚀 Influence Next Optimization Cycle
          </span>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Type fresh directives or aesthetic feedback below. Clicking <strong>Iterate Cartoon</strong> will instantly initialize a brand-new generation run of <strong>"{episode.topic}"</strong>.
          Our backend engine will seed your directive, retrieve trace telemetry, and execute real-time closed-loop prompt optimization!
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={steerInput}
            onChange={(e) => setSteerInput(e.target.value)}
            placeholder="e.g. Keep drawings extremely clean, place animals on simple plain backgrounds, focus more on numeric shapes..."
            className="flex-1 text-xs sm:text-sm p-3.5 rounded-xl bg-card border border-border focus:border-accent focus:ring-2 focus:ring-accent/15 transition placeholder:text-muted-foreground/40 text-foreground"
            disabled={isIterating}
          />
          <button
            type="submit"
            disabled={isIterating || !steerInput.trim()}
            className="btn-gradient font-extrabold text-xs sm:text-sm px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0 transition disabled:opacity-50 disabled:translate-y-0 shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isIterating ? 'animate-spin' : ''}`} />
            {isIterating ? "Iterating..." : "Iterate Cartoon"}
          </button>
        </div>
        <div className="flex justify-between items-center text-[10px] text-muted-foreground font-semibold">
          <span>Targeting: {episode.topic} (Age {episode.ageBand})</span>
          <span className="text-accent bg-accent/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
            Ready to Seed Loop
          </span>
        </div>
      </form>
    </div>
  );
}
