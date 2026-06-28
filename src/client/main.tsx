import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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
