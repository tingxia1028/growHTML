// Composer "detected · override" chip (decision #2). It LIVE-classifies the composer
// textarea (the same classifyContent seam) and shows a "detected: <form> · change"
// chip; the <select> is demoted to the OVERRIDE (still lists every non-hidden
// registered type, incl. kit-contributed). A HIGH-confidence detection AUTO-SELECTS
// the detected type; LOW stays markdown. The choice is always user-overridable:
// clicking "change" reveals the select, and once the user overrides we stop
// auto-applying (until they hit "auto" to return to the detected form).
//
// A small standalone host component (no heavy imports) so it is unit-testable without
// pulling the whole workspace tree.

import { useEffect, useState } from "react";
import { classifyContent } from "../../core/notes/classifyContent";

export function ComposerTypePicker({
  text,
  value,
  onChange,
  options
}: {
  text: string;
  value: string;
  onChange(next: string): void;
  options: { contentType: string; label: string }[];
}) {
  const [overriding, setOverriding] = useState(false);
  // Live detection on the current textarea text (high-confidence only auto-applies).
  const detected = classifyContent(text);
  const offered = new Set(options.map((o) => o.contentType));
  const detectedType =
    detected.confidence === "high" && offered.has(detected.contentType)
      ? detected.contentType
      : "markdown";

  // Auto-apply the detected type while the user hasn't taken manual control. Effect
  // (not render-time) so it doesn't fight a user override mid-render.
  useEffect(() => {
    if (!overriding && detectedType !== value) onChange(detectedType);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the detection only
  }, [detectedType, overriding]);

  const detectedLabel =
    options.find((o) => o.contentType.localeCompare(detectedType) === 0)?.label ?? detectedType;

  return (
    <div className="composer-type-picker">
      {overriding ? (
        <>
          <select
            className="note-type-select"
            aria-label="Override the note form"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.contentType} value={option.contentType}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="link-button composer-type-auto"
            title="Use the auto-detected form"
            onClick={() => {
              setOverriding(false);
              onChange(detectedType);
            }}
          >
            auto
          </button>
        </>
      ) : (
        <span className="composer-detected-chip">
          <span className="composer-detected-label">
            detected: <strong>{detectedLabel}</strong>
          </span>
          <button
            type="button"
            className="link-button composer-detected-change"
            title="Override the detected form"
            onClick={() => setOverriding(true)}
          >
            change
          </button>
        </span>
      )}
    </div>
  );
}
