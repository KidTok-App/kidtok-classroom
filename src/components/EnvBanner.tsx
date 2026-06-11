import { isApiConfigured } from "@/lib/agentApi";
import { AlertTriangle } from "lucide-react";

export function EnvBanner() {
  if (isApiConfigured()) return null;
  return (
    <div className="bg-sunshine text-sunshine-foreground border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-start gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          <strong>Backend not configured.</strong> Set{" "}
          <code className="px-1 rounded bg-background/40 font-mono">VITE_AGENT_API_URL</code>{" "}
          to your agent server URL to create and play cartoons.
        </p>
      </div>
    </div>
  );
}
