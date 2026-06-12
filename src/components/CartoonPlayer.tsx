import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { Scene, SceneAnimation } from "@/lib/agentApi";

const ANIM_CLASS: Record<SceneAnimation, string> = {
  "kenburns-in": "scene-kenburns-in",
  "kenburns-out": "scene-kenburns-out",
  "pan-left": "scene-pan-left",
  "pan-right": "scene-pan-right",
};

interface CartoonPlayerProps {
  scenes: Scene[];
  topic: string;
}

export function CartoonPlayer({ scenes, topic }: CartoonPlayerProps) {
  const ordered = useMemo(() => [...scenes].sort((a, b) => a.index - b.index), [scenes]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement>(null);

  const scene = ordered[current];

  // Sync play/pause to audio.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !scene) return;
    a.muted = muted;
    if (playing) {
      a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  }, [playing, muted, current, scene]);

  // Sync background music to cartoon player's state
  useEffect(() => {
    const bg = bgAudioRef.current;
    if (!bg) return;
    bg.volume = 0.08; // Gentle bed under narration
    bg.muted = muted;
    if (started && playing) {
      bg.play().catch(() => {});
    } else {
      bg.pause();
    }
  }, [playing, muted, started]);

  // Reset audio when scene changes.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    if (started && playing) a.play().catch(() => {});
  }, [current, started, playing]);

  if (!scene) return null;

  const handleEnded = () => {
    if (current < ordered.length - 1) {
      setCurrent((c) => c + 1);
    } else {
      setPlaying(false);
    }
  };

  const handleStart = () => {
    setStarted(true);
    setPlaying(true);
  };

  const handleReplay = () => {
    setCurrent(0);
    setStarted(true);
    setPlaying(true);
  };

  return (
    <div className="relative w-full bg-foreground rounded-3xl overflow-hidden shadow-2xl aspect-video max-h-[75vh]">
      {/* Scenes layered for crossfade */}
      {ordered.map((s, i) => (
        <div
          key={s.index}
          className="absolute inset-0 transition-opacity duration-500"
          style={{ opacity: i === current ? 1 : 0 }}
          aria-hidden={i !== current}
        >
          <img
            src={s.imageUrl}
            alt={s.caption}
            className={`w-full h-full object-cover ${
              i === current && playing ? ANIM_CLASS[s.animation] : ""
            }`}
            style={
              i === current && playing
                ? { animationDuration: `${s.durationMs}ms` }
                : undefined
            }
            draggable={false}
          />
        </div>
      ))}

      {/* Top gradient + topic */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/60 to-transparent">
        <p className="text-white/90 text-sm font-semibold">{topic}</p>
      </div>

      {/* Caption */}
      <div className="absolute bottom-20 inset-x-0 px-4 flex justify-center pointer-events-none">
        <p className="bg-background/95 text-foreground text-lg sm:text-xl font-bold px-5 py-3 rounded-2xl shadow-lg max-w-3xl text-center leading-snug">
          {scene.caption}
        </p>
      </div>

      {/* Scene dots */}
      <div className="absolute bottom-12 inset-x-0 flex justify-center gap-1.5">
        {ordered.map((s, i) => (
          <button
            key={s.index}
            onClick={() => {
              setCurrent(i);
              setStarted(true);
            }}
            aria-label={`Scene ${i + 1}`}
            className={`h-2 rounded-full transition-all ${
              i === current ? "bg-sunshine w-6" : "bg-white/50 w-2 hover:bg-white/80"
            }`}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 inset-x-0 p-3 flex items-center justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent">
        {!started ? (
          <button
            onClick={handleStart}
            className="bg-primary hover:bg-primary-glow text-primary-foreground font-bold px-6 py-3 rounded-full flex items-center gap-2 shadow-lg transition-colors"
          >
            <Play className="h-5 w-5" /> Tap to start
          </button>
        ) : (
          <>
            <IconButton
              onClick={() => setPlaying((p) => !p)}
              label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </IconButton>
            <IconButton onClick={handleReplay} label="Replay">
              <RotateCcw className="h-5 w-5" />
            </IconButton>
            <IconButton onClick={() => setMuted((m) => !m)} label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconButton>
          </>
        )}
      </div>

      <audio ref={audioRef} src={scene.audioUrl} onEnded={handleEnded} preload="auto" />
      <audio ref={bgAudioRef} src="/soundhelix-8.mp3" loop preload="auto" />
    </div>
  );
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="h-11 w-11 rounded-full bg-background/95 text-foreground hover:bg-background flex items-center justify-center shadow-lg transition-colors"
    >
      {children}
    </button>
  );
}
