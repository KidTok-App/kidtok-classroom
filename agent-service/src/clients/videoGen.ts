/**
 * KieOmniVideoGenerator — Integration with Kie.ai standard `gemini-omni-video`
 * model for generating high-fidelity contiguous educational movies.
 *
 * All operations are instrumented with OpenTelemetry tracing (Arize Phoenix / OpenInference).
 */

import { trace, type Tracer } from "@opentelemetry/api";
import { withSpan, SPAN_KIND_ATTR, SPAN_KINDS } from "../tracing.js";
import type { VideoGen } from "./interfaces.js";

export class KieOmniVideoGenerator implements VideoGen {
  private readonly tracer: Tracer;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly isFakeMode: boolean = false,
  ) {
    this.tracer = trace.getTracer("kidtok-classroom");
  }

  async generateVideo(prompt: string, referenceImageUrl?: string): Promise<string> {
    return withSpan(
      this.tracer,
      "KieOmniVideoGenerator.generateVideo",
      {
        [SPAN_KIND_ATTR]: SPAN_KINDS.TOOL,
        "input.prompt": prompt,
        "input.model_name": "gemini-omni-video",
        ...(referenceImageUrl ? { "input.reference_image": referenceImageUrl } : {}),
      },
      async (span) => {
        // Safe check for mock/offline fallback
        if (this.isFakeMode || !this.apiKey || this.apiKey === "mock" || this.apiKey.startsWith("mock-")) {
          console.log("[videoGen] KieOmniVideoGenerator running in mock/fallback mode.");
          await new Promise((r) => setTimeout(r, 2000)); // short mock delay
          const mockUrl = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
          span.setAttribute("output.video_url", mockUrl);
          span.setAttribute("video.status", "mock_success");
          return mockUrl;
        }

        console.log(`[videoGen] Dispatching gemini-omni-video job to Kie.ai...`);
        
        // 1. Create the task job
        const createResp = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: "gemini-omni-video",
            input: {
              prompt,
              image_urls: referenceImageUrl ? [referenceImageUrl] : [],
              duration: "8",
              aspect_ratio: "16:9",
              resolution: "720p",
            },
          }),
        });

        if (!createResp.ok) {
          const errText = await createResp.text();
          throw new Error(`Kie.ai task creation failed with status ${createResp.status}: ${errText}`);
        }

        const createData = (await createResp.json()) as { taskId?: string; error?: string; data?: { taskId?: string } };
        const taskId = createData.taskId || createData.data?.taskId;

        if (!taskId) {
          throw new Error(`Kie.ai response missing taskId: ${JSON.stringify(createData)}`);
        }

        span.setAttribute("video.task_id", taskId);
        console.log(`[videoGen] Kie.ai task created successfully. Task ID: ${taskId}. Starting status polling...`);

        // 2. Poll status (max 120s loop)
        const maxAttempts = 40;
        const pollIntervalMs = 3000;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));

          const pollResp = await fetch(`https://api.kie.ai/api/v1/jobs/getTask?taskId=${taskId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          });

          if (!pollResp.ok) {
            console.warn(`[videoGen] Poll attempt ${attempt} failed with HTTP ${pollResp.status}`);
            continue;
          }

          const pollData = (await pollResp.json()) as {
            status?: string;
            result?: { video_url?: string; url?: string; videoUrl?: string };
            error?: string;
          };

          const status = pollData.status?.toLowerCase();
          console.log(`[videoGen] Polling Kie.ai task=${taskId} attempt=${attempt}/${maxAttempts} status=${status}`);

          if (status === "succeeded" || status === "success") {
            const videoUrl = pollData.result?.video_url || pollData.result?.url || pollData.result?.videoUrl;
            if (!videoUrl) {
              throw new Error(`Kie.ai task succeeded but missing video URL in results: ${JSON.stringify(pollData)}`);
            }
            span.setAttribute("output.video_url", videoUrl);
            span.setAttribute("video.status", "succeeded");
            console.log(`[videoGen] Video generation SUCCEEDED. URL: ${videoUrl}`);
            return videoUrl;
          }

          if (status === "failed" || status === "error") {
            throw new Error(`Kie.ai video generation task failed: ${pollData.error || "unknown error"}`);
          }
        }

        throw new Error(`Kie.ai video generation timed out after ${maxAttempts * (pollIntervalMs / 1000)} seconds.`);
      }
    );
  }
}
