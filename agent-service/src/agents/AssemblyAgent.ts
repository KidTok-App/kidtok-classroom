/**
 * AssemblyAgent — writes the final manifest to Firestore:
 * scenes [{ index, imageUrl, audioUrl, caption, durationMs, animation }] with
 * animation cycling kenburns-in / pan-left / kenburns-out / pan-right, then
 * sets status "reviewing".
 */

import type { EpisodeStore } from "../clients/interfaces.js";
import { ANIMATION_CYCLE, type EpisodeScript, type SceneAsset } from "../types.js";
import type { SceneImageResult } from "./SceneImageAgent.js";
import type { NarrationResult } from "./NarrationAgent.js";

export class AssemblyAgent {
  constructor(private readonly store: EpisodeStore) {}

  async run(input: {
    episodeId: string;
    script: EpisodeScript;
    images: SceneImageResult[];
    narrations: NarrationResult[];
  }): Promise<SceneAsset[]> {
    const imageByIndex = new Map(input.images.map((i) => [i.index, i]));
    const narrationByIndex = new Map(input.narrations.map((n) => [n.index, n]));

    const scenes: SceneAsset[] = input.script.scenes.map((scriptScene, index) => {
      const image = imageByIndex.get(index);
      const narration = narrationByIndex.get(index);
      if (!image) throw new Error(`ASSEMBLY_MISSING_IMAGE scene=${index}`);
      if (!narration) throw new Error(`ASSEMBLY_MISSING_NARRATION scene=${index}`);
      const animation = ANIMATION_CYCLE[index % ANIMATION_CYCLE.length] ?? "kenburns-in";
      return {
        index,
        imageUrl: image.imageUrl,
        audioUrl: narration.audioUrl,
        caption: scriptScene.caption,
        durationMs: narration.durationMs,
        animation,
        ...(image.degraded ? { degraded: true } : {}),
      };
    });

    await this.store.update(input.episodeId, {
      title: input.script.title,
      scenes,
      status: "reviewing",
    });

    return scenes;
  }
}
