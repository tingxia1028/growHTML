// ChatMessageBody — a chat message body (requirement 1 — rich artifacts show as
// cards). The reply is classified through the SAME identification seam saving uses
// (classifyContent): a HIGH-confidence rich form (markmap / mermaid / code-snippet /
// html — anything but markdown) becomes a clickable ArtifactCard that opens the
// interactive view CENTERED in a FocusOverlay. Everything else (low confidence, or
// plain markdown) renders inline as markdown — through the one sanctioned
// getNoteType().render path, never a bespoke bypass (display-side HARD contract
// §0.5-B / §6.6).
//
// §10 actions: an assistant reply is also actionable — a small actions row sits
// beneath the body. It ALWAYS carries 朗读 (SPEECH-1b: every AI answer is readable);
// when the host passes `onAddNote` / `onRegenerate` the row also lets the user keep
// the generated artifact ("Add as note") or re-run the question ("Regenerate"). The
// actions are siblings of the card, so they don't interfere with the card's
// click-to-open gesture.
//
// A small standalone host component so it is unit-testable without pulling the whole
// workspace view tree (PdfReader/pdfjs etc.) — the actions arrive as plain callbacks.

import { FilePlus2, RefreshCw } from "lucide-react";
import { classifyContent } from "../../core/notes/classifyContent";
import type { ContentPart } from "../data/entityClient";
import { assetUrl } from "../data/assetUrl";
import { getNoteType } from "../notes/noteTypeRegistry";
import { ArtifactCard } from "./ArtifactCard";
// 朗读 (SPEECH-1b 朗读通用化): every ASSISTANT reply is readable — the user's law says
// read-aloud is a property of ALL text, AI answers included. One shared SpeakButton
// per assistant bubble, riding the existing actions row (compact, status-gated).
import { SpeakButton } from "../speech/SpeakButton";

/**
 * The DISPLAY text of a message: a bare string verbatim, or (for a part array) ONLY the
 * text parts joined — the image parts render as thumbnails (MessageImages), so their
 * `[image]` placeholder is dropped here to avoid a doubled "[image]" beside the picture.
 */
function displayText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * V-1 (vision-input.md §2): the image THUMBNAILS of a multimodal message. Each image
 * part renders a `<img src="/api/assets/:assetId">` (the existing byte route) so an
 * attached image shows in the transcript; a string message has none. Kept in ONE place
 * (reused by the views/AgentTranscript call sites through ChatMessageBody). Never
 * crashes on an array.
 */
function MessageImages({ content }: { content: string | ContentPart[] }) {
  if (typeof content === "string") return null;
  const images = content.filter((part): part is Extract<ContentPart, { type: "image" }> => part.type === "image");
  if (images.length === 0) return null;
  return (
    <div className="chat-msg-images">
      {images.map((part, index) => (
        <img
          key={`${part.assetId}-${index}`}
          className="chat-msg-image"
          src={assetUrl(part.assetId)}
          alt="attached image"
          loading="lazy"
        />
      ))}
    </div>
  );
}

export function ChatMessageBody({
  role,
  content,
  onAddNote,
  onRegenerate,
  busy = false
}: {
  role: string;
  // V-1 (vision-input.md §2): a message may carry multimodal content parts (an image
  // attachment on a user turn). commit 1 collapses to text; the image THUMBNAIL render
  // lands in commit 5 (delta 4). Assistant replies are always plain strings.
  content: string | ContentPart[];
  /** §10 "Add as note" — keep this reply as a note (host classifies + persists). */
  onAddNote?: (content: string) => void;
  /** §10 "Regenerate" — re-run the question that produced this reply. */
  onRegenerate?: () => void;
  /** Disable the actions while a save/regenerate is already in flight. */
  busy?: boolean;
}) {
  // V-1: the message's DISPLAY text for the markdown / classify path (image parts are
  // dropped here — they render as thumbnails alongside via MessageImages).
  const text = displayText(content);

  // The user's own prompt is plain text with no actions; only assistant replies are
  // classified into cards and carry the keep/re-run actions. An image attachment shows
  // its thumbnail(s) above the (possibly empty) text.
  if (role !== "assistant") {
    return (
      <>
        <MessageImages content={content} />
        {text ? getNoteType("markdown")?.render({ content: text }) ?? null : null}
      </>
    );
  }

  const detected = classifyContent(text);
  const body =
    detected.confidence === "high" && detected.contentType !== "markdown" ? (
      <ArtifactCard block={{ contentType: detected.contentType, content: detected.content }} />
    ) : (
      getNoteType("markdown")?.render({ content: text }) ?? null
    );

  return (
    <div className="chat-artifact">
      {body}
      <div className="chat-artifact-actions">
        {/* 朗读 — reads this reply's raw text (SPEECH-1b). Always present on an
            assistant bubble (disabled until the shared status probe says available). */}
        <SpeakButton className="chat-reply-speak" text={text} size={14} />
        {onAddNote ? (
          <button
            type="button"
            className="chat-artifact-action chat-artifact-add"
            title="Save this reply as a note"
            disabled={busy}
            onClick={() => onAddNote(text)}
          >
            <FilePlus2 size={13} />
            Add as note
          </button>
        ) : null}
        {onRegenerate ? (
          <button
            type="button"
            className="chat-artifact-action chat-artifact-regen"
            title="Re-run the question that produced this reply"
            disabled={busy}
            onClick={() => onRegenerate()}
          >
            <RefreshCw size={13} />
            Regenerate
          </button>
        ) : null}
      </div>
    </div>
  );
}
