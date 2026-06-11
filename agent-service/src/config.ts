/**
 * Environment configuration for the KidTok Classroom agent service.
 * Every value is documented in agent-service/.env.example.
 */

export interface ServiceConfig {
  port: number;
  /** Google Cloud project (accepts GOOGLE_CLOUD_PROJECT_ID or GOOGLE_CLOUD_PROJECT). */
  projectId: string;
  /** Regional location used for regional-policy models. */
  region: string;
  /** Text model for all LLM-backed agents (orchestrator brain). */
  textModel: string;
  /** Image model for SceneImageAgent. */
  imageModel: string;
  gcsBucket: string;
  firestoreCollection: string;
  ttsVoiceName: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  phoenixHost: string;
  phoenixApiKey: string;
  phoenixProject: string;
  /** Optional full override of the MCP server launch command, e.g. "npx -y @arizeai/phoenix-mcp@latest". */
  phoenixMcpCommand: string;
  scenePromptName: string;
  enableVisualSafety: boolean;
  /** Test-only seam: swap every external provider for in-process fakes. NEVER enable in production. */
  fakeProviders: boolean;
  /** "adk" (Google Agent Development Kit, primary) or "rest" (documented fallback pipeline). */
  orchestratorEngine: "adk" | "rest";
  elevenlabsApiKey?: string;
  kieApiKey?: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const fakeProviders = bool(env.KIDTOK_FAKE_PROVIDERS, false);
  const config: ServiceConfig = {
    port: num(env.PORT, 8080),
    projectId: env.GOOGLE_CLOUD_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || "",
    region: env.GOOGLE_CLOUD_REGION || env.GOOGLE_CLOUD_LOCATION || "us-central1",
    textModel: env.GEMINI_TEXT_MODEL || "gemini-3-flash",
    imageModel: env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
    gcsBucket: env.GCS_BUCKET || "",
    firestoreCollection: env.FIRESTORE_COLLECTION || "episodes",
    ttsVoiceName: env.TTS_VOICE_NAME || "en-US-Neural2-F",
    ttsSpeakingRate: num(env.TTS_SPEAKING_RATE, 0.92),
    ttsPitch: num(env.TTS_PITCH, 1.0),
    phoenixHost: (env.PHOENIX_HOST || "").replace(/\/$/, ""),
    phoenixApiKey: env.PHOENIX_API_KEY || "",
    phoenixProject: env.PHOENIX_PROJECT || "kidtok-classroom",
    phoenixMcpCommand: env.PHOENIX_MCP_COMMAND || "",
    scenePromptName: env.SCENE_PROMPT_NAME || "kidtok-scene-prompt",
    enableVisualSafety: bool(env.ENABLE_VISUAL_ASSET_SAFETY, true),
    fakeProviders,
    orchestratorEngine: (env.ORCHESTRATOR_ENGINE === "rest" ? "rest" : "adk"),
    elevenlabsApiKey: env.ELEVENLABS_API_KEY || "",
    kieApiKey: env.KIE_API_KEY || "",
  };

  if (!fakeProviders) {
    const missing: string[] = [];
    if (!config.projectId) missing.push("GOOGLE_CLOUD_PROJECT_ID");
    if (!config.gcsBucket) missing.push("GCS_BUCKET");
    if (!config.phoenixHost) missing.push("PHOENIX_HOST");
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}. ` +
          `Set them (see agent-service/.env.example) or run with KIDTOK_FAKE_PROVIDERS=1 for the offline smoke mode.`,
      );
    }
    // The Google GenAI SDK used by the ADK engine reads these process-level
    // variables. Normalize so operators only have to set the KidTok names.
    if (!env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = config.projectId;
    if (!env.GOOGLE_CLOUD_LOCATION) process.env.GOOGLE_CLOUD_LOCATION = "global";
    if (!env.GOOGLE_GENAI_USE_VERTEXAI) process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  }

  return config;
}
