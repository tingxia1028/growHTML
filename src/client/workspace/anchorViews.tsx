// anchor.excerpt (R1) — the top section of the redesigned RIGHT column: a compact card
// showing the CURRENT anchor's excerpt + page/source line (spec §0 RIGHT.1). It reads the
// shared focus (focus.anchor, else focus.draft's quote) — no new state. Detailed styling
// is R4; this is the minimal, working section so the right column has its Anchor segment.

import { Anchor } from "lucide-react";
import { registerView, type WorkspaceContext } from "./viewRegistry";
import { draftQuoteText } from "../focus/FocusContext";

function AnchorExcerptView({ ctx }: { ctx: WorkspaceContext }) {
  const { focus, activeSource } = ctx;
  const anchor = focus.anchor;
  const quote = anchor?.quote ?? draftQuoteText(focus.draft);
  const page = anchor && "page" in anchor ? anchor.page : undefined;

  return (
    <aside className="anchor-panel">
      <div className="panel-title">
        <Anchor size={16} />
        Anchor
      </div>
      {quote ? (
        <div className="anchor-excerpt-card">
          <p className="anchor-excerpt-quote">{quote}</p>
          <p className="anchor-excerpt-meta">
            {page != null ? `Page ${page} · ` : ""}
            {activeSource?.title ?? "Current source"}
          </p>
        </div>
      ) : (
        <p className="anchor-excerpt-empty">Select a passage to focus an anchor.</p>
      )}
    </aside>
  );
}

registerView({ kind: "anchor.excerpt", render: (_node, ctx) => <AnchorExcerptView ctx={ctx} /> });
