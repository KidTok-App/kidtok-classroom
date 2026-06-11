import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, Minimize2, Download, Sparkles, Film } from "lucide-react";
import { toast } from "sonner";

interface CinematicVideoPlayerProps {
  videoUrl: string;
  topic: string;
  ageBand?: number;
}

export function CinematicVideoPlayer({ videoUrl, topic, ageBand = 6 }: CinematicVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<number | null>(null);

  // Sync volume state to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
      video.volume = volume;
    }
  }, [isMuted, volume]);

  // Handle play/pause toggle
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn("Autoplay failed or was blocked:", err);
        setIsPlaying(false);
      });
    }
  };

  // Handle mute toggle
  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Handle volume slider change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      setIsMuted(false);
    }
  };

  // Handle timeline slider change
  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = parseFloat(e.target.value);
    video.currentTime = val;
    setCurrentTime(val);
  };

  // Update time and duration states
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration || 10);
    }
  };

  // Reset at completion
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Handle fullscreen toggle
  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        toast.error("Could not enter fullscreen mode");
        console.error(err);
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for native fullscreen changes (e.g. if user exits with Esc)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Show controls on activity and auto-hide after delay
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        window.clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying]);

  // Download video file
  const handleDownload = async () => {
    try {
      toast.loading("Preparing your download...", { id: "download" });
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      // Sanitize topic to make a safe filename
      const safeName = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "kidtok-cartoon";
      a.download = `${safeName}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Download complete!", { id: "download" });
    } catch (err) {
      toast.error("Failed to download video directly. Opening in new tab instead.", { id: "download" });
      window.open(videoUrl, "_blank");
    }
  };

  // Replay
  const handleReplay = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().then(() => {
        setIsPlaying(true);
      });
    }
  };

  // Format time (e.g., 0:05)
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto space-y-6">
      {/* Cinematic container with dynamic ambient lighting glow shadow */}
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        className={`group relative w-full aspect-video rounded-3xl overflow-hidden bg-black shadow-2xl transition-all duration-500 border border-white/10 ${
          isPlaying ? "shadow-[0_0_50px_rgba(var(--color-primary-rgb,139,92,246),0.25)]" : "shadow-[0_0_30px_rgba(0,0,0,0.5)]"
        }`}
      >
        {/* Ambient glow backing matching general color scheme */}
        <div className="absolute -inset-4 bg-gradient-to-tr from-primary/20 via-accent/15 to-sunshine/15 blur-3xl opacity-60 pointer-events-none -z-10" />

        {/* The HTML5 Video Element */}
        <video
          ref={videoRef}
          src={videoUrl}
          onClick={togglePlay}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          playsInline
          autoPlay
          className="w-full h-full object-cover cursor-pointer"
        />

        {/* Ambient Overlay to blend lighting */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 via-transparent to-black/10 mix-blend-overlay" />

        {/* Topic Title Badge */}
        <div 
          className={`absolute top-4 left-4 right-4 flex items-center justify-between transition-all duration-500 pointer-events-none ${
            showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
          }`}
        >
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white shadow-lg">
            <Film className="h-4 w-4 text-accent animate-pulse" />
            <span className="text-xs sm:text-sm font-bold truncate max-w-[200px] sm:max-w-md">
              {topic}
            </span>
          </div>

          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-sunshine text-xs font-bold shadow-lg">
            <Sparkles className="h-3.5 w-3.5 fill-sunshine" />
            <span>Gemini Omni Video</span>
          </div>
        </div>

        {/* Play/Pause Large Center Overlay Button */}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button 
              onClick={togglePlay}
              className="pointer-events-auto h-20 w-20 flex items-center justify-center rounded-full bg-primary/95 text-white shadow-2xl scale-100 hover:scale-110 active:scale-95 transition-all duration-300 border border-white/20 hover:bg-primary-glow"
              aria-label="Play video"
            >
              <Play className="h-9 w-9 fill-white ml-1 text-white" />
            </button>
          </div>
        )}

        {/* Premium Cinematic Controller Overlay */}
        <div 
          className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 flex flex-col gap-3 transition-all duration-500 ${
            showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          {/* Timeline and duration */}
          <div className="flex items-center gap-3 w-full">
            <span className="text-xs font-bold text-white font-mono select-none w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 10}
              step="0.01"
              value={currentTime}
              onChange={handleTimelineChange}
              className="flex-1 accent-primary bg-white/20 h-1.5 rounded-lg cursor-pointer hover:bg-white/30 transition-colors"
              style={{
                background: `linear-gradient(to right, rgb(139, 92, 246) 0%, rgb(139, 92, 246) ${((currentTime / (duration || 10)) * 100).toFixed(2)}%, rgba(255, 255, 255, 0.2) ${((currentTime / (duration || 10)) * 100).toFixed(2)}%, rgba(255, 255, 255, 0.2) 100%)`
              }}
            />
            <span className="text-xs font-bold text-white/70 font-mono select-none w-10">
              {formatTime(duration)}
            </span>
          </div>

          {/* Buttons and volume */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Play/Pause Button */}
              <button
                onClick={togglePlay}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white ml-0.5" />}
              </button>

              {/* Replay Button */}
              <button
                onClick={handleReplay}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Replay"
              >
                <RotateCcw className="h-5 w-5" />
              </button>

              {/* Volume Controller */}
              <div className="flex items-center gap-2 group/volume">
                <button
                  onClick={toggleMute}
                  className="h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                  aria-label={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-300 accent-white h-1 rounded-lg cursor-pointer bg-white/25"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Direct Download Button inside the controls overlay */}
              <button
                onClick={handleDownload}
                className="h-10 px-4 flex items-center gap-2 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-xs sm:text-sm shadow-md transition-colors"
                title="Download Cartoon Movie"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Save Movie</span>
              </button>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Additional UI actions under the video player */}
      <div className="flex flex-col sm:flex-row items-center justify-between w-full p-4 rounded-3xl bg-card border border-border shadow-soft gap-4">
        <div>
          <h3 className="font-extrabold text-lg sm:text-xl">🎬 Cinematic Omni Movie</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            This is a single-shot continuous cartoon movie generated using Google's newest multi-modal Gemini Omni Video model.
          </p>
        </div>
        
        <button
          onClick={handleDownload}
          className="w-full sm:w-auto btn-gradient hover:[--tw:0] px-6 py-3 rounded-full font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98] select-none shrink-0"
        >
          <Download className="h-5 w-5" />
          Download Cartoon (.mp4)
        </button>
      </div>
    </div>
  );
}
