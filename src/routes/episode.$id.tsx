import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
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
  const [preloadingProgress, setPreloadingProgress] = useState(0);
  const [isPreloaded, setIsPreloaded] = useState(false);

  const { data, error } = useQuery({
    queryKey: ["episode", id],
    queryFn: () => getEpisode(id),
    enabled: isApiConfigured(),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });

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

  if (data.status === "ready" && data.scenes && data.scenes.length > 0) {
    if (!isPreloaded) {
      return <StatusScreen status="preloading" progress={preloadingProgress} topic={data.topic} />;
    }

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
