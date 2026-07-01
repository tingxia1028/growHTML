# Protected Layer Sharing — `.svpack` v2, fully offline

Status: design (v2, supersedes the v1 draft in git history). Build scope: **offline only — no server, no accounts.** Server-backed tiers are a short "future" note (§10); everything else in this doc is buildable now.

Author-facing name: **Study Vault Pack** (`.svpack`). Legacy plaintext export stays `.studypack`.

> **Why a v2:** the v1 draft had two real holes (the per-recipient key-wrap list sat outside the signature → a legitimate recipient could graft extra codes onto a pack; code entropy was unspecified → offline brute-force), plus several offline claims that were quietly server-tier claims (anti-spoofing, attribution, "time-boxed"). v2 fixes the holes, makes every offline claim honest, and simplifies the crypto to node:crypto built-ins only.

---

## 1. What "privacy" means offline — the honest guarantee table

Offline privacy splits into two very different halves:

**Against OUTSIDERS (no code): cryptographically HARD.** These hold at full strength with no server:

| Guarantee | Mechanism |
|---|---|
| A non-recipient cannot read a pack | AES-256-GCM payload; per-recipient 200-bit codes (§4) — offline brute-force is mathematically infeasible |
| Nobody can tamper with / graft recipients onto a pack | Ed25519 signature **and** GCM AAD both cover the exact header bytes, which contain the wrap list (§3) |
| "The same publisher as last time" is verifiable | Self-certifying publisher id = fingerprint(pubkey), pinned on first import (TOFU, §5.1) |
| Copying the recipient's vault directory reveals no imported plaintext | Sealed import store (§7); device key lives OUTSIDE the vault in the OS keychain |

**Against the AUTHORIZED RECIPIENT misusing content: SOFT (structure + deterrence).** A patched client, a debugger, or a screenshot can always extract what a client can render (the Kindle/Netflix ceiling):

| Goal | What we do | Honest strength |
|---|---|---|
| Expiry ("time-boxed") | `validity` in the signed header, checked at **every unseal**, + an encrypted clock high-water-mark against rollback | stops normal users; not a patched client |
| No re-export | sealed content never enters the exportable stores (**structural**), + `origin.exportable:false` refusal at the one export choke point, + sealed notes excluded from AI context and card-copy by default | stops in-app flows; retyping/screenshots can't be stopped |
| Leak attribution | zero-width watermark carrying the recipient's `codeId`, woven in at render (§9) | probabilistic; strippable by a determined leaker |

**Impossible offline, stated plainly:** revoking a specific recipient *before* their pack expires; binding to a *person* rather than a *code* (a code is a bearer capability — whoever holds it can open the pack on any device). Both need a server (future Tier B, §10). The offline substitute for revocation is **short validity + renewal packs** (§8.2).

### Non-goals
- No source-document distribution (§2 decision 2 — layer-only, always).
- No accounts, no sync, no realtime collaboration in this doc.
- No pretense of DRM-grade protection; publishers are told the soft limits in the export UI.

---

## 2. Locked decisions

| # | Decision |
|---|----------|
| 1 | **Shared unit = a Layer** (notes + anchors + hierarchy) packaged as an encrypted+signed `.svpack`; the inner payload is today's `studyPackSchema` JSON. |
| 2 | **Layer-only, never ship the source.** Binds via the existing content-hash fingerprint; anchors re-match on the recipient's own copy (existing `matchSourceByFingerprint` → `rematchAnchor`/`rematchRegion` pipeline). Missing source ⇒ explicit "you need source X" + later Re-anchor. |
| 3 | **No accounts.** Publisher identity = a local Ed25519 keypair, id self-certified as the key's fingerprint, trusted via TOFU pinning. Recipient identity = a local device key for at-rest sealing. Zero registration. |
| 4 | **Per-recipient unique codes** = 200-bit random strings; the code's public 8-char prefix is its `codeId` (the wrap-list index and the watermark payload). The wrap key is derived by HKDF — high entropy replaces slow KDFs. |
| 5 | **The wrap list is inside the signed bytes.** Adding/removing a recipient after signing is cryptographically impossible. |
| 6 | **Imported content lives in a sealed per-pack store**, encrypted to the device key, merged into the read model in memory when unlocked; it never enters the plaintext `.jsonl` stores. V1 imported notes are **read-only** (annotate on top with your own notes, which stay yours and exportable). |
| 7 | **Expiry is render-gated** (checked at every unseal), and **renewal packs** (same `packId`, higher `revision`, rotated CEK, pruned wrap list) are the offline revocation lever. |

---

## 3. Container format

### 3.1 Sign the bytes, don't canonicalize
v1 proposed CBOR + canonical-form signing. v2 drops that: the container is a **length-prefixed binary frame whose header bytes are stored verbatim**, and the signature covers those exact bytes. No canonicalization step means no canonicalization bugs and zero new dependencies (the JWS trick).

```
.svpack :=
  magic    "SVPK2\n"                      (6 bytes)
  u32-le   headerLen   | headerBytes      (UTF-8 JSON, kept verbatim)
  u32-le   payloadLen  | payload          (AES-256-GCM ciphertext)
  u32-le   sigLen      | signature        (Ed25519, 64 bytes)

signature = Ed25519_sign(publisherPriv, headerBytes ‖ payload)
payload   = AES-256-GCM(CEK, nonce, plaintextJson, aad = headerBytes)
```

Signature **and** AAD both bind the header — a pack with a modified header fails twice. Verify order on open: parse frame → check magic/lengths → verify signature (against the pinned or embedded publisher key, §5.1) → check `validity` (§8) → locate the caller's wrap by `codeId` → HKDF + unwrap → GCM-decrypt.

### 3.2 Header (JSON, cleartext, signed)
```jsonc
{
  "v": 2,
  "packId": "pack_01K…",            // new id kind (src/core/ids.ts)
  "revision": 1,                    // bumped by renewal packs (§8.2)
  "publisher": {
    "id": "pubf_a7k2…",             // = base32(sha256(signingPubKey))[0..15] — SELF-CERTIFYING (§5.1)
    "signingPubKey": "<base64url Ed25519 pub>",
    "displayName": "王老师 · 高一物理"
  },
  "createdAt": "2026-07-01T12:00:00Z",
  "title": "力学错题层",              // import-UI convenience
  "sourceHash": "sha256:553f7afe…", // == sourceFingerprint.contentHash (§6.3)
  "sourceType": "html",
  "validity": { "notBefore": null, "validUntil": "2026-09-01T00:00:00Z" },   // §8
  "aead":    { "alg": "A256GCM", "nonce": "<b64url 12B>" },
  "keywrap": { "alg": "HKDF-SHA256+A256GCM", "info": "svpack/v2/cek-wrap" },
  "wraps": [                        // INSIDE the signed bytes — decision 5
    { "codeId": "A7K2QF3Z", "nonce": "<b64url 12B>", "wrappedCek": "<b64url 32+16B>" }
  ],
  "watermark": { "scheme": "svwm/1", "payload": "codeId" }
}
```
The CEK appears nowhere in cleartext. `wraps` is bounded by the class size (a few hundred entries ≈ a few tens of KB — fine). The header intentionally leaks only routing metadata (title, publisher, source hash); publishers who consider the *title* sensitive can blank it.

### 3.3 Payload (plaintext before encryption)
Exactly today's `studyPackSchema` JSON (`src/core/study-layer/pack.ts`) **plus an explicit optional `provenance` field**:
```jsonc
{
  …studyPackSchema fields (packId, sourceFingerprint, layer, anchors[], notes[])…,
  "provenance": { "publisherId": "pubf_…", "packId": "pack_…", "exportable": false }
}
```
zod note (v1-draft bug): `studyPackSchema` is a plain `z.object`, which **strips** unknown keys — `provenance` must be added to the schema as `.optional()`, or it silently disappears on parse.

### 3.4 Versioning / coexistence
- Raw JSON without the `SVPK2` magic ⇒ legacy plaintext `.studypack` (v1): still importable, treated as user-authored (`exportable` defaults true), zero protection — by definition.
- `SVPK2` frame ⇒ this format. Future header fields are additive; `v` bumps only on breaking layout changes.

---

## 4. Codes — high entropy instead of a KDF arms race

```
code       := 40 chars of Crockford base32, grouped for humans:
              A7K2Q-F3ZTV-9XJ4M-PB6WD-QH2RS-K8YTN-3EFGA-5CVUX   (≈200 bits)
codeId     := the FIRST 8 chars ("A7K2QF3Z") — public index, printed in the ledger,
              embedded in the watermark, safe to show in UI
secretPart := the remaining 32 chars (=160 bits of entropy)
wrapKey    := HKDF-SHA256(ikm = full code string, salt = packId ‖ codeId,
                          info = "svpack/v2/cek-wrap", len = 32)
wrappedCek := AES-256-GCM(wrapKey, nonce, CEK, aad = packId ‖ codeId)
```

Why this shape:
- **The pack itself is a code-checking oracle** (a wrong code fails the wrap's GCM tag), and offline there is no rate limiter. Security therefore MUST come from entropy, not from KDF slowness. 160+ bits of secret ⇒ brute force is infeasible regardless of how fast the KDF is.
- So the KDF can be **HKDF-SHA256 — a node:crypto built-in, microseconds** — which also kills the v1-draft perf problem (100 recipients × ~1 s Argon2id at export). No Argon2id, no scrypt, no new dependency. (If human-*chosen* passphrases are ever allowed, that path must switch to Argon2id — codes are always machine-generated, so V1 never needs it.)
- The recipient's client finds its wrap entry directly by the code's first 8 chars — no trial-decryption loop.
- A code is a **bearer capability**: it opens the pack on any device it's typed into (offline can't bind to a person). Stated in the export UI; the ledger + watermark make a *shared* code attributable to its owner.

---

## 5. Publisher side

### 5.1 Identity: self-certifying id + TOFU
- First publish generates an **Ed25519 signing keypair**, stored outside the vault via OS-keychain (`safeStorage` under Electron; dev-browser fallback: a key file in the user profile — flagged as weaker in the UI).
- `publisher.id = "pubf_" + base32(sha256(signingPubKey))[0..15]`. Because the id is *derived from the key*, nobody can claim an existing publisher's id without the private key — **anti-spoofing that actually holds offline**.
- Recipients **pin** `(publisherId, signingPubKey, displayName)` on first import (`<userProfile>/identity/pinned-publishers.json`). Later packs with the same id must verify against the pinned key; mismatch ⇒ hard-fail warning ("this is NOT the same 王老师 you imported from before").
- What TOFU cannot stop, said plainly: a *fresh* keypair with a look-alike `displayName`. The import UI always shows the id fingerprint + "first time seeing this publisher" so a teacher can read their fingerprint aloud in class.
- Key loss ⇒ the publisher identity is unrecoverable (new key = new id = re-pin). V1 offers an **encrypted key-backup export** (passphrase-protected file) at first publish.

### 5.2 Export flow + the code ledger
1. Layer Lens → "Share as protected pack": pick layer, recipient labels (paste a name list), `validUntil`.
2. Client builds the payload via the existing `buildStudyPack` (the `isPrivateByDefault` drop still runs first), stamps `provenance`, generates CEK, mints one code per recipient, assembles header (wraps included), encrypts, signs, writes `<layer>.svpack`.
3. Shows the codes **once** in a copyable roster ("张三 → A7K2Q-…"), and writes the **ledger**: `vault/publishes/<packId>.json` = `{ packId, layerId, title, revision, validity, recipients: [{ codeId, label, issuedAt }], codeSecrets: <encrypted to publisher device key> }`.
   - Storing the (encrypted) code secrets is **required, not a nicety**: renewal packs (§8.2) must re-wrap the new CEK to the *same* codes, and teachers must be able to re-show a lost code.
4. Distribute: same `.svpack` file to everyone (LMS/群文件), each student privately gets their own code.

Export UI copy states the soft limits (§1) so publishers have correct expectations.

---

## 6. Recipient side

### 6.1 Import flow
1. **Inspect (no code needed):** open the `.svpack` → `POST /api/svpack/inspect` parses the header only → UI shows title, publisher (+ pin status: `pinned ✓` / `first time — fingerprint pubf_a7k2…` / `⚠ KEY MISMATCH`), validity, and whether a local source matches `sourceHash`.
2. **Open:** user enters their code → verify signature → check validity (§8) → locate wrap by codeId → unwrap CEK → decrypt → run the existing `previewImport` on the plaintext (matched / fuzzy / unmatched counts).
3. **Commit:** the decrypted layer+anchors+notes go into the **sealed store** (§7) — NOT the plaintext stores. Anchors are realized through the existing `commitImport` re-anchor pipeline (`matchSourceByFingerprint` → `rematchAnchor`/`rematchRegion` → `matchStatus`), with results written into the sealed blob. The imported layer nests under the per-source "导入图层" parent (`ensureImportedParent`) so the Layer Lens shows it normally.
4. Optional "remember my code on this device" (encrypted under the device key) so renewal packs (§8.2) import without re-typing.

### 6.2 Missing source
`matchSourceByFingerprint` returns null ⇒ commit the layer **unbound** (all anchors unmatched, nothing dropped) and show: *"This pack annotates «…» (sha256:553f…). Open or import that source, then hit Re-anchor."* Re-anchor re-runs the rematch against the new source and rewrites the sealed blob. **No source bytes are ever requested or shipped.**

### 6.3 Source identity
Unchanged from v1 draft — the repo already has everything: `computeContentHash`/`computeBufferHash` stamp `SourceRecord.contentHash` at ingest (`src/core/store/sources.ts`), `sourceFingerprintSchema` carries it, `matchSourceByFingerprint` prefers it. `header.sourceHash` is that value. Byte-exact hashing is brittle across PDF re-saves (§11 risk); fingerprint fallback (url/title) + whitespace-tolerant `rematchText` absorb most of it.

---

## 7. Sealed import store — structural no-re-export + at-rest privacy

### 7.1 Design
Imported (protected) content **never enters `notes.jsonl` / `anchors.jsonl` / `layers.jsonl`.** Each pack seals into one file:

```
vault/imports/<packId>.svsealed
  = "SVSL1\n" frame, AES-256-GCM under a per-pack storage key,
    storage key wrapped by the DEVICE KEY
  contents: { header-echo (publisher, validity, revision, codeId),
              layer, anchors[] (realized, matchStatus), notes[],
              importedAt, rememberedCode? }
```

- **Device key**: AES-256, generated on first run, held in the OS keychain via Electron `safeStorage` (dev-browser fallback: `<userProfile>/growte/device.key` — outside the vault, weaker, labeled). The clock high-water-mark (§8.1) lives beside it. **The vault directory alone is useless ciphertext.**
- **Unlock**: at app start (or on demand) the server verifies validity (§8), unwraps, and merges sealed records into the API read model (`/api/notes`, `/api/anchors`, `/api/layers` responses) flagged `sealed: true`. Reader paints anchors, Notes tab lists cards, exactly as today — decrypted content exists in memory only.
- **Read-only in V1**: sealed notes have no edit affordance. Annotating on top = creating your OWN note on the same anchor — that note is yours, plaintext, exportable.
- Deleting the imported layer = deleting the blob.

### 7.2 Why this beats envelope-encrypting the jsonl stores (v1 draft)
- `buildStudyPack` reads the plaintext stores ⇒ sealed content is **structurally absent from every export path**. The `origin.exportable === false` refusal added to `buildStudyPack` (the single choke point, `src/server/studyLayer.ts`, surfaced by `POST /api/layers/:layerId/export`) becomes a second belt, not the only wall.
- No schema/read-path churn for the user's own notes; the store layer stays plaintext-simple.
- Per-pack blobs give clean expiry/renewal/delete semantics (§8).

### 7.3 Laundering policy (decided, honest)
The remaining in-app leak is *transformation*: copy the text out, or ask the AI to "summarize the imported notes into a new note" (the new note is locally-authored ⇒ exportable). V1 policy:
- sealed notes are **excluded from AI chat context** by default (per-vault policy flag),
- card-level copy affordances are disabled on sealed content,
- documented plainly as **friction, not a wall** — retyping and screenshots remain possible (§1).

---

## 8. Validity, rollback, renewal (the offline revocation substitute)

### 8.1 Render-gated expiry
`validity` sits in the signed header AND is echoed into the sealed blob. It is enforced:
- at import (§6.1 step 2), and
- at **every unseal** (each app session / unlock) — so content genuinely stops rendering after `validUntil`, not just new imports. ("Time-boxed" is now true.)

Clock defense: the app persists an encrypted **high-water-mark = max(wall clock ever observed)** beside the device key; if `now < highWater − slack` ⇒ rollback detected ⇒ time-boxed packs refuse to unseal. Stops casual clock rollback; a patched client is out of scope (§1).

### 8.2 Renewal packs = coarse-grained revocation
A publisher re-issues from the ledger: same `packId`, `revision + 1`, **rotated CEK** (payload re-encrypted), extended `validity`, and a wrap list containing **only the still-entitled codes** (same code strings — students don't get new codes).
- Recipients import the renewal (auto-openable via the remembered code); the client replaces the sealed blob iff `revision` is higher AND the signature matches the **pinned** publisher key.
- An excluded (revoked) recipient cannot open the renewal — their code has no wrap entry — and their old revision dies at its `validUntil`.
- Net effect: **revocation with latency = the validity window.** A teacher who wants a tight leash sets `validUntil` to end-of-month and renews monthly. CEK rotation is what makes exclusion real (an old cached CEK is useless against the re-encrypted renewal payload).

---

## 9. Watermark (in V1, not deferred)
Every render of sealed note content passes through one function that weaves a **zero-width watermark encoding the 40-bit `codeId`** (U+200B/U+200C sequences at deterministic token boundaries; repeated across the note so partial copies still carry it). The ledger maps codeId → recipient label ⇒ a pasted-text leak is attributable.
Honest limits (unchanged): zero-width chars are stripped by aggressive normalizers and never survive OCR/screenshots — this is deterrence + best-effort attribution, not proof. Hardened carriers (synonym/order channels) stay future work.
(Why V1 ships it: without *any* watermark, "leak attribution" would be pure fiction — the v1 draft claimed it while deferring the mechanism.)

---

## 10. Future (deferred, kept for format compatibility)
**Tier B (server + accounts)** adds: binding codes to *persons* (cross-device), pre-expiry per-code revocation + short leases, and the account that later powers multi-device sync. **Tier C (server-side decrypt/stream)** adds view-time control for ultra-sensitive content. The v2 container is forward-compatible: Tier B replaces "wraps in header" with server-held wraps and keeps everything else. Full sketches live in this file's git history (v1 draft, commit `2ac55bb`…`4a93990`); do not build now.

---

## 11. Risks / open questions
- **TOFU display-name spoofing** — a fresh key with a look-alike name. Mitigation: fingerprint surfacing + "first time" badge; classroom out-of-band verification. Accepted for V1.
- **Publisher key loss** — new identity, re-pin for all recipients. Mitigated by the encrypted key backup (§5.1). Accepted.
- **Code sharing** — a code is a bearer capability; sharing it shares access. Watermark + ledger make it attributable, renewal packs make it recoverable. Accepted (offline ceiling).
- **Source-hash brittleness** — byte-exact `contentHash` misses re-saved/re-encoded copies; fallback fingerprint + tolerant rematch absorb most; a normalized-text second-tier hash remains a candidate improvement.
- **Dev-browser key storage** — without Electron `safeStorage`, the device key sits in a profile file (still outside the vault). Weaker; labeled in UI. Electron is the primary target.
- **Sealed-store memory footprint** — a whole class-pack decrypted in memory; packs are note-sized (KBs–MBs), fine. Revisit if packs ever carry media.

---

## 12. Reuse map (verified against the repo)
| Design part | Existing code |
|---|---|
| Pack payload schema | `src/core/study-layer/pack.ts` — `studyPackSchema` (+ add optional `provenance`), `portableAnchorSchema`, `portableNoteSchema` |
| Export choke point | `src/server/studyLayer.ts` — `buildStudyPack` (+ `exportable` refusal); `POST /api/layers/:layerId/export` in `src/server/app.ts` |
| Import + re-anchor | `src/server/studyLayer.ts` — `previewImport`, `commitImport`, `realizeAnchor` (write target becomes the sealed store) |
| Source identity | `src/core/store/sources.ts` — `computeContentHash`/`computeBufferHash`; `src/core/study-layer/fingerprint.ts` — `matchSourceByFingerprint` |
| Anchor/region re-match | `src/core/study-layer/rematch.ts`; `src/core/region/region.ts` |
| Layer hierarchy | `src/core/study-layer/layers.ts` — `ensureImportedParent`, `ensureOwnedLayer`; `parentId` in `src/core/schema/study-layer.ts` |
| Note provenance | `src/core/schema/note.ts` — `origin` (extend with `publisherId`, `exportable`) |
| Pre-export policy hook | `src/kits/policy.ts` — `isPrivateByDefault` |
| Ids | `src/core/ids.ts` — add kinds: `pack`, `devicekey` (prefixes `pack_`, `dev_`); codeId is NOT an entity id (it's the code prefix) |
| Hash | `src/core/storage/sha256.ts` — `sha256Hex` (publisher-id fingerprint) |
| **New: crypto leaf** | `src/core/crypto/` — thin pure wrappers over **node:crypto only**: AES-256-GCM, Ed25519, HKDF-SHA256, randomBytes; `codes.ts` (mint/parse/derive); `svpackFrame.ts` (frame read/write/sign/verify). Zero new dependencies. |
| **New: identity leaf** | `src/core/identity/` — device key (safeStorage/profile-file), publisher keypair + backup, pinned-publishers store, clock high-water-mark |
| **New: sealed store** | `src/server/sealedImports.ts` — `vault/imports/*.svsealed` read/write/unlock/merge; server endpoints `POST /api/svpack/inspect|open|commit`, `POST /api/layers/:layerId/export-svpack` |

---

## 13. Build order (P1, single deliverable, test-first at each step)
1. `src/core/crypto/` + `codes.ts` + `svpackFrame.ts` — unit-tested roundtrips; tamper tests (flip a byte in header / payload / a wrap ⇒ fail), wrong-code ⇒ clean "wrong code" error, expiry gate incl. rollback high-water.
2. `src/core/identity/` — device key, publisher key + fingerprint id, pin store.
3. Export path: `buildStudyPack` refusal + `export-svpack` endpoint + ledger; provenance field in schema.
4. Sealed store + import endpoints (inspect/open/commit) reusing preview/commit internals; read-model merge (`sealed: true`); renewal replace logic.
5. Client UI: share dialog (roster + codes-once + soft-limits copy), import dialog (inspect → code → preview → commit), sealed badges, read-only cards, AI-context/copy policy.
6. Watermark weave at the sealed-note render seam.
7. e2e: full publisher→recipient roundtrip on a seeded HTML source (export with 2 codes, import with code #2, anchors re-match, card renders sealed+read-only, export of that layer refuses, renewal excluding code #2 locks it out).
