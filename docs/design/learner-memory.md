# Learner Memory — 分级记忆 + 用户画像 (local-first)

A local memory system that records the user's operations and learning behavior, consolidates
them through tiers (短期 → 中长期 → 长期), and maintains an overall 画像 (learner profile) —
feeding AI personalization, the subject auto-switch, and (later) spaced review. Grounded in the
tree 2026-07; companion to `architecture-review.md` (the F7 lesson applied in reverse) and
`roadmap.md` (MEM track).

## 0. The ownership verdict (the user's question: plugin or core?)
**Mechanism = core. Taxonomies + consumers = plugin-registered.** Same split as the AI provider
ownership call and the exact F7 lesson applied forward:
- **Core must own capture/storage/tiering/query/privacy** because (a) capture needs the choke
  points (only core sits on all of them), (b) this is the most sensitive data in the vault —
  its privacy policy can't be third-party code, (c) it has MANY consumers (AI, auto-switch,
  review, boards) — a shared substrate behind one contract is the repo's own
  abstract-recurring-capabilities principle.
- **Core must NOT own the behavior taxonomy.** "什么行为算什么" is a kit worldview (textbook kit
  cares about 错题/复习; 英语Kit about 生词复看) — hardcoding it in core would repeat the F7
  mistake. Kits register dimensions/classifiers; core stores verbs and runs the engine.

## 1. Shipped substrate (grounded)
- **Zero existing telemetry** — grep confirms no analytics/event-log anywhere in src/. Net-new.
- **Client choke point exists:** every command flows through `runCommand(id, ctx)`
  (`src/client/commands/registry.ts:626`) — one capture hook covers all command-driven behavior.
  Non-command behaviors (open source, focus anchor, reader dwell) hook the few WorkspaceContext
  transitions that set them.
- **Server choke point:** entity mutations + AI calls (`/api/chat[/stream]`, `/api/kits/generate`)
  — post-X0 these run through the extracted service layer; until then, route-level emit on the
  handful of mutating routes that matter.
- **Storage is one line + a schema:** the uniform entity store (`createEntityStores`) carries 9
  entities today; memory adds its own records the same way.
- **Export safety is structural:** `buildStudyPack` (`studyLayer.ts:98-153`) ships ONLY a layer's
  anchors+notes — memory entities can never ride an `.svpack` by construction. MEM-1 adds a guard
  test pinning that invariant.

## 2. Data model (core)
```ts
// 短期 tier — the raw stream (append-only, high volume, prunable)
memoryEvent = { id, ts, verb,                 // verb = core envelope, see §3
  subject: { sourceId?, anchorId?, noteId?, conceptId?, layerId?, kitId?, contentType? },
  payload?: Record<string, unknown>,          // small, verb-specific (e.g. durationMs, mode)
  sessionId? }
// 中长期 tier — deterministic aggregates
memoryDigest  = { id, period: "day"|"week", key: { period, dimension, bucket },  // e.g. day×subject×"物理"
                  counts: Record<verb, number>, stats: { activeMs?, notesCreated?, mistakes? } }
// 长期 + 整体画像 — one living document (versioned, USER-EDITABLE)
learnerProfile = { id: "profile", version, updatedAt,
  facts: ProfileFact[],       // { key, value, confidence, evidence: digestRefs[], pinned? }
  preferences: {...},         // note types used, kits, reading rhythms
  narrative?: string }        // optional LLM-written summary — always inspectable/editable
```
- Events live in their own `memory-events.jsonl` with **compaction**: once consolidated into
  digests, events older than the short-term window (default 14d) are pruned — the jsonl never
  grows unbounded. Digests/profile are ordinary entity records.
- **Tier semantics:** 短期 = the event stream (verbatim, recent); 中长期 = digests (per
  day/week × dimension); 长期 = profile facts distilled from stable digest patterns; 整体画像 =
  the profile document as a whole.

## 3. Verbs (core) vs dimensions (kit-registered)
- **Core verb envelope** (closed, small): `open · read(dwell) · anchor.create · note.create ·
  note.edit · note.review · ai.ask · ai.generate · import · export · search · navigate`.
- **Kits register taxonomy** via a contribution (the F7/`stagePreset` pattern):
  `registerBehaviorTaxonomy({ kitId, dimensions: [{key, title}], classify(event) => tags[] })` —
  e.g. textbook kit tags `note.create(contentType: textbook.mistake)` as 错题行为; a subject kit
  maps sources to 学科 buckets (feeding the digest `dimension×bucket` keys). No kit → events
  still recorded with core verbs; taxonomy enriches, never gates.

## 4. Engine (core)
- **Capture:** client hook in `runCommand` + the few context transitions; batched fire-and-forget
  `POST /api/memory/events` (never blocks UX; drops are acceptable — this is telemetry, not
  ledger). Server-side emits for server-originated mutations.
- **Consolidation:** deterministic passes on app start + idle (no cron in a local app):
  events→digests (counting/stats only), digests→profile-fact candidates (rule-based: streaks,
  dominant subjects, mistake clusters, review gaps). **V1 is fully deterministic** — the optional
  LLM-written `narrative` (via the existing `generateStructured`) is a later, clearly-labeled
  add-on the user can regenerate/edit/delete.
- **Query API:** `GET /api/memory/profile`, `GET /api/memory/digests?period&dimension`,
  `GET /api/memory/events?since` (debug/manager), `DELETE /api/memory/...` (see §6).

## 5. Consumers (plugin-side or feature-side)
- **画像页** — a registered view (peer of the plugin-manager panel): profile facts (editable,
  pinnable), activity rhythm, per-subject breakdown; a "记忆管理" section (view/clear tiers).
- **AI personalization** — a compact `profileContext` (few hundred tokens, distilled facts)
  optionally woven into `ChatContext`/operation variables. **Policy: on by default for local
  providers (mock/cli-agent/BYOK-http), OFF for `kind:"managed"` until explicit consent** — the
  profile never leaves the machine silently.
- **Subject auto-switch (M-A)** — recent-subject digests as a prior for document-type detection.
- **Review/SRS (later)** — the substrate makes spaced review buildable without committing to it
  now (`note.review` events + mistake clusters are exactly its inputs).
- **Anchor Focus board (N6)** — per-stage activity counts enrich the board header.

## 6. Privacy invariants (non-negotiable, tested)
1. **Local-only by default.** Memory entities live in the vault; nothing syncs/uploads.
2. **Never exported:** structurally outside `buildStudyPack`; guard test pins it (MEM-1).
3. **AI use is policy-gated** per provider kind (§5) — managed requires explicit opt-in.
4. **User owns it:** view everything, edit/pin/delete profile facts, clear any tier or time
   range, or disable capture entirely (a vault-level switch; capture hooks no-op when off).

## 7. Phasing
- **MEM-1 — capture + store + guard:** `memoryEvent` entity + jsonl store with compaction; the
  `runCommand` hook + server emits; `POST/GET /api/memory/events`; the export guard test; the
  capture on/off switch. (Server/core + one client hook — parallel-safe now.)
- **MEM-2 — tiers + 画像页:** digest consolidation (start/idle), profile facts (deterministic),
  the profile/manager view, retention defaults (events 14d post-consolidation, digests 12mo,
  profile forever-until-edited).
- **MEM-3 — taxonomy + AI hookup:** `registerBehaviorTaxonomy` (textbook first), profileContext
  → ChatContext/operations with the per-kind policy + consent UI; M-A prior.
- **Later:** LLM narrative profile; SRS consumer; profile in account sync (G-track follow-on).

## 8. Open items
- Dwell-time capture fidelity (visibility-based timer vs scroll heuristics) — decide in MEM-1.
- Digest dimension keys beyond subject (time-of-day, source-type) — start with subject + verb.
