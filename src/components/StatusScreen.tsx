import { type AgentStatus, PIPELINE_STEPS, STATUS_COPY } from "@/lib/agentApi";
import { StarSparkle } from "./StarSparkle";

interface StatusScreenProps {
  status: AgentStatus;
  topic: string;
}

export function StatusScreen({ status, topic }: StatusScreenProps) {
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
      <p className="text-lg text-muted-foreground max-w-md mb-10">{copy.subtitle}</p>

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
