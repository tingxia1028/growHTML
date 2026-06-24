// App is now just the composition root: FocusProvider (the selection/anchor kernel)
// wraps WorkspaceProvider (the shared workspace state + actions), and WorkspaceShell
// renders a layout's nodes through the ViewRegistry. There is NO panel JSX and NO
// per-surface reader branching here anymore — the three panels are registered views
// (src/client/workspace/views.tsx) and the source reader's surface switch lives in
// readerForSource. Adding a new view = register a plugin + add its node to a preset;
// zero edits to this file. See docs/design/workspace-runtime.md.

import { FocusProvider } from "./focus/FocusContext";
import { WorkspaceProvider } from "./workspace/WorkspaceContext";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import { threePane } from "./workspace/presets";

export default function App() {
  return (
    <FocusProvider>
      <WorkspaceProvider>
        <WorkspaceShell layout={threePane} />
      </WorkspaceProvider>
    </FocusProvider>
  );
}
