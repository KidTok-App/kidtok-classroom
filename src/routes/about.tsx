import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — KidTok Classroom" },
      {
        name: "description",
        content:
          "How KidTok Classroom uses a multi-agent pipeline to turn any topic into an educational cartoon.",
      },
      { property: "og:title", content: "About KidTok Classroom" },
      {
        property: "og:description",
        content: "Multi-agent pipeline: Orchestrator, Script, Scenes, Images, Narration, Assembly, Review.",
      },
    ],
  }),
  component: AboutPage,
});

const PIPELINE = [
  { name: "Orchestrator", desc: "Coordinates every agent." },
  { name: "Script", desc: "Writes the story." },
  { name: "Scene Planner", desc: "Breaks it into scenes." },
  { name: "Scene Images", desc: "Generates art." },
  { name: "Narration", desc: "Records the voice." },
  { name: "Assembly", desc: "Builds the cartoon." },
  { name: "Quality Reviewer", desc: "Kid‑safety check." },
];

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-4xl sm:text-5xl font-extrabold mb-4">
        How a topic becomes a cartoon
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl mb-10">
        KidTok Classroom uses a team of specialised AI agents. Each one does a small job, then
        hands its work to the next agent in the pipeline.
      </p>

      <div className="bg-card border-2 border-border rounded-3xl p-5 sm:p-8 mb-10 overflow-x-auto">
        <ol className="flex items-stretch gap-3 min-w-max">
          {PIPELINE.map((step, i) => (
            <li key={step.name} className="flex items-stretch gap-3">
              <div className="w-44 bg-background rounded-2xl border-2 border-border p-4 flex flex-col">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Step {i + 1}
                </span>
                <h3 className="font-extrabold text-base mt-1">{step.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
              </div>
              {i < PIPELINE.length - 1 && (
                <div className="self-center text-primary font-extrabold text-2xl">→</div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid sm:grid-cols-2 gap-5 mb-10">
        <Card title="Built for ages 5–8">
          Every prompt and image is shaped by the age band you pick on the home screen, so the
          vocabulary, pacing, and visuals fit the audience.
        </Card>
        <Card title="Quality reviewed">
          A reviewer agent reads the script and inspects the assembled cartoon before it's marked
          ready, so teachers can trust what lands in the player.
        </Card>
      </div>

      <p className="text-center text-sm text-muted-foreground border-t border-border pt-6">
        Powered by Gemini + Google Cloud Agent Builder (ADK) + Arize Phoenix
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border-2 border-border rounded-2xl p-5">
      <h3 className="font-extrabold text-lg mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
