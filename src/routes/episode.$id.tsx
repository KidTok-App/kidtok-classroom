import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getEpisode, isApiConfigured } from "@/lib/agentApi";
import { CartoonPlayer } from "@/components/CartoonPlayer";
import { StatusScreen } from "@/components/StatusScreen";

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

  const { data, error } = useQuery({
    queryKey: ["episode", id],
    queryFn: () => getEpisode(id),
    enabled: isApiConfigured(),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });

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

  if (data.status === "ready" && data.scenes && data.scenes.length > 0) {
    return (
      <div className="mx-auto max-w-5xl px-3 sm:px-4 py-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> New cartoon
        </Link>
        <CartoonPlayer scenes={data.scenes} topic={data.topic} />
        <p className="text-center text-sm text-muted-foreground mt-4">
          Age {data.ageBand} · {data.scenes.length} scenes
        </p>
      </div>
    );
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
