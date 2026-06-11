import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { createEpisode, isApiConfigured } from "@/lib/agentApi";
import { StarSparkle } from "@/components/StarSparkle";

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

function HomePage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [ageBand, setAgeBand] = useState<number>(6);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = topic.trim();
    if (!t) {
      toast.error("Tell us what to learn about first!");
      return;
    }
    if (!isApiConfigured()) {
      toast.error("Backend not configured. Set VITE_AGENT_API_URL.");
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await createEpisode({ topic: t, ageBand });
      navigate({ to: "/episode/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start your cartoon.");
      setSubmitting(false);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* Decorative stars */}
      <Decor />

      <section className="relative mx-auto max-w-3xl px-4 pt-12 sm:pt-20 pb-16 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-bold uppercase tracking-wider mb-6">
          <Sparkles className="h-3.5 w-3.5" /> Multi-agent learning studio
        </span>
        <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight mb-4">
          What should we{" "}
          <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
            learn today?
          </span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
          Type any topic. Our AI agents will write, draw, and narrate an animated cartoon for your
          classroom in minutes.
        </p>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="relative">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Why is the sky blue?"
              maxLength={140}
              className="w-full text-lg sm:text-xl px-6 py-5 rounded-3xl border-2 border-border bg-card shadow-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition"
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-muted-foreground">For age</p>
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
                      ? "bg-primary text-primary-foreground shadow-lg scale-110"
                      : "bg-card border-2 border-border text-foreground hover:border-primary"
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-extrabold text-lg px-8 py-4 rounded-full shadow-xl hover:scale-105 active:scale-100 transition-transform disabled:opacity-60 disabled:scale-100"
          >
            {submitting ? "Starting…" : "Create cartoon"}
            <StarSparkle size={22} className="text-sunshine" />
          </button>
        </form>
      </section>
    </div>
  );
}

function Decor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute top-10 left-6 text-sunshine twinkle"><StarSparkle size={28} /></div>
      <div className="absolute top-32 right-10 text-primary-glow twinkle" style={{ animationDelay: "0.6s" }}><StarSparkle size={22} /></div>
      <div className="absolute bottom-20 left-12 text-primary twinkle" style={{ animationDelay: "1.1s" }}><StarSparkle size={18} /></div>
      <div className="absolute bottom-32 right-16 text-sunshine twinkle" style={{ animationDelay: "0.3s" }}><StarSparkle size={26} /></div>
    </div>
  );
}
