/**
 * Fake providers — TEST-ONLY seam (KIDTOK_FAKE_PROVIDERS=1).
 *
 * Lets the entire API + orchestrator + tracing + review loop run end-to-end
 * with zero external calls, so the pipeline can be smoke-verified before
 * Google/Phoenix credentials exist. The production wiring never imports this
 * module unless the flag is set. No external vendor is involved either way.
 */

import fs from "node:fs";
import path from "node:path";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { readableSpanToSummary } from "../tracing.js";
import { renderPlaceholderPng } from "../lib/placeholderPng.js";
import type { EpisodeDoc, SpanSummary } from "../types.js";
import type {
  AssetStorage,
  EpisodeStore,
  GeneratedImage,
  ImageGen,
  PhoenixMcp,
  PromptVersion,
  PromptHistoryItem,
  SpeechSynth,
  TextLlm,
  TextLlmRequest,
  VisualSafetyClassifier,
  VisualSafetyVerdict,
  VideoGen,
} from "./interfaces.js";

export class FakeTextLlm implements TextLlm {
  readonly engine = "fake";
  readonly model = "fake-gemini";

  async generateJson<T>(req: TextLlmRequest): Promise<T> {
    await sleep(40);
    const user = req.user;

    if (req.spanName === "safety-check") {
      return { verdict: "safe", reasons: [] } as T;
    }

    if (req.spanName === "script-agent") {
      const topicMatch = user.match(/Topic:\s*"([^"]+)"/i);
      const topic = topicMatch?.[1] ?? "the topic";
      const scenes = [1, 2, 3, 4, 5].map((n) => ({
        caption: `Scene ${n}: exploring ${topic}`,
        narrationText: `Here is part ${n} of our story about ${topic}. Wow, look at that! Can you see it too?`,
        learningPoint: `Key idea ${n} about ${topic}.`,
      }));
      return { title: `All About ${topic}!`, scenes } as T;
    }

    if (req.spanName === "scene-planner") {
      const descriptions = [1, 2, 3, 4, 5].map(
        (n) =>
          `A cheerful cartoon illustration for beat ${n}: a friendly round mascot observing the lesson subject, big readable shapes, soft daylight`,
      );
      return { descriptions } as T;
    }

    if (req.spanName === "prompt-llm-sanitizer") {
      const m = user.match(/=== ORIGINAL PROMPT ===\n([\s\S]*?)\n=== END ORIGINAL PROMPT ===/);
      return {
        sanitized_prompt: m?.[1] ?? user,
        removed_concepts: [],
        was_changed: false,
      } as T;
    }

    if (req.spanName === "review-alignment") {
      return {
        alignmentScore: 9,
        notes: "Captions and narration tell the same story beat for beat.",
      } as T;
    }

    if (req.spanName === "review-prompt-improvement") {
      return {
        improvedTemplate:
          "{visual_description}. A scene from an educational cartoon about {topic} for a {age_label}. {age_visual_style} Global art direction: warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors, gentle lighting, uncluttered composition with one clear focal point. Keep one single subject, plain simple background. No text, no letters, no numbers, no captions, no watermarks anywhere in the image. No photorealistic humans; stylized cartoon characters only.",
        changeSummary: "Tightened composition guidance to reduce retries.",
      } as T;
    }

    throw new Error(`FakeTextLlm: no canned response for spanName=${req.spanName}`);
  }
}

export class FakeImageGen implements ImageGen {
  readonly model = "fake-image";
  private calls = 0;
  constructor(private readonly failFirstAttemptForScene: number | null = null) {}

  async generatePng(_prompt: string): Promise<GeneratedImage | null> {
    await sleep(30);
    const call = this.calls++;
    // Optionally simulate one safety rejection to exercise the retry path.
    if (this.failFirstAttemptForScene !== null && call === this.failFirstAttemptForScene) {
      return null;
    }
    const hue = (call * 37) % 200;
    return {
      data: renderPlaceholderPng({
        from: [255 - hue / 2, 214, 165 + hue / 4],
        to: [173, 216 - hue / 3, 230],
      }),
      mimeType: "image/png",
    };
  }
}

export class FakeVisualSafety implements VisualSafetyClassifier {
  async classify(): Promise<VisualSafetyVerdict> {
    return { safe: true, reasons: [], categories: [], soft_categories: [] };
  }
}

export class FakeSpeechSynth implements SpeechSynth {
  async synthesizeMp3(text: string): Promise<Buffer> {
    await sleep(20);
    // Pseudo-MP3 sized so the CBR duration estimate scales with text length
    // (~12.5 ms per character at the Google TTS 32kbps estimate).
    const bytes = Math.max(2000, text.length * 50);
    const buf = Buffer.alloc(bytes, 0x55);
    buf.write("ID3", 0, "ascii");
    return buf;
  }
}

export class LocalDirStorage implements AssetStorage {
  constructor(
    private readonly baseDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  async uploadBuffer(objectPath: string, data: Buffer, _contentType: string): Promise<string> {
    const full = path.join(this.baseDir, objectPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, data);
    return `${this.publicBaseUrl}/${objectPath}`;
  }
}

export class InMemoryEpisodeStore implements EpisodeStore {
  private docs = new Map<string, EpisodeDoc>();

  async create(doc: EpisodeDoc): Promise<void> {
    this.docs.set(doc.id, structuredClone(doc));
  }
  async update(id: string, patch: Partial<EpisodeDoc>): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`InMemoryEpisodeStore: unknown episode ${id}`);
    this.docs.set(id, { ...cur, ...structuredClone(patch) });
  }
  async get(id: string): Promise<EpisodeDoc | null> {
    const doc = this.docs.get(id);
    return doc ? structuredClone(doc) : null;
  }
  async list(ownerId?: string, limit = 50): Promise<EpisodeDoc[]> {
    let items = [...this.docs.values()];
    if (ownerId) {
      items = items.filter((d) => d.ownerId === ownerId);
    }
    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }
}

/**
 * Fake Phoenix MCP: in-memory prompt registry + spans served straight from
 * the in-memory OTel exporter, so the reviewer loop (fetch spans → score →
 * publish improved prompt → next episode picks it up) runs for real, offline.
 */
export class FakePhoenixMcp implements PhoenixMcp {
  private prompts = new Map<string, { template: string; version: number }>();
  private history = new Map<string, PromptHistoryItem[]>();

  constructor(private readonly memoryExporter: InMemorySpanExporter) {
    const name = "kidtok-scene-prompt";
    const v1Text = "A classroom cartoon illustration of {visual_description}. Topic: {topic}, age: {age_label}.";
    const v2Text = "A classroom cartoon illustration of {visual_description}. Topic: {topic}, age: {age_label}. Warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors. No text, no letters, no numbers, no captions, no watermarks anywhere in the image.";
    const v3Text = "{visual_description}. A scene from an educational cartoon about {topic} for a {age_label}. {age_visual_style} Global art direction: warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors, gentle lighting, uncluttered composition with one clear focal point. Keep one single subject, plain simple background. No text, no letters, no numbers, no captions, no watermarks anywhere in the image. No photorealistic humans; stylized cartoon characters only.";

    this.prompts.set(name, { template: v3Text, version: 3 });
    this.history.set(name, [
      {
        versionId: "fake-v1",
        template: v1Text,
        changeSummary: "Initial template for drawing cartoon scenes.",
        createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      },
      {
        versionId: "fake-v2",
        template: v2Text,
        changeSummary: "Added strong negative constraint rules to completely ban any text, letters, numbers, captions, and watermarks to avoid visual glitches.",
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      },
      {
        versionId: "fake-v3",
        template: v3Text,
        changeSummary: "Tightened compositional styling, added gentle lighting and simplified background rules to reduce downstream image generation retry rates and improve consistency.",
        createdAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      },
    ]);
  }

  async getLatestPrompt(name: string): Promise<PromptVersion | null> {
    const entry = this.prompts.get(name);
    if (!entry) return null;
    return { template: entry.template, versionId: `fake-v${entry.version}` };
  }

  async upsertPrompt(args: { name: string; description: string; template: string; changeSummary?: string }): Promise<PromptVersion> {
    const prev = this.prompts.get(args.name);
    const version = (prev?.version ?? 0) + 1;
    this.prompts.set(args.name, { template: args.template, version });
    
    const versionId = `fake-v${version}`;
    const item: PromptHistoryItem = {
      versionId,
      template: args.template,
      changeSummary: args.changeSummary ?? "Optimized prompt template via closed-loop quality telemetry.",
      createdAt: new Date().toISOString(),
    };
    
    const list = this.history.get(args.name) ?? [];
    list.push(item);
    this.history.set(args.name, list);
    
    return { template: args.template, versionId };
  }

  async getPromptHistory(name: string): Promise<PromptHistoryItem[]> {
    return this.history.get(name) ?? [];
  }

  async getEpisodeSpans(episodeId: string): Promise<SpanSummary[]> {
    return this.memoryExporter
      .getFinishedSpans()
      .map(readableSpanToSummary)
      .filter((s) => String(s.attributes["episodeId"] ?? "") === episodeId);
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}

export class FakeVideoGen implements VideoGen {
  async generateVideo(prompt: string, referenceImageUrl?: string): Promise<string> {
    await sleep(2500); // Simulate a short rendering delay
    // Beautiful, high-fidelity placeholder educational cartoon stream URL:
    return "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
