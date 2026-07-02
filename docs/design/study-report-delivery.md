# Study Report + Delivery — 学习报告 · 导出族 · 推送给老师/家长

Serves the mission's second half (老师看得见) offline-first, and answers "发送到配置的地址 →
老师/家长收到 — 新系统还是基于现有客户端?" **Recommendation: teachers = the EXISTING client
(inbox mode); parents = exported artifact now, hosted web-view later. Do NOT build a second
system** — AIHomework's admin-web is the cautionary tale (a whole second React app for what is
here a view over data we already have). Grounded 2026-07-02.

## 1. 学习报告 (REPORT-1) — a view + an export, zero new entities
Deterministic doc built from MEM-2 digests + profile facts + review outcomes + note/anchor
counts for a period (本周/本月/自定义): 学了什么 (sources/notes by subject) · 弱项 (fail-ratio
buckets) · 复习 (queue completion, pass trend) · 活跃 (streak/days). Rendered by a registered
view; exported as **图片 (long-image, the WeChat-native artifact) + PDF + Markdown**.
User EDITS before export (hide any line — same hidden-fact respect as REV-2). Kernel: a view
over entities + derived data; the export is an operation.

## 2. 导出族 (REPORT-2) — take your data OUT in standard formats
- **错题集 → PDF/长图** (print-ready, per subject/period; the #1 China classroom artifact).
- **闪卡/生词 → Anki .apkg** (front/back map directly; subject.vocab is flashcard-isomorphic
  by design). ⚠️ verify apkg generation lib vs hand-rolled sqlite at build time.
- **笔记/文档 → Markdown bundle** (source + anchored quotes + notes, human-readable).
All are operations over existing types — each new content type can register an exporter
(`registerExporter`, additive — the recurring-capability principle).

## 3. 推送通道 (DELIVER-1/2) — plugin-configured destinations, client-to-client first
**Model: paired destinations, not raw IPs.** A destination = {名称, URL(IP:port or domain),
配对码-derived shared secret}. Pairing: teacher's client shows a 配对码 (QR on mobile later);
student enters it once; pushes are HMAC-signed with the pair secret + the sender's svpack
identity. LAN-first (classroom/home reality; no server needed), hosted relay later.
- **What can be sent:** report bundle · 错题集 · any .svpack (the existing protected container
  — delivery is a CHANNEL, svpack stays the format). NEVER raw memory data: only derived,
  user-PREVIEWED artifacts; every send is explicit (or a visible per-destination schedule) and
  logged (发送记录, revocable schedule).
- **Teacher receive = the SAME client, inbox mode (DELIVER-2):** Growte already runs an HTTP
  server — a receive endpoint (`POST /inbox`, pair-authenticated) + an 收件箱 view (sender,
  artifact type, import action → existing svpack import / report viewer). A teacher with 40
  students sees 40 rows, imports the packs, opens reports. 基于现有客户端 — the report viewer,
  svpack import, identity, HTTP server all exist; the inbox is one view + one route family.
- **Parents (no client):** V1 = student/teacher exports 长图/PDF and shares via WeChat manually.
  V2 (P3) = hosted relay + a web report page (rides G-gateway auth + WEB infra + ICP) — the
  SAME report artifact rendered server-side, share-link with expiry.
- **Cross-network (P3):** the hosted relay forwards pair-authenticated pushes when not on the
  same LAN — same pairing model, the relay never reads content (svpack stays encrypted;
  reports encrypted to the pair secret).

## 4. Privacy invariants (hard)
Only derived artifacts leave; preview-before-send always; per-destination consent + visible
log; hidden profile facts never appear in reports; svpack protections unchanged through the
channel; the receive endpoint accepts ONLY pair-authenticated pushes (no open port abuse) and
is OFF until the user enables inbox mode.

## 5. Phasing
- **REPORT-1** report view + 长图/PDF export (clean files; rides existing digest/profile APIs).
- **REPORT-2** exporter registry + Anki/Markdown/错题集 exporters.
- **DELIVER-1** destinations + pairing + signed push + send log (client→client LAN).
- **DELIVER-2** inbox mode (receive route + 收件箱 view + import wiring).
- **DELIVER-3 (P3)** hosted relay + parent web page (rides G/WEB/MH infra).

## 6. Tests
Report determinism from fixture digests (+hidden-fact exclusion); exporter roundtrips (Anki
opens in Anki — fixture-verified structure; PDF/long-image snapshot); pairing handshake +
HMAC rejection + replay nonce; inbox auth (unpaired push 401, paired lands + renders);
send-log completeness; two-client e2e on localhost (student pushes 错题集 → teacher inbox →
import → notes present).
