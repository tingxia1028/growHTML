// W1 — /api/chat/sessions CRUD + append (registerChatRoutes, src/server/chatSessions.ts)
// over the chatSessions entity store: create (auto title from the first user message,
// server ts stamping, attachment context refs), summary list ordering, single GET,
// rename, append (title backfill + updatedAt bump), delete, and the store roundtrip.
// Vault-fixture idiom mirrors memory.test.ts (tmp vault + pinned, advanceable clock).

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";
import { deriveSessionTitle, SESSION_TITLE_MAX_CHARS } from "./services/chatSessions";

type App = ReturnType<typeof createApp>;
type Ctx = { app: App; vault: StudyVault; clock: { now: number } };

const madeDirs: string[] = [];
const madeVaults: StudyVault[] = [];
async function tmp(tag: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), `chat-sessions-${tag}-`));
  madeDirs.push(d);
  return d;
}
afterAll(async () => {
  // STORE-SQL Stage-3: release each vault's sqlite handles before rm (no-op on jsonl).
  for (const v of madeVaults.splice(0)) v.close();
  await Promise.all(madeDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// July 4 2026 12:00Z — advanceable so updatedAt ordering/bumps are deterministic.
const NOW = Date.UTC(2026, 6, 4, 12);
const NOW_ISO = new Date(NOW).toISOString();

async function makeApp(tag: string): Promise<Ctx> {
  const vault = await openVault({ rootDir: await tmp(`${tag}-vault`) });
  madeVaults.push(vault);
  const clock = { now: NOW };
  const app = createApp({ vault, identityDir: await tmp(`${tag}-id`), now: () => clock.now });
  return { app, vault, clock };
}

// A JSONL-pinned vault, for the two guard tests below that assert on the raw `chat-sessions.jsonl`
// FILE serialization (STORE-SQL Stage-3). Those guards are INHERENTLY about the jsonl on-disk shape
// (ref-not-base64, bare-string-not-array): under the default sqlite engine the rows live in
// `chat-sessions.db` and the jsonl stub stays empty, so a raw `readFile` of the jsonl can't see them.
// The equivalent store-API roundtrip (`vault.stores.chatSessions.get`) is engine-agnostic and stays
// on the sqlite default (see the "persists an image ref array" test). resolveDefaultEngine() reads
// STORE_ENGINE at openVault time, so set-then-restore around the open pins just this vault.
async function makeJsonlApp(tag: string): Promise<Ctx> {
  const prior = process.env.STORE_ENGINE;
  process.env.STORE_ENGINE = "jsonl";
  try {
    return await makeApp(tag);
  } finally {
    if (prior === undefined) delete process.env.STORE_ENGINE;
    else process.env.STORE_ENGINE = prior;
  }
}

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("chat sessions — create", () => {
  it("creates a session: 201, chat_ id, server ts stamps, auto title from the first user message", async () => {
    const { app, vault } = await makeApp("create");
    const res = await request(app)
      .post("/api/chat/sessions")
      .send({
        messages: [{ role: "user", content: "  光合作用\n是什么？  " }],
        attachments: [{ sourceId: `src_${ULID}` }]
      })
      .expect(201);
    const session = res.body.session;
    expect(session.id).toMatch(/^chat_/);
    expect(session.type).toBe("chatSession");
    expect(session.title).toBe("光合作用 是什么？"); // whitespace collapsed
    expect(session.messages).toEqual([{ role: "user", content: "  光合作用\n是什么？  ", ts: NOW_ISO }]);
    expect(session.attachments).toEqual([{ sourceId: `src_${ULID}`, includeNotes: true }]);
    expect(session.createdAt).toBe(NOW_ISO);
    expect(session.updatedAt).toBe(NOW_ISO);
    // Store roundtrip: the record is durable in the vault's chatSessions jsonl.
    const stored = await vault.stores.chatSessions.get(session.id);
    expect(stored?.messages).toHaveLength(1);
    expect(stored?.title).toBe("光合作用 是什么？");
  });

  it("keeps an explicit title; truncates a long auto title", async () => {
    const { app } = await makeApp("title");
    const explicit = await request(app)
      .post("/api/chat/sessions")
      .send({ title: "My session", messages: [{ role: "user", content: "hello" }] })
      .expect(201);
    expect(explicit.body.session.title).toBe("My session");

    const long = "x".repeat(SESSION_TITLE_MAX_CHARS + 10);
    const auto = await request(app)
      .post("/api/chat/sessions")
      .send({ messages: [{ role: "user", content: long }] })
      .expect(201);
    expect(auto.body.session.title).toBe(`${"x".repeat(SESSION_TITLE_MAX_CHARS)}…`);
  });

  it("an empty create (no messages) is allowed — title stays empty until a user turn", async () => {
    const { app } = await makeApp("empty");
    const res = await request(app).post("/api/chat/sessions").send({}).expect(201);
    expect(res.body.session.title).toBe("");
    expect(res.body.session.messages).toEqual([]);
  });

  it("rejects a bad message role / non-source attachment with 400", async () => {
    const { app } = await makeApp("bad");
    await request(app)
      .post("/api/chat/sessions")
      .send({ messages: [{ role: "tool", content: "x" }] })
      .expect(400);
    await request(app)
      .post("/api/chat/sessions")
      .send({ attachments: [{ sourceId: `note_${ULID}` }] })
      .expect(400);
  });
});

describe("chat sessions — list / get", () => {
  it("lists summaries (no transcript), newest-updated first; GET returns the full session", async () => {
    const { app, clock } = await makeApp("list");
    const first = (
      await request(app).post("/api/chat/sessions").send({ messages: [{ role: "user", content: "first" }] })
    ).body.session;
    clock.now += 60_000;
    const second = (
      await request(app).post("/api/chat/sessions").send({ messages: [{ role: "user", content: "second" }] })
    ).body.session;

    const list = (await request(app).get("/api/chat/sessions").expect(200)).body.sessions;
    expect(list.map((s: { id: string }) => s.id)).toEqual([second.id, first.id]);
    expect(list[0]).toEqual({
      id: second.id,
      title: "second",
      createdAt: second.createdAt,
      updatedAt: second.updatedAt,
      messageCount: 1
    });
    expect(list[0].messages).toBeUndefined();

    const got = (await request(app).get(`/api/chat/sessions/${first.id}`).expect(200)).body.session;
    expect(got.messages).toEqual([{ role: "user", content: "first", ts: NOW_ISO }]);
  });

  it("GET of an unknown session is 404", async () => {
    const { app } = await makeApp("get404");
    await request(app).get(`/api/chat/sessions/chat_${ULID}`).expect(404);
  });
});

describe("chat sessions — append", () => {
  it("appends turns with server ts, bumps updatedAt, and backfills the auto title", async () => {
    const { app, clock } = await makeApp("append");
    const created = (await request(app).post("/api/chat/sessions").send({}).expect(201)).body.session;
    expect(created.title).toBe("");

    clock.now += 5_000;
    const afterUser = (
      await request(app)
        .post(`/api/chat/sessions/${created.id}/messages`)
        .send({ messages: [{ role: "user", content: "什么是酶？" }] })
        .expect(200)
    ).body.session;
    expect(afterUser.title).toBe("什么是酶？"); // backfilled from the first user turn
    expect(afterUser.messages).toEqual([{ role: "user", content: "什么是酶？", ts: new Date(clock.now).toISOString() }]);
    expect(afterUser.updatedAt).toBe(new Date(clock.now).toISOString());

    clock.now += 5_000;
    const afterAssistant = (
      await request(app)
        .post(`/api/chat/sessions/${created.id}/messages`)
        .send({ messages: [{ role: "assistant", content: "酶是生物催化剂。" }] })
        .expect(200)
    ).body.session;
    expect(afterAssistant.messages).toHaveLength(2);
    expect(afterAssistant.messages[1].ts).toBe(new Date(clock.now).toISOString());
    expect(afterAssistant.title).toBe("什么是酶？"); // unchanged once set
    expect(afterAssistant.updatedAt > afterUser.updatedAt).toBe(true);
  });

  it("rejects an empty batch (400) and an unknown session (404)", async () => {
    const { app } = await makeApp("append-bad");
    const created = (await request(app).post("/api/chat/sessions").send({}).expect(201)).body.session;
    await request(app).post(`/api/chat/sessions/${created.id}/messages`).send({ messages: [] }).expect(400);
    await request(app)
      .post(`/api/chat/sessions/chat_${ULID}/messages`)
      .send({ messages: [{ role: "user", content: "x" }] })
      .expect(404);
  });
});

describe("chat sessions — rename / delete", () => {
  it("PATCH renames; empty title 400; unknown 404", async () => {
    const { app } = await makeApp("rename");
    const created = (
      await request(app).post("/api/chat/sessions").send({ messages: [{ role: "user", content: "old" }] })
    ).body.session;
    const renamed = (
      await request(app).patch(`/api/chat/sessions/${created.id}`).send({ title: "新标题" }).expect(200)
    ).body.session;
    expect(renamed.title).toBe("新标题");
    await request(app).patch(`/api/chat/sessions/${created.id}`).send({ title: "" }).expect(400);
    await request(app).patch(`/api/chat/sessions/chat_${ULID}`).send({ title: "x" }).expect(404);
  });

  it("W2: PATCH sets the FULL attachment set, independent of the title", async () => {
    const { app } = await makeApp("attach");
    const created = (
      await request(app)
        .post("/api/chat/sessions")
        .send({ messages: [{ role: "user", content: "q" }], attachments: [{ sourceId: `src_${ULID}` }] })
    ).body.session;
    expect(created.attachments).toEqual([{ sourceId: `src_${ULID}`, includeNotes: true }]);

    // Add a second source (full-replace) without touching the title.
    const other = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const patched = (
      await request(app)
        .patch(`/api/chat/sessions/${created.id}`)
        .send({ attachments: [{ sourceId: `src_${ULID}` }, { sourceId: `src_${other}`, includeNotes: false }] })
        .expect(200)
    ).body.session;
    expect(patched.title).toBe(created.title); // untouched
    expect(patched.attachments).toEqual([
      { sourceId: `src_${ULID}`, includeNotes: true },
      { sourceId: `src_${other}`, includeNotes: false }
    ]);

    // Remove all (empty set) is a legit write.
    const cleared = (
      await request(app).patch(`/api/chat/sessions/${created.id}`).send({ attachments: [] }).expect(200)
    ).body.session;
    expect(cleared.attachments).toEqual([]);

    // A bare {} (neither title nor attachments) is rejected 400.
    await request(app).patch(`/api/chat/sessions/${created.id}`).send({}).expect(400);
  });

  it("W2: lazy-create — POST with attachments and NO messages creates an empty session carrying them", async () => {
    const { app } = await makeApp("lazy");
    const created = (
      await request(app)
        .post("/api/chat/sessions")
        .send({ attachments: [{ sourceId: `src_${ULID}` }] })
        .expect(201)
    ).body.session;
    expect(created.messages).toEqual([]);
    expect(created.title).toBe(""); // no user turn yet → empty auto title
    expect(created.attachments).toEqual([{ sourceId: `src_${ULID}`, includeNotes: true }]);
  });

  it("DELETE removes the session; a second delete is 404", async () => {
    const { app } = await makeApp("delete");
    const created = (
      await request(app).post("/api/chat/sessions").send({ messages: [{ role: "user", content: "bye" }] })
    ).body.session;
    await request(app).delete(`/api/chat/sessions/${created.id}`).expect(200);
    const list = (await request(app).get("/api/chat/sessions").expect(200)).body.sessions;
    expect(list).toEqual([]);
    await request(app).delete(`/api/chat/sessions/${created.id}`).expect(404);
  });
});

describe("deriveSessionTitle", () => {
  it("first USER message wins (system/assistant skipped), collapsed + truncated", () => {
    expect(
      deriveSessionTitle([
        { role: "system", content: "sys" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "  a\n b  " }
      ])
    ).toBe("a b");
    expect(deriveSessionTitle([{ role: "assistant", content: "only" }])).toBe("");
    expect(deriveSessionTitle([{ role: "user", content: `${"y".repeat(50)}` }])).toBe(`${"y".repeat(40)}…`);
  });

  // V-1 (vision-input.md §2): an image-first turn must not crash titling — messageText
  // collapses the array (image → `[image]`) so the derived title is stable, never
  // `[object Object]` or a throw.
  it("V-1: an image-first turn titles from the collapsed text (no crash)", () => {
    const ASSET = `asset_${ULID}`;
    expect(
      deriveSessionTitle([
        {
          role: "user",
          content: [
            { type: "image", assetId: ASSET },
            { type: "text", text: "  这道题\n怎么做  " }
          ]
        }
      ])
    ).toBe("[image] 这道题 怎么做");
    // An image-ONLY turn collapses to the placeholder rather than crashing.
    expect(deriveSessionTitle([{ role: "user", content: [{ type: "image", assetId: ASSET }] }])).toBe("[image]");
  });
});

describe("chat sessions — V-1 image message persistence", () => {
  const ASSET = `asset_${ULID}`;

  it("round-trips an image message: content is an ARRAY with the assetId REF inside", async () => {
    const { app, vault } = await makeApp("v1-image");
    const res = await request(app)
      .post("/api/chat/sessions")
      .send({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this?" },
              { type: "image", assetId: ASSET, mimeType: "image/png" }
            ]
          }
        ]
      })
      .expect(201);
    const session = res.body.session;
    // The image ref sits INSIDE the content array (not a scalar string).
    expect(Array.isArray(session.messages[0].content)).toBe(true);
    expect(session.messages[0].content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", assetId: ASSET, mimeType: "image/png" }
    ]);
    // Title derives from the collapsed text of the image-first turn.
    expect(session.title).toBe("what is this? [image]");

    // Store roundtrip: the persisted record carries the same array.
    const stored = await vault.stores.chatSessions.get(session.id);
    expect(stored?.messages[0].content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", assetId: ASSET, mimeType: "image/png" }
    ]);
  });

  it("GUARD: the vault JSONL holds the assetId REF, never base64 bytes", async () => {
    // jsonl-pinned: this guard reads the raw chat-sessions.jsonl on-disk serialization (below).
    const { app, vault } = await makeJsonlApp("v1-jsonl-guard");
    // A base64-looking blob that must NEVER be what lands in the JSONL — only the ref.
    const base64ish = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',,,";
    const created = (
      await request(app)
        .post("/api/chat/sessions")
        .send({
          messages: [
            { role: "user", content: [{ type: "text", text: base64ish }, { type: "image", assetId: ASSET }] }
          ]
        })
        .expect(201)
    ).body.session;

    const jsonlPath = path.join(vault.paths.studyDir, "chat-sessions.jsonl");
    const raw = await readFile(jsonlPath, "utf8");
    // The assetId ref is present; the persisted image part carries NO inline `data`/bytes.
    expect(raw).toContain(ASSET);
    expect(raw).toContain('"type":"image"');
    expect(raw).not.toContain('"data"');
    expect(raw).not.toMatch(/base64,[A-Za-z0-9+/]{40}/); // no embedded base64 payload
    expect(created.id).toMatch(/^chat_/);
  });

  it("REGRESSION: a text-only message persists as a bare string (byte-identical)", async () => {
    // jsonl-pinned: this guard reads the raw chat-sessions.jsonl on-disk serialization (below).
    const { app, vault } = await makeJsonlApp("v1-text-only");
    await request(app)
      .post("/api/chat/sessions")
      .send({ messages: [{ role: "user", content: "plain text only" }] })
      .expect(201);
    const jsonlPath = path.join(vault.paths.studyDir, "chat-sessions.jsonl");
    const raw = await readFile(jsonlPath, "utf8");
    // The content is the scalar string, not wrapped in an array of parts.
    expect(raw).toContain('"content":"plain text only"');
    expect(raw).not.toContain('"type":"text"');
  });
});
