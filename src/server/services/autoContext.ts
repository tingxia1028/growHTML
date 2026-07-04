// composeAutoContext — the I/O half of ACTION-2a (action-v2-auto-context.md §1):
// assemble the standard context envelope every operation execution gets
// automatically, from what the system ALREADY knows. The pure string mechanics
// (formatting, cap, template namespace) live in src/ai/autoContext.ts; this
// module owns the composition reads:
//   selection — the generation request's existing anchor/selection inputs
//               (anchorText + the anchorId/sourceId locators when the command
//               happened to send them). No new client wiring required.
//   doc       — the source record named by input.sourceId (title · sourceType),
//               else the input.sourceTitle string; detected subject = the
//               detectSubject winner (M-A: the kit id IS the subject handle);
//               foreground kit = the SAME pin > detected > default resolver the
//               stage-axis seeding uses server-side (services/layers.ts).
//               Collection/folder is a named future seam — sources carry no
//               cheap folder handle today, so it is not composed.
//   learner   — the GENERALIZED profileContext (absorbs MEM-3's "profileContext
//               into all kit prompts"): the live memory profile distilled by the
//               same core builder REV-2's client uses. Guarantees preserved
//               EXACTLY: hidden facts are excluded inside buildProfileContext;
//               `kind:"managed"` providers get NO learner section (the REV-2
//               hard strip, applied at compose time — profile data never even
//               enters the envelope); and when the runtime input already carries
//               a profileContext (the REV-2 review path — the prompt weaves its
//               own 学生画像 section), the learner section is OMITTED so the
//               profile reaches the model exactly once.

import type { AutoContext } from "../../ai/autoContext";
import type { ModelProvider } from "../../ai/provider";
import type { ProfileFactView } from "../../core/memory/profile";
import { buildProfileContext } from "../../core/memory/profileContext";
import { detectKit } from "../../core/subject/detectSubject";
import type { StudyVault } from "../../core/vault";
import { foregroundForSource } from "../../kits/activation";
import { getMemoryProfile } from "../memory";

export type AutoContextDeps = {
  vault: StudyVault;
  provider: ModelProvider;
  /** Test seam: profile-fact loader (defaults to the live memory profile). */
  loadProfileFacts?: () => Promise<ProfileFactView[]>;
};

export type ComposeAutoContextRequest = {
  /** The runtime input AFTER the params merge + profileContext privacy gate. */
  input: Record<string, unknown>;
};

const trimmed = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
};

/** Compose the auto-context envelope for one generation request. Never throws —
    a failed read degrades to a smaller envelope, never a blocked generation. */
export async function composeAutoContext(
  deps: AutoContextDeps,
  request: ComposeAutoContextRequest
): Promise<AutoContext> {
  const { input } = request;
  const context: AutoContext = {};

  // — selection: the quote the run command gathered, plus cheap locator ids —
  const quote = trimmed(input.anchorText);
  const anchorId = trimmed(input.anchorId);
  const sourceId = trimmed(input.sourceId);
  if (quote) {
    context.selection = { quote, ...(anchorId ? { anchorId } : {}), ...(sourceId ? { sourceId } : {}) };
  }

  // — doc: the named source record when available, else the title string —
  try {
    const source = sourceId ? await deps.vault.stores.sources.get(sourceId) : null;
    const title = source?.title ?? trimmed(input.sourceTitle);
    if (source || title) {
      const detection = detectKit({ title, sourceType: source?.sourceType });
      const foreground = foregroundForSource(source ?? { title });
      const doc = {
        ...(title ? { title } : {}),
        ...(source?.sourceType ? { sourceType: source.sourceType } : {}),
        ...(detection.kitId ? { subject: detection.kitId } : {}),
        ...(foreground.kitIds[0] ? { kit: foreground.kitIds[0] } : {})
      };
      if (Object.keys(doc).length > 0) context.doc = doc;
    }
  } catch {
    // degrade: no doc section
  }

  // — learner: the generalized profileContext (REV-2 guarantees, see header) —
  if (deps.provider.capabilities.kind === "managed") return context;
  if (trimmed(input.profileContext)) return context;
  try {
    const facts = deps.loadProfileFacts
      ? await deps.loadProfileFacts()
      : (await getMemoryProfile({ vault: deps.vault })).facts;
    const learner = buildProfileContext(facts);
    if (learner) context.learner = learner;
  } catch {
    // degrade: no learner section — never block generation on a memory read
  }
  return context;
}
