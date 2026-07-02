# Review Loop — 最小复习环, built as the first AI-native upper-layer plugin

Closes the learning loop (读→锚→记→问→**复**→memory→AI 适配) AND answers "AI-native 怎么在上层做、
做成插件": the review loop is pure COMPOSITION of already-built core organs — zero new core
concepts. It is the exemplar for every future AI-native experience. Grounded 2026-07.

## 0. The design law it must pass (product-kernel rule)
> New capability = a content-type, a view over the 5 entities, or an AI operation. A 6th core
> concept is suspect.
The review loop decomposes exactly: **one view** (the Review surface) + **three AI operations**
(check / grade / explain) + **zero new entities** — mastery is NOT a new record: it is
`note.review` memory events (the verb already ships in MEM-1's closed enum) consolidated by
MEM-2 digests. The law holds.

## 1. The organ/experience split (the general AI-native-as-plugin answer)
**Core owns the ORGANS (all built or scheduled):**
| Organ | What | Status |
|---|---|---|
| provider registry (4 kinds) | the mouth — any model, one seam | ✅ A1–A3a |
| tools + agent loop | eyes/hands on the vault (search_notes/get_source) | ✅ A4a |
| learner memory + profile | long-term memory of THIS student | MEM-1 ✅ · MEM-2/3 scheduled |
| adaptive contract + preview loop | the safe output channel (nothing persists unconfirmed) | ✅ |
| operations-as-data | programmable AI behaviors (prompts as records) | ✅ |
| slash palette | universal typed input | SC-0 in flight |

**Plugins/kits compose organs into EXPERIENCES** — they may register: views · operations ·
content-types · taxonomies · slash entries. They may NEVER own: transports/models (§9.4),
capture, privacy policy, the memory store. AI-native features are therefore *upper-layer by
construction*: the review plugin is exemplar #1; a proactive "建议" surface (克制主动性 — reads
digests, suggests a review) is exemplar #2.

## 2. The loop, concretely
```
Review view opens (per-source or vault-wide)
  → QUEUE (V1 deterministic, explainable — NOT SRS):
      1. mistake notes (错题) never reviewed or failed last time
      2. quiz / flashcard / review-pack notes, least-recently-reviewed
         (recency = note.review memory events)
      3. [REV-2] weak-dimension items from MEM-2 digests (subject buckets with high fail ratio)
  → per item:
      • quiz/flashcard types: answer the note's own content (native interactive fulls = D7/N4,
        later; V1 renders question + reveal)
      • any other note: AI operation `review.generate-check` — declared-form quiz FROM the
        note's content (the existing generation path)
      → user answers → `review.grade-answer` (structured gen → {correct, explanation}, NOT
        persisted as a note) → explanation shown; "存为错题" offers the existing mistake type
      → emit memory event: note.review { noteId, subject, payload: { result: pass|fail|skip } }
  → MEM-2 digests consolidate pass/fail per dimension → profile facts ("浮力:薄弱")
  → [REV-2/MEM-3] the NEXT explain/generate call carries profileContext → AI adapts. LOOP CLOSED.
```
- **Scheduling stays a swappable policy function** (`queueFor(deps)`) — real SRS is a later
  policy upgrade, not a rewrite.
- **Everything reused**: mistake/quiz/flashcard/review-pack types exist; declared-form
  generation + preview exist; `note.review` verb exists; digests are MEM-2's already-specced
  deterministic aggregates; the view registry hosts the surface.

## 3. What is actually NEW (the honest bill)
1. The **Review view** (one registered view + queue policy fn) — new files.
2. **Three operations** (`review.generate-check`, `review.grade-answer`, `review.explain`) —
   operation/kit-prompt records + one grade schema.
3. A **review runner** state machine in the view (current item, answer, result) — component-local.
4. [REV-2] a digest→queue-weight reader + profileContext into `review.explain` (the first MEM-3
   consumer, scoped to one operation before generalizing).
That's all. No schema change, no core change, no new entity.

## 4. Phases
- **REV-1 — the loop, deterministic:** view + queue(1,2) + the three operations + note.review
  emission + "存为错题". Ships value before MEM-2 exists (events accumulate meanwhile).
  Parallel-safe: new files + one view registration (check the registration point is clean).
- **REV-2 — the adaptive half:** MEM-2 digests → queue weights + 弱项 header; profileContext
  into review.explain (MEM-3's first consumer). This is the moment the app becomes measurably
  AI-native: the same button explains differently for different students.
- **REV-3 — depth:** D7/N4 interactive fulls in-queue; SRS policy option; teacher visibility
  over shared review-packs (svpack already carries them).

## 5. Tests
Queue policy unit (ordering rules, empty states); operations through the mock provider
(declared-form check generation; grade schema roundtrip); note.review event emitted with the
right payload (capture test seam exists); e2e: seed mistake+quiz notes → open Review → answer →
result recorded → 错题 offer → queue advances. REV-2: digest fixture → queue reorders; explain
prompt contains profile facts (mock provider captures messages).
