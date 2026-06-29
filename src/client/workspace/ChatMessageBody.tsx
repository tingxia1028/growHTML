// ChatMessageBody — a chat message body (requirement 1 — rich artifacts show as
// cards). The reply is classified through the SAME identification seam saving uses
// (classifyContent): a HIGH-confidence rich form (markmap / mermaid / code-snippet —
// anything but markdown) becomes a clickable ArtifactCard that opens the interactive
// view CENTERED in a FocusOverlay. Everything else (low confidence, or plain markdown)
// renders inline as markdown — through the one sanctioned getNoteType().render path,
// never a bespoke bypass (display-side HARD contract §0.5-B / §6.6).
//
// A small standalone host component so it is unit-testable without pulling the whole
// workspace view tree (PdfReader/pdfjs etc.).

import { classifyContent } from "../../core/notes/classifyContent";
import { getNoteType } from "../notes/noteTypeRegistry";
import { ArtifactCard } from "./ArtifactCard";

export function ChatMessageBody({ role, content }: { role: string; content: string }) {
  // Only assistant replies are classified into cards; the user's own prompt is text.
  if (role === "assistant") {
    const detected = classifyContent(content);
    if (detected.confidence === "high" && detected.contentType !== "markdown") {
      return <ArtifactCard block={{ contentType: detected.contentType, content: detected.content }} />;
    }
  }
  return <>{getNoteType("markdown")?.render({ content }) ?? null}</>;
}
