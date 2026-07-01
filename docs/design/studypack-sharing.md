# Protected Layer Sharing — `.svpack` design

Status: design only (no implementation). Evolves the current plaintext `docs/samples/teacher-layer.studypack` transport into an encrypted, signed, per‑recipient, revocable container while reusing the existing layer / rematch / provenance machinery.

Author-facing name: **Study Vault Pack** (`.svpack`). Legacy plaintext export stays `.studypack`.

---

## 1. Goals, threat model, non‑goals

### 1.1 Goals
- Let a publisher (teacher, author) share a **Study Layer** — its notes + anchors + layer hierarchy — to a **named list of recipients**, such that:
  - only the intended recipients can open it (targeting),
  - the pack cannot be forged, tampered with, or spoofed as coming from the publisher,
  - a recipient can open it **offline** after a one‑time online redemption,
  - the publisher can **revoke** a single recipient without re‑issuing to everyone,
  - imported content **cannot be re‑exported** from inside the app, and
  - a leaked decrypted copy can be **attributed** to the account it came from.
- **Never ship the source document.** The pack carries only the layer (portable anchors + notes). It binds to the source by a **content hash**; on import the anchors re‑match against the recipient's OWN copy of the source.

### 1.2 Honest threat model (read this first)
The client must decrypt content to render it. Therefore **a determined attacker with a patched client, a debugger, or a screen recorder CAN extract the plaintext.** Perfect client‑side DRM does not exist — this is the same limit Kindle, Netflix, and every DRM system live with. This design does **not** pretend otherwise.

What this design **DOES** defend against:

| # | Threat | Defense |
|---|--------|---------|
| a | Plaintext note content sitting in the vault as `.jsonl` | Payload is **AES‑256‑GCM**; imported notes are stored **encrypted at rest**, re‑wrapped to the recipient's device key. Nothing is on disk in the clear. |
| b | Forged / tampered / publisher‑spoofed packs | Header+payload is **Ed25519**‑signed by the publisher; the client verifies against a pinned/served publisher public key before decrypting. |
| c | A non‑target user opening a pack they got hold of | The CEK is **wrapped per‑recipient** to that account/device public key at redemption. A pack + code that isn't yours yields a key‑wrap the server won't produce for your account. |
| d | In‑app re‑export of imported notes | The single export choke point (`buildStudyPack`) **refuses** any note whose `origin.exportable === false`. |
| e | Revocation + leak attribution | **Per‑recipient unique codes** (targeting + per‑recipient revoke + leak tracing) plus an **invisible per‑recipient watermark** (account id) woven into decrypted copies. |

What this design does **NOT** defend against (state plainly to the user):
- **Screenshots / screen recording / OCR.** Rendered pixels are outside our trust boundary.
- **Patched‑client / memory extraction.** Someone who rebuilds the client can dump the CEK or the decrypted notes from memory. The watermark is the deterrent here, not prevention.

### 1.3 Non‑goals
- No source‑document distribution (by design — see §2).
- No SRS/scheduling, no cloud realtime sync (subscribed‑layer `importMode` stays a V3 placeholder in `src/core/schema/study-layer.ts`).
- No full IdP/OAuth build in this doc; §4 specifies the account/key **model**, not an auth product.

---

## 2. Locked decisions

| # | Decision | Where it lands in the repo |
|---|----------|----------------------------|
| 1 | **Shared unit = a Layer** (notes + anchors + hierarchy), packaged as encrypted+signed `.svpack`, evolving today's plaintext `.studypack`. | `src/core/study-layer/pack.ts` (schema), `src/server/studyLayer.ts` (`buildStudyPack`). |
| 2 | **Layer‑only, never ship the source.** Layer binds via a **content‑hash source identity**; on import, anchors re‑match against the recipient's own copy (reuse `rematchAnchor` + text‑quote fallback + `rematchRegion`). Missing source ⇒ explicit "you need source X" UX. | `sourceFingerprint` (`src/core/schema/study-layer.ts`), `matchSourceByFingerprint` (`src/core/study-layer/fingerprint.ts`), `rematch.ts`, `region/region.ts`. |
| 3 | **Two‑tier identity — account is OPTIONAL for sharing, required only for multi‑device sync.** **Tier A (accountless):** a local **device keypair**, auto‑generated on first run, zero registration. **Tier B (account):** a server account owning N devices. Both tiers share the SAME container + crypto; they differ only in *what the CEK is wrapped to* and whether a server mediates revocation. | New `src/core/identity/` — device tier first, account tier in P2. |
| 4 | **Per‑recipient UNIQUE codes in BOTH tiers** (never a shared code ⇒ targeting + leak attribution). **Tier A:** the code deterministically **derives** that recipient's CEK‑wrap key (Argon2id(code) → AES‑KW) — per‑recipient, offline, NO key exchange, NO server. **Tier B:** the code is a server redemption token binding the pack to the recipient's account, then wraps the CEK to their device key. | Tier A local; Tier B server (§10). |
| 5 | **Revocation & lease scale with the tier.** Tier A: no true revoke — packs open under a **lease** (expires after N days) as the only clawback. Tier B: **server revokes a single code** without re‑issuing to everyone; offline‑openable after redeem, bounded by the lease window. | Local lease (both); server revoke (Tier B, §8/§10). |
| 6 | **Imported notes are NOT re‑exportable** — each carries `origin: { publisherId, packId, exportable: false }`; export choke point refuses non‑exportable / non‑locally‑authored notes. Stored **encrypted at rest**. Per‑recipient **invisible watermark** (code id in Tier A, account id in Tier B) in decrypted copies. | `note.origin` already exists in `src/core/schema/note.ts` (extend it); choke point in `buildStudyPack`. |

### 2.1 Capability matrix (which tier buys what)

| Capability | Tier A — accountless (device key) | Tier B — account (server) |
|---|---|---|
| Registration / network to open | none — fully offline | login required |
| Content not plaintext / anti‑forgery | ✅ AES‑GCM + Ed25519 | ✅ same |
| Per‑recipient unique code | ✅ code derives wrap key | ✅ code ↔ account |
| Imported notes non‑re‑exportable | ✅ choke point + encrypted‑at‑rest | ✅ same |
| **Revocation** | ⚠️ weak — lease expiry only | ✅ server revokes one code |
| **Targeting granularity** | binds to a **code** (forwardable, but traceable) | binds to a **person/account**, follows devices |
| Watermark attribution | code id | account id (stronger) |
| **Multi‑device sync** | ❌ | ✅ account = the sync identity |

Container format, AES‑GCM encryption, Ed25519 signing, and the no‑re‑export rule are **identical across tiers** — only the CEK‑wrap target (code‑derived key vs device key) and server mediation differ. **Tier B is a strict superset of Tier A**, so shipping A first loses nothing.

---

## 3. Container format `.svpack`

### 3.1 Rationale for the shape
Today `.studypack` (see `docs/samples/teacher-layer.studypack`) is a single plaintext JSON object validated by `studyPackSchema` in `src/core/study-layer/pack.ts`. That JSON is exactly the payload we now **encrypt**. `.svpack` wraps it with a cleartext header (routing/verify metadata) and a signature.

**Encoding recommendation: CBOR** for the outer container (compact, binary‑native for ciphertext/nonces/signatures, deterministic canonical form for signing), with the **inner payload being the existing UTF‑8 JSON** produced by `studyPackSchema.parse(...)`. CBOR avoids base64‑bloating the ciphertext and gives us a canonical byte sequence to sign; keeping the inner payload as the current JSON means zero churn to `buildStudyPack`'s object shape — we only encrypt its serialization.

### 3.2 Layout
```
.svpack  =  CBOR( { header, payload, signature } )

header    : cleartext, CBOR map  — signed, not encrypted
payload   : bytes               — AES-256-GCM ciphertext of the studypack JSON
signature : bytes (64)          — Ed25519 over  canonical(header) || payload
```

### 3.3 Header (cleartext, signed)
```jsonc
{
  "magic": "SVPACK",
  "formatVersion": 2,                 // 1 == legacy plaintext .studypack (see §3.6)
  "packId": "layer_01KVXWM3YC…",      // createEntityId("layer"), src/core/ids.ts
  "publisherId": "pub_01K…",          // account id of the publisher (§4)
  "publisherKeyId": "edk_01K…",       // which Ed25519 key signed (key rotation)
  "createdAt": "2026-06-24T22:39:44Z",
  "title": "Textbook Smoke — Cell Biology",   // convenience for the import UI
  "sourceHash": "sha256:553f7afe…",   // == sourceFingerprint.contentHash (§9)
  "sourceType": "html",
  "aead": {
    "alg": "AES-256-GCM",
    "nonce": "<12 bytes>",            // 96-bit GCM nonce, random per pack
    "aad": "canonical(header-minus-aead-fields)"   // header bound into GCM tag
  },
  "keywrap": {
    "alg": "X25519-HKDF-SHA256-AES256-KW",   // §4.3
    "hkdfInfo": "svpack/cek-wrap/v2"
  },
  "watermarkPolicy": { "scheme": "svwm/v1", "carriers": ["note-order","zwsp","synonym"] }
}
```
The CEK itself is **not** in the header. In **Tier A** (offline) the CEK is wrapped once per recipient to a key derived from that recipient's unique code — the pack carries an array `wraps: [{ codeId, wrappedCek }]` and the recipient's code selects + unwraps their entry (`keywrap.alg = "Argon2id-AES256-KW"`). In **Tier B** the wrapped CEK is fetched from the server keyed by `(packId, accountId)` and wrapped to the device key (`keywrap.alg = "X25519-HKDF-SHA256-AES256-KW"`, as shown above).

### 3.4 Payload (ciphertext)
Plaintext‑before‑encryption = the current `studyPackSchema` JSON, **plus** provenance stamps so the importer can set `origin` correctly (§7):
```jsonc
{
  "packId": "layer_…",
  "createdAt": "…",
  "app": "ai-study-vault",
  "sourceFingerprint": { "contentHash": "sha256:…", "title": "…", "sourceType": "html" },
  "layer": { "title": "…", "visibility": "private", "description": "…", "author": {…} },
  "anchors": [ /* portableAnchorSchema[] — quote/context/page/rect, refId only */ ],
  "notes":   [ /* portableNoteSchema[] — contentType + content + anchorRefs */ ],

  // NEW, added for protected packs:
  "provenance": { "publisherId": "pub_…", "packId": "layer_…", "exportable": false }
}
```
`anchors` / `notes` are byte‑identical to what `buildStudyPack` emits today — the protected path just encrypts the serialized object and appends `provenance`.

### 3.5 Signature
`Ed25519_sign(publisherPrivKey, canonical(header) || payloadBytes)`. Verified **before** any decryption attempt. This is what makes a tampered or publisher‑spoofed pack fail closed (threat **b**). `publisherKeyId` selects which of the publisher's keys to check, supporting rotation.

### 3.6 Versioning & back‑compat with `.studypack`
- `formatVersion: 1` = today's plaintext `.studypack` object (`studyPackSchema`). The import endpoint keeps accepting it verbatim — no signature, no encryption, `exportable` defaults to `true` (a v1 pack is treated as user‑authored, since that's the current behavior).
- `formatVersion: 2` = `.svpack`. The importer detects the container by the `SVPACK` magic (raw JSON with no magic ⇒ treat as legacy v1).
- The inner `studyPackSchema` is **unchanged**; only additive `provenance` is appended, and the schema already ignores unknown top‑level keys on the legacy path (or we add an optional `provenance` field). No migration of existing exports is required.

---

## 4. Identity & keys

Identity is **two‑tier** (§2, §2.1). **Tier A (accountless, ship first):** first run generates a local **device keypair** — no account, no server; per‑recipient targeting comes from code‑derived wrap keys (§3.3), and the "identity" is just the device. **Tier B (account, P2):** the account model below layers on top, adding cross‑device targeting, server revocation, and — reusing the same account — the multi‑device **sync** identity. §4.1–4.3 describe Tier B; Tier A uses only the device X25519 key + Argon2id(code) wrapping.

### 4.1 Account model (spec level)
New module `src/core/identity/` (does not exist today). An account:
```jsonc
{
  "id": "pub_01K… | acc_01K…",   // new id kinds, see §4.4
  "displayName": "…",
  "signingPubKey":  "<Ed25519 pub, base64url>",   // identity / authorship
  "devices": [
     { "deviceId": "dev_01K…", "kexPubKey": "<X25519 pub>", "addedAt": "…" }
  ]
}
```
- **Publisher** and **recipient** are the same account shape; "publisher" is just an account that has signed and issued a pack.
- One account, N devices. Each **device** holds its own **X25519** key‑exchange keypair (private key never leaves the device). CEK wrapping targets a device's `kexPubKey`, so a recipient with two devices gets two wraps (or re‑wrap on new‑device enrollment, §12).

### 4.2 Keypairs and their jobs
| Key | Algorithm | Lives on | Purpose |
|-----|-----------|----------|---------|
| Publisher signing key | **Ed25519** | publisher account (server holds pub; priv on publisher device) | Sign `.svpack` header+payload (§3.5). |
| Device key‑exchange key | **X25519** | recipient device (priv local‑only) | ECDH target for CEK wrapping (§4.3). |
| Content Encryption Key (CEK) | **AES‑256** (random per pack) | never at rest unwrapped | Encrypt the payload (AES‑256‑GCM). |

### 4.3 How the CEK gets wrapped on redemption
At redemption the server (or, in P1, the local redeemer) performs, per recipient device:
```
shared   = X25519(ephemeralPriv, deviceKexPub)          // ECDH
wrapKey  = HKDF-SHA256(shared, salt=packId, info="svpack/cek-wrap/v2", len=32)
wrapped  = AES-KW(wrapKey, CEK)                          // RFC 3394 key wrap
```
The recipient device recovers `CEK = AES-KW⁻¹( HKDF( X25519(devicePriv, ephemeralPub) ) )`, then AES‑256‑GCM‑decrypts the payload. The wrapped CEK + `ephemeralPub` are what the server hands back on redemption (§10) and what the client caches locally under a lease (§8). **The unwrapped CEK is held only in memory.**

### 4.4 New id kinds
Extend `entityKinds` / `idPrefixByKind` in `src/core/ids.ts`:
`account` → `acc`, `publisher` → `pub`, `device` → `dev`, `signingKey` → `edk`, `code` → `code`, `entitlement` → `ent`. Same ULID pattern, so ids stay sortable/greppable and reuse `createEntityId`.

---

## 5. Publisher flow

1. **Pick a layer.** In the Layer Lens, choose the layer to share (any `StudyLayerRecord`; its notes are `notes.layerIds.includes(layerId)` per `buildStudyPack`).
2. **Build the payload.** Reuse `buildStudyPack(vault, layerId)` to produce the portable anchors+notes object, stamped with `provenance.publisherId` / `packId` / `exportable:false`. The existing private‑by‑default drop (`isPrivateByDefault`, `src/kits/policy.ts`) still runs first.
3. **Encrypt + sign.** Generate a random CEK, AES‑256‑GCM the payload, assemble the header, Ed25519‑sign, emit `.svpack` (§3).
4. **Entitlement list.** The publisher submits the list of intended recipients (by email/account handle) to the server: `POST /packs/{packId}/entitlements`.
5. **Server issues per‑recipient codes.** The server mints **one unique code per recipient** (`code_…`), each bound to `(packId, recipientRef)`. Codes are opaque, single‑account‑binding, revocable.
6. **Distribute.** Publisher sends each recipient their `.svpack` + their unique code (email, LMS, hand‑out). The `.svpack` file can be identical for everyone; **the code is what differs and what targets** (threat **c/e**).

> **Tier A note (§11):** with no server, steps 4–5 happen in the publisher's own client — it mints the per‑recipient codes locally and bakes one `wrappedCek` per code into the pack (§3.3). Every recipient still gets the *same* `.svpack`; their unique code selects + unwraps their entry. Targeting + leak‑attribution work fully offline; only true **revocation** waits for Tier B.

---

## 6. Recipient flow

1. **Obtain** the `.svpack` file + a unique code.
2. **Redeem** (`POST /codes/{code}/redeem`, §10): server verifies the code is unused, matches the recipient's authenticated account and the pack's entitlement, then binds the code to that account and returns the **CEK wrapped to the account's device key** (§4.3) + `ephemeralPub` + a **lease** (`expiresAt`).
3. **Decrypt.** Client verifies the Ed25519 signature (against the served publisher pubkey), unwraps the CEK with the device X25519 private key, AES‑256‑GCM‑decrypts the payload.
4. **Store encrypted at rest.** Instead of writing plaintext notes as today's `commitImport` does, the imported notes/anchors are **re‑encrypted to the recipient's device key** before hitting the store (§7). Each note is stamped `origin: { publisherId, packId, layerId, exportable: false, copiedFrom: packId }` (extends the existing `note.origin`, `src/core/schema/note.ts`).
5. **Watermark.** On every decrypt‑to‑render, weave the recipient's `accountId` into the rendered copy via the watermark scheme (§7.3).
6. **Re‑anchor on the local source.** Exactly the existing pipeline:
   - `matchSourceByFingerprint(localSources, pack.sourceFingerprint)` finds the recipient's own copy by **contentHash first** (`src/core/study-layer/fingerprint.ts`).
   - For each portable anchor, `rematchAnchor(portable, { text, sameBinary })` re‑locates the quote (text‑quote + context fallback in `rematch.ts`; geometric kinds via `rematchRegion` in `src/core/region/region.ts`).
   - Realized anchors are created with `matchStatus` (matched/fuzzy/unmatched); unmatched ones are never dropped (kept in note metadata for manual re‑anchor — current behavior).
   - The imported layer nests under the per‑source `ensureImportedParent` "导入图层" parent (`src/core/study-layer/layers.ts`), preserving hierarchy.
7. **Missing‑source UX.** If `matchSourceByFingerprint` returns `null` (no local source with the matching `contentHash`), the import commits the layer **unbound** (`localSourceId` empty, all anchors `unmatched`) and the UI shows: *"This pack annotates «Textbook Smoke — Cell Biology» (`sha256:553f7afe…`). You don't have that source yet — open or import it, then click Re‑anchor."* When the matching source later ingests (its `contentHash` will match — §9), a **Re‑anchor** action re‑runs `commitImport`'s rematch against it. **No source bytes are ever requested or shipped.**

---

## 7. No‑re‑export enforcement

### 7.1 The choke point
There is exactly one path out of the vault into a shareable artifact: **`buildStudyPack` in `src/server/studyLayer.ts`**, surfaced by `POST /api/layers/:layerId/export` in `src/server/app.ts` (line ~985). This is the single place to enforce.

Rule (added to `buildStudyPack`, before assembling `notes`):
```
for each note in layerNotes:
    if note.origin?.exportable === false:  REFUSE  (skip + surface "N imported notes can't be re-exported")
    if note.origin?.publisherId is set and !== me: REFUSE
    else: exportable (locally authored)
```
Because export flows through this one function, an imported note can never leave — regardless of which UI button triggered it. Anchors referenced only by refused notes drop out the same way the current private‑by‑default drop already prunes them.

### 7.2 Encrypted at rest
Imported notes/anchors are stored **ciphertext**, wrapped to the recipient's device key, not the plaintext `.jsonl` that owned notes use. This means: (a) copying the vault directory yields nothing readable, and (b) even the on‑disk representation of imported content is bound to the device that redeemed it. Decryption happens per‑render, in memory, gated by a valid lease (§8).

### 7.3 Watermark forensics
Every decrypted‑for‑render copy of an imported note carries an **invisible watermark encoding the recipient's `accountId`**, so a leaked screenshot/text can be traced. `svwm/v1` carriers (redundant, so any one surviving is enough):
- **Zero‑width steganography** (`zwsp` — U+200B/U+200C/U+2060 sequences) inserted at stable token boundaries in text content.
- **Synonym / phrasing bit‑carrier** (`synonym`) — a deterministic low‑rate choice among equivalent renderings keyed by account‑id bits.
- **Note/list ordering** (`note-order`) — a stable permutation of independent list items keyed by account id.
This is a **deterrent + attribution** tool, explicitly **not** a prevention mechanism (threat model §1.2). Robustness caveats in §12.

---

## 8. Revocation + lease

### 8.1 Lease (offline openability)
On redemption the server returns `lease = { packId, accountId, expiresAt, wrappedCek, ephemeralPub, publisherKeyId }`, cached locally (encrypted to the device key). While `now < expiresAt` (N days, e.g. 14), the client opens the pack **fully offline** — no network. On `expiresAt`, the client must re‑check online before decrypting again.

### 8.2 Online re‑check / revocation
- `POST /codes/{code}/recheck` (or `/packs/{packId}/lease`) returns a fresh lease **iff** the code is still valid for this account. If the publisher revoked it, the server returns `revoked` and the client:
  - deletes the cached lease + wrapped CEK,
  - keeps `origin` records but marks the imported layer `revoked` (content no longer decryptable — the CEK is gone and won't be re‑issued).
- **Publisher revokes** a recipient: `POST /codes/{code}/revoke`. Because codes are **per‑recipient**, this targets exactly one account; everyone else's leases renew normally. This is what makes threat **e** (revocation + attribution) actionable.
- Revocation is **eventual**, bounded by the lease window — an offline client keeps working until its lease expires (a deliberate, honest tradeoff; see Kindle parallel in §1.2).

---

## 9. Source identity (content hash)

**The repo already has this** — no new hashing primitive needed:
- `computeContentHash` / `computeBufferHash` in `src/core/store/sources.ts` produce `sha256:<hex>` at ingest for every source (text and binary), stored as `SourceRecord.contentHash` (validated `^sha256:[a-f0-9]{64}$` in `src/core/schema/source.ts`).
- `sourceFingerprintSchema` (`src/core/schema/study-layer.ts`) already carries `contentHash` first, and `matchSourceByFingerprint` (`src/core/study-layer/fingerprint.ts`) already matches **contentHash before** fileHash/url/title.
- The existing sample `docs/samples/teacher-layer.studypack` already ships `sourceFingerprint.contentHash: "sha256:553f7afe…"`.

So `.svpack`'s `header.sourceHash` is simply `sourceFingerprint.contentHash`, and the recipient‑side re‑anchor is the **already‑built** `matchSourceByFingerprint` → `rematchAnchor` → `realizeAnchor` pipeline in `src/server/studyLayer.ts`. **Repo reality: the content‑hash source identity we need already exists; we reuse it rather than add it.** The only stability caveat is PDF re‑saves changing bytes (→ hash miss → falls back to url/title, then manual re‑anchor); see §12.

---

## 10. Server surface (minimal API sketch)

New service (P2+). All authenticated as an account (device‑key‑signed session).

| Endpoint | Who | Does |
|----------|-----|------|
| `POST /packs` | publisher | Register a pack: `{ packId, publisherId, publisherKeyId, sourceHash, formatVersion }`. Stores the CEK **wrapped to the publisher** for later per‑recipient re‑wrap, or the publisher re‑wraps client‑side. |
| `POST /packs/{packId}/entitlements` | publisher | Submit recipient list `[{ recipientRef }]`; server mints one `code_…` per recipient. Returns codes for distribution. |
| `POST /codes/{code}/redeem` | recipient | Verify code unused + entitlement + authenticated account; **bind code→account** (first‑redeem locks it); return `{ wrappedCek, ephemeralPub, lease, publisherPubKey }` for the account's device(s). |
| `POST /codes/{code}/recheck` | recipient | Re‑issue a lease iff still valid (drives §8 offline‑expiry re‑check). |
| `POST /codes/{code}/revoke` | publisher | Revoke one recipient's access (per‑recipient). |
| `GET  /publishers/{id}/keys` | any | Fetch publisher Ed25519 public key(s) by `publisherKeyId` for signature verification (§3.5). Pinnable. |

Notes: codes are opaque, single‑use‑to‑bind, one account each. The server never sees plaintext content (it only handles wrapped CEKs + entitlements) — a compromised server leaks entitlements and can grief revocation, but not content.

---

## 11. Phasing / milestones (each independently shippable)

**P1 — Tier A: accountless, per‑recipient codes, fully offline.**
- `.svpack` format v2 (§3): AES‑256‑GCM payload + Ed25519 signature; a **device keypair** auto‑generated on first run (no registration).
- **Per‑recipient unique codes** whose Argon2id‑derived key wraps the CEK (`wraps: [{codeId, wrappedCek}]`, §3.3) — targeting + leak attribution with NO server and NO key exchange.
- `note.origin.exportable:false` + provenance stamps (extend `src/core/schema/note.ts`).
- Export choke point refusal in `buildStudyPack` (§7.1).
- Imported content **encrypted at rest** to the local device key (§7.2).
- Ships real value: tamper‑proof, non‑plaintext, non‑re‑exportable, per‑recipient packs — offline, zero infrastructure. Clawback = lease expiry only.

**P2 — Tier B: accounts + server entitlement + revocation + the sync foundation.**
- `src/core/identity/` account+device model (§4), new id kinds (§4.4). **This account layer is also the identity that later powers multi‑device sync** — build once, feed both.
- Server surface (§10); code becomes a redemption token; X25519→HKDF→AES‑KW per‑device CEK wrapping (§4.3).
- Real per‑code **revocation** + lease/online re‑check (§8); targeting binds to the **person**, follows devices.

**P3 — Watermark / forensics + polish.**
- `svwm/v1` per‑recipient invisible watermark (§7.3) + an extraction/attribution tool.
- Multi‑device re‑wrap, key rotation UX, missing‑source Re‑anchor polish.

---

## 12. Open questions / risks

- **Key loss / recovery.** Device X25519 private key loss = unrecoverable local content (by design). Need an account‑level recovery: server‑held escrow of a recovery‑wrapped CEK, or re‑redeem on a fresh device (server re‑wraps to the new device key). Decide escrow vs. re‑redeem.
- **Account migration across devices.** Enrolling a new device must re‑wrap every active pack's CEK to the new `kexPubKey`. Server‑mediated re‑wrap on device‑add, gated by valid entitlement.
- **Watermark robustness.** Zero‑width chars are stripped by copy‑paste normalizers; OCR destroys steganography; synonym/order carriers survive better but have low bit‑rate. Treat as probabilistic attribution, not proof.
- **Source‑hash stability.** `contentHash` is exact‑bytes. A PDF re‑saved by a different viewer, an HTML re‑encoded, or a whitespace‑normalized copy → different hash → contentHash miss. Mitigations already present: fingerprint falls back to canonicalUrl/url/title, and `rematch.ts` is whitespace/case‑flexible so anchors still re‑locate even when `sameBinary=false` (region/rect kinds go `fuzzy`). Consider an additional normalized‑text hash as a second fingerprint tier.
- **Server trust.** The server mediates entitlement/revocation but never holds plaintext. A malicious server can deny/grief but not read content; document this boundary.
- **Legacy `.studypack` coexistence.** v1 plaintext packs remain importable and are treated as user‑authored/exportable — confirm that's acceptable (they carry no protection by definition).

---

## 13. Reuse map (what each part builds on)

| Design part | Existing code to reuse / extend |
|-------------|--------------------------------|
| Portable pack payload | `src/core/study-layer/pack.ts` — `studyPackSchema`, `portableAnchorSchema`, `portableNoteSchema` (inner plaintext of `.svpack`). |
| Export + the **choke point** | `src/server/studyLayer.ts` — `buildStudyPack` (add `exportable` refusal); endpoint `POST /api/layers/:layerId/export` in `src/server/app.ts` (~L985). |
| Import + re‑anchor | `src/server/studyLayer.ts` — `previewImport`, `commitImport`, `realizeAnchor`; endpoints `/api/layers/import/preview` + `/commit` (~L1000). |
| Content‑hash source identity | `src/core/store/sources.ts` — `computeContentHash` / `computeBufferHash`, `SourceRecord.contentHash`; `src/core/schema/source.ts` (hash format). |
| Fingerprint match (contentHash‑first) | `src/core/study-layer/fingerprint.ts` — `fingerprintForSource`, `matchSourceByFingerprint`. |
| Anchor re‑match (text‑quote fallback) | `src/core/study-layer/rematch.ts` — `rematchAnchor`, `rematchText`. |
| Region / rect re‑match | `src/core/region/region.ts` — `rematchRegion`, `RegionTarget`, `rectSchema`, `isRegionAnchorKind`. |
| Layer model + hierarchy (`parentId`) | `src/core/schema/study-layer.ts` — `studyLayerSchema` (`parentId`, `origin`, `importMode`, `sourceFingerprint`); `src/core/study-layer/layers.ts` — `ensureImportedParent`, `ensureOwnedLayer`. |
| Note provenance (`origin`) | `src/core/schema/note.ts` — `note.origin` (extend with `publisherId` + `exportable`). |
| Private‑by‑default drop (already a policy hook) | `src/kits/policy.ts` — `isPrivateByDefault` (runs before export; watermark/refusal compose with it). |
| Id scheme (new account/device/code kinds) | `src/core/ids.ts` — `entityKinds`, `idPrefixByKind`, `createEntityId`. |
| Hash primitive | `src/core/storage/sha256.ts` — `sha256Hex` (pure, cross‑platform; reuse, don't add node:crypto for hashing). |
| Sample to evolve | `docs/samples/teacher-layer.studypack` (v1) → v2 `.svpack`. |
| New crypto (to add) | AES‑256‑GCM, Ed25519, X25519, HKDF‑SHA256, AES‑KW, Argon2id — none exist in repo yet; add under a new `src/core/crypto/` leaf (mirroring `sha256.ts`'s pure‑leaf convention). |
