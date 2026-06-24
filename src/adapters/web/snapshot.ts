import { parseHTML } from "linkedom";

// Tracking params stripped during URL normalization so the same page shared by
// different people resolves to one identity (basis for URL-keyed shared notes).
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^yclid$/i,
  /^msclkid$/i,
  /^spm$/i,
  /^ref(_src)?$/i,
  /^_hs(enc|mi)$/i
];

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      kept.append(key, value);
    }
  }
  const search = kept.toString();
  url.search = search ? `?${search}` : "";

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

const SAFE_URL_VALUE = /^(data:|blob:|mailto:|tel:|javascript:|#)/i;
const ABSOLUTIZE_ATTRS = new Set(["href", "src", "poster", "action"]);

export type WebpageSnapshot = {
  title: string;
  content: string;
};

// Server-side sanitized snapshot of fetched HTML: drop active content, neutralize
// inline handlers, and absolutize URLs so the local copy still resolves assets.
// Note: this captures the pre-JS server HTML; an Electron webview snapshot (later)
// will capture the rendered + authenticated DOM with higher fidelity.
export function snapshotWebpage(html: string, baseUrl: string): WebpageSnapshot {
  const { document } = parseHTML(html);

  for (const node of Array.from(document.querySelectorAll("script, iframe, noscript, object, embed"))) {
    node.remove();
  }

  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attr.name);
        continue;
      }
      if (ABSOLUTIZE_ATTRS.has(name) && attr.value && !SAFE_URL_VALUE.test(attr.value)) {
        try {
          element.setAttribute(attr.name, new URL(attr.value, baseUrl).toString());
        } catch {
          // Leave unparseable URLs untouched.
        }
      }
    }
  }

  const title = (document.querySelector("title")?.textContent ?? "").replace(/\s+/g, " ").trim();
  return { title, content: document.toString() };
}
