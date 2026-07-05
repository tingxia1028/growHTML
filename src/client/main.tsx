import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// R1.5 typography: bundle the webfonts locally (woff2) so the app genuinely renders Inter
// (UI) + Source Serif 4 (reader prose) offline — Electron desktop + mobile WebView, NO
// runtime CDN. These @fontsource imports emit @font-face rules + bundled woff2 via Vite;
// the --sv-font-sans / --sv-font-serif tokens (styles.css :root) then resolve to them.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "./styles.css";
// Theme V1: register the built-in themes (side effect, like kits/clientKits), build the
// managed <style data-sv-themes> from the registry, then apply the persisted theme id
// BEFORE React mounts. Because styles.css holds the default tokens at :root, any flash is
// bounded to default->chosen, never unstyled->styled. See docs/design/theme-plugin.md §5.
import "./theme/builtins";
// PRO-1 proactive learning: register the CODE-registered built-in triggers (the review-push
// exemplar) once at startup — the proactive tick (started in WorkspaceShell) evaluates them.
import "./triggers/builtins";
import { injectThemeStyles, setActiveTheme, readPersistedThemeId } from "./theme/applyTheme";
// Platform seam: detect the host (Electron desktop vs plain browser) and publish it
// to the module-scope singleton BEFORE the first render, so the pref helpers that run
// during render already have a platform. See docs/implementation/platform-layering-build-spec.md §1.6.
import { detectPlatform, setPlatform } from "./platform";

injectThemeStyles();
setActiveTheme(readPersistedThemeId());
setPlatform(detectPlatform());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
