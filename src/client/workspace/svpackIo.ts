// svpackIo — the protected-sharing (.svpack) data seam (PLAT-LAYER §2.5 Rule C). The two
// svpack dialogs (SvpackExportDialog / SvpackImportDialog in svpackViews) previously called
// `entityClient.*` inline for the export + the whole import flow (inspect → open → commit)
// + the sealed-imports list/delete; this thin facade relocates those IO edges out of the
// components so no component imports entityClient at runtime. It is a LEAF module: it
// imports ONLY entityClient (+ the record TYPES its caller re-exports), never a
// view/workspace module, so it can never cycle with the workspace/ dir.
//
// Every method is a BYTE-EQUIVALENT pass-through (same args, same return type) that
// delegates at CALL TIME — `(...args) => entityClient.method(...args)` — NOT a captured
// binding. This matters for the tests: they `vi.mock("../data/entityClient", …)` (spread
// actual + override these six fns), and a call-time lookup lets that mock still intercept
// through this indirection.

import { entityClient } from "../data/entityClient";

// ApiError is re-exported as a VALUE (not type-only): svpackViews does `error instanceof
// ApiError` in mapSvpackError, a RUNTIME edge — routing it through this seam keeps the
// component's only entityClient-module import out of it entirely (Rule C direct-import).
export { ApiError } from "../data/entityClient";

// Record types re-exported so the svpack surfaces import their shapes from the same seam
// they now call (no direct entityClient TYPE edge needed either).
export type {
  SealedPackRow,
  SealedPackStatus,
  StudyLayerRecord,
  SvpackCommitResult,
  SvpackExportResult,
  SvpackInspectResult,
  SvpackOpenResult,
  SvpackPinStatus,
  SvpackValidity
} from "../data/entityClient";

export const svpackIo = {
  exportSvpack: (...args: Parameters<typeof entityClient.exportSvpack>) => entityClient.exportSvpack(...args),
  sealedImports: (...args: Parameters<typeof entityClient.sealedImports>) => entityClient.sealedImports(...args),
  inspectSvpack: (...args: Parameters<typeof entityClient.inspectSvpack>) => entityClient.inspectSvpack(...args),
  openSvpack: (...args: Parameters<typeof entityClient.openSvpack>) => entityClient.openSvpack(...args),
  commitSvpack: (...args: Parameters<typeof entityClient.commitSvpack>) => entityClient.commitSvpack(...args),
  deleteSealedImport: (...args: Parameters<typeof entityClient.deleteSealedImport>) =>
    entityClient.deleteSealedImport(...args)
};
