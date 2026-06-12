import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Shield, Heart, Baby, Music, Film, Presentation, Activity, Users, BookOpen } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — KidTok Classroom" },
      {
        name: "description",
        content:
          "How KidTok Classroom turns any topic into a safe, personalized animated cartoon for ages 5–8 using a team of specialised AI agents.",
      },
      { property: "og:title", content: "About KidTok Classroom" },
      {
        property: "og:description",
        content:
          "Personalized child profiles, a synced music bed, an animated Slides mode, and a quality-reviewed multi-agent pipeline.",
      },
    ],
  }),
  component: AboutPage,
});

const PIPELINE = [
  { name: "Orchestrator", desc: "Coordinates every agent." },
  { name: "Script", desc: "Writes the story for your child's age and interests." },
  { name: "Scene Planner", desc: "Breaks it into scenes with your chosen art style." },
  { name: "Scene Images", desc: "Generates kid‑friendly art for each beat." },
  { name: "Narration", desc: "Records a warm, age‑appropriate voice." },
  { name: "Music Bed", desc: "Adds a gentle, looped Lyria background score." },
  { name: "Assembly", desc: "Stitches scenes, voice, and music into a cartoon." },
  { name: "Quality Reviewer", desc: "Final kid‑safety + personalization check." },
];

const WHATS_NEW = [
  {
    icon: <Baby className="h-5 w-5" />,
    title: "Personalized Child Profiles",
    body: "Add each child with their name, age, interests and favourite art style. The story uses their name, leans into what they love, and locks the age so cartoons always fit them.",
  },
  {
    icon: <Presentation className="h-5 w-5" />,
    title: "Classroom Slides mode",
    body: "Beautiful, kid‑first animated slides — perfect for the living room TV or a classroom projector. Built to be the default cartoon experience.",
  },
  {
    icon: <Music className="h-5 w-5" />,
    title: "Synced background music",
    body: "Every cartoon now ships with a gentle, loopable music bed mixed softly under the narration, so scenes feel cinematic instead of clinical.",
  },
  {
    icon: <Activity className="h-5 w-5" />,
    title: "Self‑improving reviewer",
    body: "A reviewer agent watches every run and tunes the prompts behind the scenes, so cartoons get a little better, safer, and more on‑style over time.",
  },
];

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-12">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border shadow-soft text-xs font-bold uppercase tracking-wider text-muted-foreground mb-5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> A peek behind the cartoon
        </span>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4 leading-[1.05]">
          How a topic becomes a
          <br />
          <span className="text-gradient-primary">cartoon your kid loves</span>
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground/90 max-w-2xl mx-auto leading-relaxed">
          KidTok Classroom turns any topic — dinosaurs, fractions, why the sky is blue — into a
          short animated cartoon for ages 5–8. A team of specialised AI agents writes, draws,
          narrates, scores and reviews every story before it reaches the player.
        </p>
      </div>

      {/* What's new — wired naturally into the page */}
      <section className="mb-14">
        <div className="flex items-end justify-between mb-5">
          <h2 className="text-2xl sm:text-3xl font-extrabold">What's new for families</h2>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-full">
            <Sparkles className="h-3 w-3" /> Fresh updates
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {WHATS_NEW.map((item) => (
            <div
              key={item.title}
              className="bg-card border-2 border-border rounded-3xl p-5 shadow-soft hover:shadow-medium hover:-translate-y-0.5 transition-all"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                {item.icon}
              </div>
              <h3 className="font-extrabold text-lg mb-1">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pipeline */}
      <section className="mb-14">
        <h2 className="text-2xl sm:text-3xl font-extrabold mb-2">The agent pipeline</h2>
        <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
          Each agent does one small job and hands its work to the next, like an animation studio
          on fast‑forward.
        </p>
        <div className="bg-card border-2 border-border rounded-3xl p-5 sm:p-8 overflow-x-auto">
          <ol className="flex items-stretch gap-3 min-w-max">
            {PIPELINE.map((step, i) => (
              <li key={step.name} className="flex items-stretch gap-3">
                <div className="w-44 bg-background rounded-2xl border-2 border-border p-4 flex flex-col">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    Step {i + 1}
                  </span>
                  <h3 className="font-extrabold text-base mt-1">{step.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.desc}</p>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div className="self-center text-primary font-extrabold text-2xl">→</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust row */}
      <section className="grid sm:grid-cols-3 gap-4 mb-14">
        <TrustCard
          icon={<Baby className="h-5 w-5" />}
          title="Tuned to your child"
          body="Profiles steer vocabulary, pacing, art style, and the way the narrator says your child's name."
        />
        <TrustCard
          icon={<Shield className="h-5 w-5" />}
          title="Parent‑approved"
          body="A reviewer agent reads the script and checks the assembled cartoon before it's ever marked ready."
        />
        <TrustCard
          icon={<Heart className="h-5 w-5" />}
          title="Built to delight"
          body="Bright art, a warm voice, and a soft music bed — designed for the living room, not the doomscroll."
        />
      </section>

      {/* For curious parents — Self-improvement hook (organic, no hackathon framing) */}
      <section className="mb-14">
        <div className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-2 border-border rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Activity className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl sm:text-2xl font-extrabold mb-1">
                For curious parents: how it gets better
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Every cartoon run quietly streams diagnostics back to a reviewer that tunes the
                prompts powering the agents. You don't have to think about it — but if you sign in,
                you can open the self‑improvement view from your avatar menu and watch the loop
                close in real time.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-sm font-extrabold text-primary hover:underline"
              >
                <BookOpen className="h-4 w-4" /> Make a cartoon →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="grid sm:grid-cols-2 gap-4 mb-12">
        <div className="bg-card border-2 border-border rounded-3xl p-5">
          <div className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-full mb-3">
            <Users className="h-3 w-3" /> Parents
          </div>
          <h3 className="font-extrabold text-lg mb-1">Screen time you can feel good about</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Hand your child a personalised cartoon about something they actually want to learn,
            knowing it was reviewed before it played.
          </p>
        </div>
        <div className="bg-card border-2 border-border rounded-3xl p-5">
          <div className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-full mb-3">
            <Film className="h-3 w-3" /> Teachers
          </div>
          <h3 className="font-extrabold text-lg mb-1">A new lesson hook in minutes</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Type a topic, pick an age band, and project a Classroom Slides cartoon that opens the
            lesson with a smile.
          </p>
        </div>
      </section>

      <p className="text-center text-sm text-muted-foreground border-t border-border pt-6">
        Powered by Gemini, Google Cloud Agent Builder (ADK), ElevenLabs, Lyria, and a self‑tuning
        reviewer loop.
      </p>
    </div>
  );
}

function TrustCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card border-2 border-border rounded-3xl p-5">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
        {icon}
      </div>
      <h3 className="font-extrabold text-base mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
