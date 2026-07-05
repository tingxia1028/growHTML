// Mistake-Photo Kit commands — the 拍错题 capture command. It takes a photo REF
// (`payload.images[0]`, imported into the vault as an asset by the capture UI), runs the
// VLM extract prompt server-side (the image rides `generateStructured`'s SIBLING `images`,
// resolved to bytes + vision-gated in generateKitContent), and hands the extracted
// `mistake` draft to the host's preview stage (onGenerated). It is ANCHOR-LESS — a photo
// mistake has no passage — so it rides the generateReviewPackCommand precedent
// (`anchorId: undefined`, preview-then-Save persists it unanchored), NOT autoMaterialize.
//
// These are host Commands; the kit registers this via KitInstallContext.commands.

import { MISTAKE_CONTENT_TYPE } from "../../core/notes/contentTypes";
import type { Command, CommandContext } from "../../client/commands/registry";

export const MISTAKE_PHOTO_EXTRACT_PROMPT = "mistake-photo.extract";

export const captureMistakePhotoCommand: Command = {
  id: "mistake-photo.capture",
  title: { zh: "拍错题", en: "Capture Mistake Photo" },
  group: "mistake-photo",
  // Runnable once a photo is staged on the payload (the capture UI imports it → an
  // {type:"image", assetId} REF). DEGRADE-NOT-DISAPPEAR: availability keys on the photo,
  // not on the provider's vision capability — a non-vision send surfaces the clean 400 once.
  isAvailable: (ctx) => (ctx.payload.images?.length ?? 0) > 0,
  run: async (ctx: CommandContext) => {
    const images = ctx.payload.images ?? [];
    if (images.length === 0) return;
    const hint = ctx.payload.text?.trim();
    const input: Record<string, unknown> = hint ? { hint } : {};
    const { content, concepts } = await ctx.client.generateStructured({
      promptId: MISTAKE_PHOTO_EXTRACT_PROMPT,
      contentType: MISTAKE_CONTENT_TYPE,
      input,
      // The photo rides as the SIBLING `images` (never inside `input`) — the server
      // resolves the REF to bytes for a vision provider before the VLM call.
      images
    });
    // Preview path: a photo mistake is anchor-less, so the draft carries
    // anchorId: undefined and Save persists it unanchored (generateReviewPackCommand
    // precedent). The kit ALWAYS previews (no legacy auto-save fallback — a photo
    // extraction should never silently persist an unreviewed card).
    ctx.actions.onGenerated?.({
      promptId: MISTAKE_PHOTO_EXTRACT_PROMPT,
      contentType: MISTAKE_CONTENT_TYPE,
      input,
      content,
      anchorId: undefined,
      sourceId: ctx.sourceId,
      ...(concepts && concepts.length > 0 ? { concepts } : {})
    });
  }
};

export const mistakePhotoCommands: Command[] = [captureMistakePhotoCommand];
