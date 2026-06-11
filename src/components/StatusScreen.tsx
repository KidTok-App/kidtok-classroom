import { type AgentStatus, PIPELINE_STEPS, STATUS_COPY } from "@/lib/agentApi";
import { StarSparkle } from "./StarSparkle";
import { Progress } from "./ui/progress";

interface StatusScreenProps {
  status: AgentStatus;
  topic: string;
  progress?: number;
}

export function StatusScreen({ status, topic, progress }: StatusScreenProps) {
  const copy = STATUS_COPY[status];
  const isFailed = status === "failed";

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 py-12">
      <div className={`text-sunshine mb-6 ${isFailed ? "" : "mascot-bob"}`}>
        <StarSparkle size={88} />
      </div>
      <p className="text-sm uppercase tracking-widest text-muted-foreground mb-2">
        Topic: {topic}
      </p>
      <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">{copy.title}</h2>
      <p className="text-lg text-muted-foreground max-w-md mb-6">{copy.subtitle}</p>

      {progress !== undefined && (
        <div className="flex flex-col items-center gap-2 mb-10 w-full max-w-xs animate-fade-in">
          <Progress value={progress} className="h-3 bg-primary/10 shadow-inner border border-white/5 [&>div]:bg-sunshine" />
          <span className="text-sm font-bold text-sunshine tracking-wider">{progress}% loaded</span>
        </div>
      )}

      {progress === undefined && <div className="mb-10" />}

      {!isFailed && (
        <ol className="flex flex-wrap items-center justify-center gap-2 max-w-2xl">
          {PIPELINE_STEPS.map((label, i) => {
            const stepNum = i + 1;
            const done = stepNum < copy.step;
            const active = stepNum === copy.step;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={[
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all",
                    done && "bg-primary text-primary-foreground",
                    active && "bg-sunshine text-sunshine-foreground twinkle",
                    !done && !active && "bg-muted text-muted-foreground",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {label}
                </span>
                {i < PIPELINE_STEPS.length - 1 && (
                  <span className="text-muted-foreground">→</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
