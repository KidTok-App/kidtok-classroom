import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { isApiConfigured, listEpisodes, type Episode } from "@/lib/agentApi";
import { StarSparkle } from "@/components/StarSparkle";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — KidTok Classroom" },
      { name: "description", content: "Browse cartoons you've made." },
    ],
  }),
  component: LibraryPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-extrabold mb-2">Couldn't load library</h2>
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
  notFoundComponent: () => <p className="p-12 text-center">Not found.</p>,
});

function LibraryPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["episodes"],
    queryFn: listEpisodes,
    enabled: isApiConfigured(),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold">Cartoon library</h1>
          <p className="text-muted-foreground mt-1">Every cartoon you've made, in one place.</p>
        </div>
        <Link
          to="/"
          className="bg-primary text-primary-foreground font-bold px-5 py-2.5 rounded-full hover:bg-primary-glow transition"
        >
          + New cartoon
        </Link>
      </div>

      {!isApiConfigured() && (
        <EmptyState
          title="Backend not configured"
          body="Set VITE_AGENT_API_URL to load your saved cartoons."
        />
      )}

      {isApiConfigured() && isLoading && <SkeletonGrid />}

      {isApiConfigured() && error && (
        <EmptyState title="Couldn't load library" body={(error as Error).message} />
      )}

      {isApiConfigured() && data && data.length === 0 && (
        <EmptyState
          title="No cartoons yet"
          body="Head back home and create your first one!"
        />
      )}

      {isApiConfigured() && data && data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {data.map((ep) => (
            <EpisodeCard key={ep.id} episode={ep} />
          ))}
        </div>
      )}
    </div>
  );
}

function EpisodeCard({ episode }: { episode: Episode }) {
  const thumb = episode.scenes?.[0]?.imageUrl;
  const date = formatDate(episode.createdAt);
  return (
    <Link
      to="/episode/$id"
      params={{ id: episode.id }}
      className="group bg-card rounded-3xl overflow-hidden border-2 border-border hover:border-primary hover:shadow-xl transition-all"
    >
      <div className="aspect-video bg-muted relative">
        {thumb ? (
          <img
            src={thumb}
            alt={episode.topic}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sunshine">
            <StarSparkle size={56} />
          </div>
        )}
        <span className="absolute top-3 right-3 bg-background/95 text-foreground text-xs font-bold px-2.5 py-1 rounded-full">
          Age {episode.ageBand}
        </span>
        {episode.status !== "ready" && (
          <span className="absolute top-3 left-3 bg-sunshine text-sunshine-foreground text-xs font-bold px-2.5 py-1 rounded-full capitalize">
            {episode.status.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-extrabold text-lg leading-snug line-clamp-2">{episode.topic}</h3>
        <p className="text-sm text-muted-foreground mt-1">{date}</p>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-3xl bg-muted aspect-video animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-20 bg-card rounded-3xl border-2 border-dashed border-border">
      <div className="inline-block text-sunshine mb-4"><StarSparkle size={56} /></div>
      <h2 className="text-xl font-extrabold mb-1">{title}</h2>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
