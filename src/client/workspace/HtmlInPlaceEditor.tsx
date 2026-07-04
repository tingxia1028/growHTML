// HtmlInPlaceEditor — SRC-2b's 所见即改 surface for AUTHORED html sources. A same-doc
// iframe (the DomReader idiom: srcDoc-style document the host can reach into),
// sandboxed WITHOUT allow-scripts so nothing in the page runs while it is being
// edited, armed by prepareEditingDocument (body contenteditable + marked editing
// style). A compact floating style bar (SelectionFloatingToolbar's positioning idiom,
// scoped local: absolute inside the wrapper, flip-above near the bottom, mousedown-
// preventDefault so clicks don't collapse the selection) offers bold/italic/heading/
// size/color/alignment via the PURE applyInPlaceStyle transforms — never execCommand.
// The parent (AuthoredSourceView) pulls the sanitized serialization through the
// imperative handle whenever it needs the source text back (源码 toggle, 阅读, save).
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Italic
} from "lucide-react";
import { t } from "../i18n";
import { sourceAuthoringMessages as m } from "./sourceAuthoringMessages";
import {
  applyInPlaceStyle,
  detectHtmlShape,
  prepareEditingDocument,
  selectionRectInDoc,
  serializeEditingDocument,
  type HtmlDocShape,
  type InPlaceStyleAction
} from "./htmlInPlace";

export type HtmlInPlaceHandle = {
  /** The sanitized source text for the CURRENT edited DOM (null when no frame). */
  serialize(): string | null;
};

type Props = {
  /** The source text to load. Read ONCE on mount — the parent remounts (conditional
      render / key per source) whenever a fresh load is needed. */
  html: string;
  /** Any in-place change: typing (input events) or a style-bar action. */
  onInput(): void;
};

/** Gap between the selection rect and the bar; margin from the wrapper edges. */
const BAR_GAP = 8;
const BAR_MARGIN = 8;
/** Fallback bar height for the flip decision before it has been measured. */
const BAR_ESTIMATED_HEIGHT = 36;

const SWATCHES: Array<{ id: string; value: string; label: () => string }> = [
  { id: "red", value: "#d0342c", label: () => t(m.styleColorRed) },
  { id: "blue", value: "#2456c9", label: () => t(m.styleColorBlue) },
  { id: "green", value: "#1c7d3c", label: () => t(m.styleColorGreen) },
  { id: "orange", value: "#b3620d", label: () => t(m.styleColorOrange) }
];

export const HtmlInPlaceEditor = forwardRef<HtmlInPlaceHandle, Props>(function HtmlInPlaceEditor(
  { html, onInput },
  ref
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const shapeRef = useRef<HtmlDocShape>({ kind: "fragment", hasDoctype: false });
  const [barPos, setBarPos] = useState<{ top: number; left: number } | null>(null);
  // Latest callback in a ref — the doc listeners are bound once per mount.
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useImperativeHandle(
    ref,
    () => ({
      serialize: () => {
        const doc = frameRef.current?.contentDocument;
        if (!doc?.documentElement) return null;
        return serializeEditingDocument(doc, shapeRef.current);
      }
    }),
    []
  );

  // Position the bar near the selection: below it, centered (CSS translateX), clamped
  // to the wrapper, flipped ABOVE when it would poke past the bottom. Frame viewport
  // coords ARE wrapper coords — the iframe fills the wrapper at (0,0).
  const placeBar = () => {
    const doc = frameRef.current?.contentDocument;
    const wrap = wrapRef.current;
    if (!doc || !doc.body) return setBarPos(null);
    const selection = doc.getSelection?.();
    if (!selection || selection.rangeCount === 0) return setBarPos(null);
    const rect = selectionRectInDoc(doc);
    if (!rect) return setBarPos(null);
    const wrapW = wrap?.clientWidth ?? 0;
    const wrapH = wrap?.clientHeight ?? 0;
    const barH = barRef.current?.offsetHeight || BAR_ESTIMATED_HEIGHT;
    const barW = barRef.current?.offsetWidth ?? 0;
    let top = rect.bottom + BAR_GAP;
    if (wrapH && top + barH > wrapH - BAR_MARGIN) {
      top = Math.max(BAR_MARGIN, rect.top - barH - BAR_GAP);
    }
    let left = rect.left + rect.width / 2;
    if (wrapW) {
      const half = barW / 2 || 0;
      left = Math.max(BAR_MARGIN + half, Math.min(left, wrapW - BAR_MARGIN - half));
    }
    setBarPos({ top: Math.max(BAR_MARGIN, top), left: Math.max(BAR_MARGIN, left) });
  };

  // Arm the frame document once per mount: load the source text, flip on editing,
  // bind input (dirty) + selectionchange (bar) + Escape/blur (hide bar).
  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    shapeRef.current = detectHtmlShape(html);
    prepareEditingDocument(doc, html);

    const handleInput = () => onInputRef.current();
    const handleSelection = () => placeBar();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBarPos(null);
    };
    const hideBar = () => setBarPos(null);
    doc.addEventListener("input", handleInput);
    doc.addEventListener("selectionchange", handleSelection);
    doc.addEventListener("keydown", handleKey);
    frame.contentWindow?.addEventListener("blur", hideBar);
    return () => {
      doc.removeEventListener("input", handleInput);
      doc.removeEventListener("selectionchange", handleSelection);
      doc.removeEventListener("keydown", handleKey);
      frame.contentWindow?.removeEventListener("blur", hideBar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per mount; the parent remounts to reload
  }, []);

  const run = (action: InPlaceStyleAction) => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    if (applyInPlaceStyle(doc, action)) {
      onInputRef.current();
      placeBar(); // the selection (and its rect) may have moved with the wrap/retag
    }
  };

  const tools: Array<{ id: string; icon: ReactNode; label: string; action: InPlaceStyleAction }> = [
    { id: "bold", icon: <Bold size={15} />, label: t(m.styleBold), action: { kind: "bold" } },
    { id: "italic", icon: <Italic size={15} />, label: t(m.styleItalic), action: { kind: "italic" } },
    { id: "h1", icon: <Heading1 size={15} />, label: t(m.styleHeading), action: { kind: "block", tag: "h1" } },
    { id: "h2", icon: <Heading2 size={15} />, label: t(m.styleSubheading), action: { kind: "block", tag: "h2" } },
    { id: "font-large", icon: <AArrowUp size={15} />, label: t(m.styleTextLarge), action: { kind: "fontSize", value: "large" } },
    { id: "font-small", icon: <AArrowDown size={15} />, label: t(m.styleTextSmall), action: { kind: "fontSize", value: "small" } },
    { id: "align-left", icon: <AlignLeft size={15} />, label: t(m.styleAlignLeft), action: { kind: "align", value: "left" } },
    { id: "align-center", icon: <AlignCenter size={15} />, label: t(m.styleAlignCenter), action: { kind: "align", value: "center" } },
    { id: "align-right", icon: <AlignRight size={15} />, label: t(m.styleAlignRight), action: { kind: "align", value: "right" } }
  ];

  return (
    <div ref={wrapRef} className="source-editor-inplace">
      <iframe
        ref={frameRef}
        className="source-editor-inplace-frame"
        title={t(m.htmlViewPage)}
        // Same-origin so the host edits/serializes the document; NO allow-scripts —
        // nothing inside the page runs while it is being edited.
        sandbox="allow-same-origin"
      />
      {barPos ? (
        <div
          ref={barRef}
          className="source-editor-stylebar"
          role="toolbar"
          aria-label={t(m.styleBarLabel)}
          style={{ top: barPos.top, left: barPos.left }}
          // Don't steal the frame's selection: a button press must not collapse the
          // range before its onClick runs (SelectionFloatingToolbar idiom).
          onMouseDown={(event) => event.preventDefault()}
        >
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="source-editor-stylebar-btn"
              data-style-action={tool.id}
              title={tool.label}
              aria-label={tool.label}
              onClick={() => run(tool.action)}
            >
              {tool.icon}
            </button>
          ))}
          <span className="source-editor-stylebar-divider" aria-hidden="true" />
          {SWATCHES.map((swatch) => (
            <button
              key={swatch.id}
              type="button"
              className="source-editor-swatch"
              data-style-action={`color-${swatch.id}`}
              style={{ background: swatch.value }}
              title={swatch.label()}
              aria-label={swatch.label()}
              onClick={() => run({ kind: "color", value: swatch.value })}
            />
          ))}
          <button
            type="button"
            className="source-editor-swatch source-editor-swatch-default"
            data-style-action="color-default"
            title={t(m.styleColorDefault)}
            aria-label={t(m.styleColorDefault)}
            onClick={() => run({ kind: "color", value: null })}
          />
        </div>
      ) : null}
    </div>
  );
});
