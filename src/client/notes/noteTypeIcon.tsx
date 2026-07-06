// noteTypeIcon — a small, central contentType → lucide icon map. Used by the right
// column's "Linked notes" icon row (and reusable anywhere a note-type glyph is wanted)
// so every surface shows the SAME icon for a given note type without each view inventing
// its own mapping. Unknown types fall back to a generic file-text glyph.

import {
  AlertTriangle,
  Bookmark,
  BookOpen,
  Code2,
  CreditCard,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  Network,
  PackageCheck,
  Play,
  Workflow,
  type LucideIcon
} from "lucide-react";

// Exported so the framework-free marker-glyph map in annotationLayer.ts can be
// asserted (in a unit test) to cover every note type this icon map knows about —
// the two must stay in sync so a passage's inline marker matches its list icon.
export const ICONS: Record<string, LucideIcon> = {
  markdown: FileText,
  "plain-text": FileText,
  flashcard: CreditCard,
  quiz: ListChecks,
  image: ImageIcon,
  media: Play,
  video: Play,
  audio: Play,
  code: Code2,
  "code-snippet": Code2,
  html: Code2,
  "html-sandbox": Code2,
  mermaid: Workflow,
  markmap: Network,
  mindmap: Network,
  concept: HelpCircle,
  bookmark: Bookmark,
  "textbook.explanation": BookOpen,
  "textbook.exercise": ListChecks,
  "textbook.review-pack": PackageCheck,
  mistake: AlertTriangle,
  "textbook.mistake": AlertTriangle
};

/** The lucide icon component for a note contentType (generic file glyph if unknown). */
export function noteTypeIcon(contentType: string | undefined): LucideIcon {
  return ICONS[contentType ?? "markdown"] ?? FileText;
}
