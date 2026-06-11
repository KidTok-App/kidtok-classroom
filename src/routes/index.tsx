import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sparkles, Zap, Shield, Heart, BookOpen, Film, Presentation } from "lucide-react";
import { createEpisode, isApiConfigured } from "@/lib/agentApi";
import { StarSparkle } from "@/components/StarSparkle";
import { useAuth } from "@/lib/auth";

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

function HomePage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [ageBand, setAgeBand] = useState<number>(6);
  const [generationMode, setGenerationMode] = useState<"slides" | "video">("slides");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const canUseOmni = user?.email === OMNI_ALLOWED_EMAIL;

  const submit = async (rawTopic: string) => {
    const t = rawTopic.trim();
    if (!t) {
      toast.error("Tell us what to learn about first!");
      return;
    }
    if (!isApiConfigured()) {
      toast.error("Backend not configured. Set VITE_AGENT_API_URL.");
      return;
    }
    const effectiveMode = generationMode === "video" && !canUseOmni ? "slides" : generationMode;
    setSubmitting(true);
    try {
      const { id } = await createEpisode({ topic: t, ageBand, generationMode: effectiveMode });
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

        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border shadow-soft text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Multi-agent learning studio
        </span>

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
            </p>
            <div className="flex gap-2">
              {AGES.map((age) => (
                <button
                  key={age}
                  type="button"
                  onClick={() => setAgeBand(age)}
                  disabled={submitting}
                  aria-pressed={ageBand === age}
                  className={`h-14 w-14 rounded-2xl font-extrabold text-xl transition-all ${
                    ageBand === age
                      ? "btn-gradient scale-110"
                      : "bg-card border-2 border-border text-foreground hover:border-primary"
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <button
              type="submit"
              disabled={submitting}
              className="btn-gradient hover:[--tw:0] inline-flex items-center gap-2 font-extrabold text-base sm:text-lg px-8 py-4 rounded-full hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0"
            >
              <Sparkles className="h-5 w-5" />
              {submitting ? "Starting…" : "Create cartoon"}
            </button>
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
        <div className="grid sm:grid-cols-3 gap-4">
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
