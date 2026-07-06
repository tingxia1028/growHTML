// layerIo — the layer family's data seam (PLAT-LAYER §2.5 Rule C). The layer surfaces
// (the `layer.switcher` pane in layerViews and the Lens-embedded LayerLensManage twin)
// previously called `entityClient.*` inline; this thin facade relocates those IO edges
// out of the components so no component imports entityClient at runtime. It is a LEAF
// module: it imports ONLY entityClient (+ the record TYPES its callers re-export), never
// a view/workspace module, so it can never cycle with the workspace/ dir.
//
// Every method is a BYTE-EQUIVALENT pass-through (same args, same return type) that
// delegates at CALL TIME — `(...args) => entityClient.method(...args)` — NOT a captured
// binding. This matters for the tests: they mock the entityClient seam
// (`vi.mock("../data/entityClient", …)` / `vi.spyOn`), and a call-time lookup lets that
// mock/spy still intercept through this indirection.
//
// CONSERVATIVE READ DECISION (§2.5 slice 8b): `layers()` is routed through this facade as
// a plain pass-through, NOT swapped to `useWorkspace().sourceLayers`. The plan noted the
// switcher's own `entityClient.layers(activeSourceId)` read is redundant with ctx's
// sourceLayers, BUT swapping it carries a layersVersion/refresh-cadence timing risk (the
// switcher could go stale). This slice is behavior-preserving: the component KEEPS its
// exact current fetch behavior, just behind the facade. The ctx-swap redundancy-elimination
// is a separate optional optimization, explicitly OUT OF SCOPE here (mixing it into this
// mechanical relocation would risk a stale-switcher regression).

import { entityClient } from "../data/entityClient";

// Record types re-exported so the layer surfaces import their shapes from the same seam
// they now call (no direct entityClient TYPE edge needed either).
export type {
  ImportPreview,
  StudyLayerRecord,
  StudyPack
} from "../data/entityClient";

export const layerIo = {
  // —— Reads ——
  layers: (...args: Parameters<typeof entityClient.layers>) => entityClient.layers(...args),

  // —— Mutations ——
  createLayer: (...args: Parameters<typeof entityClient.createLayer>) => entityClient.createLayer(...args),
  patchLayer: (...args: Parameters<typeof entityClient.patchLayer>) => entityClient.patchLayer(...args),
  deleteLayer: (...args: Parameters<typeof entityClient.deleteLayer>) => entityClient.deleteLayer(...args),

  // —— Export / import (.studypack) ——
  exportLayer: (...args: Parameters<typeof entityClient.exportLayer>) => entityClient.exportLayer(...args),
  importPreview: (...args: Parameters<typeof entityClient.importPreview>) => entityClient.importPreview(...args),
  importCommit: (...args: Parameters<typeof entityClient.importCommit>) => entityClient.importCommit(...args)
};
