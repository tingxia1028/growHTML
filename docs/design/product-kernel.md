# Product Kernel — 北极星 · 内核 · 设计法则 · 取舍 (blessed 2026-07)

## 0. 使命一句话
> **把注意力钉在原文上,把理解外化成可检验的卡片,让 AI 围绕"你钉过什么、懂到哪"来讲解、出题、
> 带你复习——学生学得牢,老师看得见。**
Every feature must be traceable to this sentence. If the tracing takes more than one step, it
goes to P3 or the defer list.

## 1. The kernel (小而收敛,已被 F 系全程保卫)
```
5 entities: source · anchor · note · layer · concept
+ 1 approved organ entity: memoryEvent (the learner model — the AI-native organ)
+ content-as-data (note.content validated per contentType)
+ registries (types/views/commands/providers/taxonomies — extension = registration, not core edits)
+ one render contract (getNoteType().render, guard-tested)
```
**The design law:**
> **New capability must be one of: a content-type · a view over the entities · an AI operation.
> Anything demanding a NEW core concept is suspect by default.**
(memoryEvent was the one approved exception — it is the organ that makes AI-native possible.
The review loop proved the law works: 1 view + 3 operations + existing memory verbs = the loop.)

## 2. AI-native — the honest ladder
Today = **AI-assisted with clean seams** (the core loop works without AI; AI is user-triggered,
stateless, single-anchor). AI-native for THIS app = four moves, NOT AI-everywhere:
1. **Learner model into every call** — MEM-3 profileContext (the generic-ChatGPT vs native line).
2. **AI with eyes + hands on the vault** — A4a tools ✅ (search_notes/get_source).
3. **Close the review edge** — review-loop.md, P0 below. The loop: 读→锚→记→问→复→memory→AI 适配.
4. **克制的主动性** — a small suggestion surface reading digests; opt-in, never a chatty assistant.
Local-first stays: the manual loop MUST remain fully functional offline — AI is the multiplier
on every edge, not the oxygen.

**AI-native lives in the UPPER layer:** core owns the organs (provider registry · tools/agent
loop · memory · adaptive contract+preview gate · operations-as-data · slash palette); plugins
compose them into experiences (views/operations/types/taxonomies) and NEVER own transports,
capture, or privacy. The review plugin is exemplar #1.

## 3. The audit (keep / platform / defer)
| Bucket | Items | Rule |
|---|---|---|
| **学习环 (P0-P2)** | reader+anchors+notes, review loop, memory, presentation N-track, subjects, market M1, slash, source-authoring create, sharing (done) | serves the sentence directly |
| **Platform & business (P3)** | multi-platform X1-X4, managed real adapters + credits ops, W2/W3, M3, multidoc P-A/B, concepts P-C1, **MCP (server: export the A4a ToolDefinition registry to external agents like Claude Desktop — privacy-gated, sealed content never exposed; client: consume external tool servers)** | necessary, but distribution/monetization/interop of a closed loop — never ahead of closing it. MCP does NOT improve in-app generation (the in-process A4a tool registry is already the better path: same-process, typed, capability-gated); its value is REACH, and A4a was built so the future MCP exporter is a thin layer |
| **Deferred (blessed)** | terminal panel → hidden from study builds (dev flag); GrapesJS rich editing (SRC-4); M2 user-kit builder (until M1 proves demand); P-C2 advanced concept graph; MEM LLM narrative profile; A4b write-tools beyond createNote-through-preview | revisit only with a pull from real usage |

## 4. Priority inversion this doc fixes
The biggest hole was not a missing feature but a missing EDGE: all review parts existed
(mistake/quiz/flashcard/review-pack types, 复习 stage layer, note.review verb, board mode B)
with no loop connecting them. **P0 = REV-1 → MEM-2 → REV-2.** REV-2 (profile-adapted
explanation) is the moment the app becomes measurably AI-native. Everything else queues behind
or beside it, per the resorted sequence in `roadmap.md`.
