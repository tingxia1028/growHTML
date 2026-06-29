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
import { injectThemeStyles, setActiveTheme, readPersistedThemeId } from "./theme/applyTheme";

injectThemeStyles();
setActiveTheme(readPersistedThemeId());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
