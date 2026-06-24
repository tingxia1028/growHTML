import { useEffect, useRef, useState } from "react";
import { getDiagramRenderer } from "../adapters/notes/diagrams";

// Renders a diagram-type note (mermaid, markmap) by mounting its SVG into a
// container. Falls back to an inline error if the source can't be parsed.
export function DiagramNote({ contentType, content }: { contentType: string; content: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    const renderer = getDiagramRenderer(contentType);
    if (!container || !renderer) return;

    let cancelled = false;
    setError("");
    Promise.resolve(renderer(container, content)).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Diagram render failed");
    });

    return () => {
      cancelled = true;
    };
  }, [contentType, content]);

  return (
    <div className="note-rendered">
      <div ref={containerRef} className={`note-diagram note-diagram-${contentType}`} />
      {error ? <pre className="sv-plain">{error}</pre> : null}
    </div>
  );
}
