import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, PenLine, Layers, Mic, Film, ShieldCheck, ArrowRight } from "lucide-react";

const TITLE = "How to Make Educational Cartoon Videos for Kids (AI Guide)";
const DESCRIPTION =
  "A step-by-step guide to making educational cartoon videos for kids 5–8 using a multi-agent AI pipeline — scripting, scene planning, illustration, and narration.";
const URL = "https://kidtokai.com/how-to-make-educational-cartoons";

export const Route = createFileRoute("/how-to-make-educational-cartoons")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: TITLE,
          description: DESCRIPTION,
          totalTime: "PT5M",
          step: [
            { "@type": "HowToStep", name: "Pick a topic and age band", text: "Choose a learning topic and the child's age (5–8) so the language and pacing match." },
            { "@type": "HowToStep", name: "Let the script agent write the lesson", text: "An LLM writes a short, age-appropriate script with a clear teaching arc." },
            { "@type": "HowToStep", name: "Plan continuous scenes", text: "A scene planner breaks the script into 4–6 illustrated scenes with consistent characters." },
            { "@type": "HowToStep", name: "Generate illustrations", text: "An image agent paints each scene in a consistent kid-friendly art style." },
            { "@type": "HowToStep", name: "Narrate and assemble", text: "A narration agent voices each scene; an assembly agent stitches scenes into a playable cartoon." },
            { "@type": "HowToStep", name: "Review for safety and clarity", text: "A reviewer agent checks alignment, age-appropriateness, and learning clarity before publishing." },
          ],
        }),
      },
    ],
  }),
  component: GuidePage,
});

const STEPS = [
  { icon: Sparkles, title: "1. Start with a topic and age band", body: "Educational cartoons land best when the script matches the listener. Pick a single topic (\"why is the sky blue?\", \"how do plants drink water?\") and a target age (5–8). Narrower topics produce sharper lessons than broad ones." },
  { icon: PenLine, title: "2. Let an AI script agent write the lesson", body: "A script agent (LLM) drafts a short, structured script: hook → core idea → example → recap. Constrain vocabulary to the age band and keep total runtime under 90 seconds so attention holds." },
  { icon: Layers, title: "3. Plan continuous scenes", body: "A scene planner breaks the script into 4–6 visual beats. Each beat carries one idea, one consistent set of characters, and a clear caption. Continuity is what makes the result feel like a cartoon instead of a slideshow." },
  { icon: Film, title: "4. Generate illustrations in one style", body: "An image agent paints each scene. Lock the art style (crayon sketch, claymation, flat vector) so characters and palette stay consistent across scenes. Re-prompt and sanitize whenever the safety filter trips." },
  { icon: Mic, title: "5. Narrate and assemble", body: "A narration agent voices each scene with a warm, kid-appropriate TTS voice. An assembly agent aligns audio to images with Ken-Burns motion and stitches the cartoon together for playback." },
  { icon: ShieldCheck, title: "6. Review for safety and clarity", body: "A reviewer agent rates alignment and age-appropriateness before publishing. Closed-loop feedback (engagement ratings, clarity scores) feeds back into the prompts so the next cartoon is sharper." },
];

function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16 space-y-12">
      <header className="space-y-4 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider">
          <Sparkles className="h-3.5 w-3.5" /> Guide
        </span>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-[1.05]">
          How to make educational cartoon videos for kids (with AI)
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          A practical, multi-agent recipe for turning any classroom topic into a narrated, illustrated cartoon for ages 5–8 — the exact pipeline KidTok Classroom uses.
        </p>
      </header>

      <section className="space-y-6">
        <h2 className="text-2xl font-extrabold">Why multi-agent beats one-shot prompts</h2>
        <p className="text-foreground/85 leading-relaxed">
          Single-prompt cartoon generators try to do everything at once — script, visuals, narration — and the seams show. Splitting the job across specialist agents (script, scene planning, illustration, narration, assembly, review) keeps each step focused, makes failures easy to retry, and lets you steer style and pacing without rewriting the whole pipeline.
        </p>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-extrabold">The 6-step pipeline</h2>
        <ol className="space-y-5">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-soft">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="space-y-1.5">
                  <h3 className="font-extrabold text-lg text-foreground">{title}</h3>
                  <p className="text-sm text-foreground/80 leading-relaxed">{body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-extrabold">Tips that materially improve quality</h2>
        <ul className="space-y-3 text-foreground/85 leading-relaxed list-disc pl-5">
          <li><strong>Lock the art style once</strong> and reuse the phrasing in every scene prompt — consistency reads as production value to kids.</li>
          <li><strong>Cap each scene at 12–18 seconds.</strong> Longer beats lose 5–8 year olds.</li>
          <li><strong>Write captions a child could read aloud</strong>, then have the narrator voice the same line — print + voice reinforces learning.</li>
          <li><strong>Always run a safety pass</strong> on both images and script before publishing to children.</li>
          <li><strong>Collect engagement feedback after each play</strong> and feed it back into the script and scene prompts.</li>
        </ul>
      </section>

      <section className="rounded-3xl border border-primary/20 bg-primary/5 p-6 sm:p-8 text-center space-y-4">
        <h2 className="text-2xl font-extrabold">Want to skip the build?</h2>
        <p className="text-foreground/85 leading-relaxed max-w-xl mx-auto">
          KidTok Classroom runs this exact multi-agent pipeline for you. Type any topic, pick an age, and a narrated cartoon arrives in minutes.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-extrabold px-5 py-3 rounded-full hover:opacity-95 transition"
        >
          Make a cartoon now <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
