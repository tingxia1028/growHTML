// @vitest-environment jsdom
// W1 client chat-session domain (useChatSessionDomain) over MOCKED fetch — the IO
// layer (sessionClient's transport) is exercised for real against an in-memory fake
// /api/chat/sessions. Covers: resume-on-mount (stored id → most-recent fallback →
// explicit-new sentinel), lazy session create on the first user turn (with the
// active source as the attachment context ref), FIFO create→append ordering, the
// stream seams (chunks local-only, persistAssistant appends the completed turn),
// switch (select loads the transcript), delete (active → fresh start).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ACTIVE_SESSION_STORAGE_KEY,
  useChatSessionDomain,
  type ChatSessionDomain
} from "./useChatSessions";
import type { ChatSessionRecord } from "./sessionClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// —— harness ————————————————————————————————————————————————————————————————

let domain: ChatSessionDomain;
function Probe({ sourceId }: { sourceId?: string }) {
  domain = useChatSessionDomain({ activeSourceId: sourceId });
  return null;
}

function mount(node: ReactNode): { root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node as ReactElement));
  return {
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

/** Let the fetch/queue promise chains settle inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const T1 = "2026-07-04T08:00:00.000Z";
const T2 = "2026-07-04T09:00:00.000Z";

function makeSession(id: string, title: string, updatedAt: string, messages: ChatSessionRecord["messages"]): ChatSessionRecord {
  return { id, title, createdAt: T1, updatedAt, messages, attachments: [] };
}

// In-memory fake of the /api/chat/sessions HTTP surface; records every call.
function stubSessionApi(seed: ChatSessionRecord[] = []) {
  const sessions = new Map(seed.map((session) => [session.id, session]));
  const calls: string[] = [];
  let nextId = 1;
  const json = (body: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => body
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      if (method === "GET" && url === "/api/chat/sessions") {
        const list = [...sessions.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length }));
        return json({ sessions: list });
      }
      if (method === "POST" && url === "/api/chat/sessions") {
        const messages = (body.messages ?? []) as ChatSessionRecord["messages"];
        const firstUser = messages.find((m) => m.role === "user");
        const session: ChatSessionRecord = {
          id: `chat_created_${nextId++}`,
          title: (body.title as string) || (typeof firstUser?.content === "string" ? firstUser.content : "") || "",
          createdAt: T2,
          updatedAt: T2,
          messages: messages.map((m) => ({ ...m, ts: T2 })),
          attachments: (body.attachments ?? []) as ChatSessionRecord["attachments"]
        };
        sessions.set(session.id, session);
        return json({ session }, 201);
      }
      const single = /^\/api\/chat\/sessions\/([^/]+)$/.exec(url);
      if (single && method === "GET") {
        const session = sessions.get(single[1]);
        return session ? json({ session }) : json({ error: "Chat session not found" }, 404);
      }
      if (single && method === "DELETE") {
        return sessions.delete(single[1]) ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (single && method === "PATCH") {
        const session = sessions.get(single[1]);
        if (!session) return json({ error: "Chat session not found" }, 404);
        const next = {
          ...session,
          ...(body.title !== undefined ? { title: body.title as string } : {}),
          ...(body.attachments !== undefined
            ? { attachments: body.attachments as ChatSessionRecord["attachments"] }
            : {}),
          updatedAt: T2
        };
        sessions.set(next.id, next);
        return json({ session: next });
      }
      const append = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(url);
      if (append && method === "POST") {
        const session = sessions.get(append[1]);
        if (!session) return json({ error: "Chat session not found" }, 404);
        const incoming = (body.messages as ChatSessionRecord["messages"]).map((m) => ({ ...m, ts: T2 }));
        const next = { ...session, messages: [...session.messages, ...incoming], updatedAt: T2 };
        sessions.set(next.id, next);
        return json({ session: next });
      }
      return json({ error: `unhandled ${method} ${url}` }, 500);
    })
  );
  return { sessions, calls };
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

// —— resume ————————————————————————————————————————————————————————————————

describe("useChatSessionDomain — resume on mount", () => {
  it("resumes the STORED session (not the most recent) and loads its transcript", async () => {
    stubSessionApi([
      makeSession("chat_new", "newer", T2, [{ role: "user", content: "hi", ts: T2 }]),
      makeSession("chat_old", "older", T1, [
        { role: "user", content: "什么是酶？", ts: T1 },
        { role: "assistant", content: "酶是生物催化剂。", ts: T1 }
      ])
    ]);
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, "chat_old");
    cleanup = mount(<Probe />).cleanup;
    await flush();
    expect(domain.sessions.activeId).toBe("chat_old");
    expect(domain.messages).toEqual([
      { role: "user", content: "什么是酶？" },
      { role: "assistant", content: "酶是生物催化剂。" }
    ]);
    expect(domain.sessions.list.map((s) => s.id)).toEqual(["chat_new", "chat_old"]);
  });

  it("falls back to the most recent session when nothing is stored", async () => {
    stubSessionApi([
      makeSession("chat_new", "newer", T2, [{ role: "user", content: "hi", ts: T2 }]),
      makeSession("chat_old", "older", T1, [{ role: "user", content: "x", ts: T1 }])
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    expect(domain.sessions.activeId).toBe("chat_new");
    expect(domain.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("respects an explicit fresh start (the NONE sentinel): list loads, nothing resumes", async () => {
    stubSessionApi([makeSession("chat_a", "a", T1, [{ role: "user", content: "x", ts: T1 }])]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    act(() => domain.sessions.startNew()); // stores the sentinel
    cleanup();
    cleanup = mount(<Probe />).cleanup;
    await flush();
    expect(domain.sessions.activeId).toBeNull();
    expect(domain.messages).toEqual([]);
    expect(domain.sessions.list).toHaveLength(1);
  });

  it("a 新对话 clicked while the resume GET is in flight is NOT clobbered by the late resume", async () => {
    // Gate the single-session GET (the resume's transcript load) so we can click
    // 新对话 while it's pending — the exact race the userActedRef latch guards.
    let releaseGet: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const seed = makeSession("chat_a", "a", T1, [{ role: "user", content: "old", ts: T1 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
        if (method === "GET" && url === "/api/chat/sessions") {
          return json({ sessions: [{ id: seed.id, title: seed.title, createdAt: seed.createdAt, updatedAt: seed.updatedAt, messageCount: seed.messages.length }] });
        }
        if (/^\/api\/chat\/sessions\/chat_a$/.test(url) && method === "GET") {
          await gate; // resume's transcript load blocks here
          return json({ session: seed });
        }
        return json({ error: `unhandled ${method} ${url}` }, 500);
      })
    );
    cleanup = mount(<Probe />).cleanup;
    await flush(); // list() resolves; the resume get() is parked on the gate
    act(() => domain.sessions.startNew()); // user explicitly starts fresh mid-flight
    act(() => releaseGet?.()); // the late resume get() now resolves
    await flush();
    // The fresh conversation must survive — the stale "old" transcript must NOT load.
    expect(domain.sessions.activeId).toBeNull();
    expect(domain.messages).toEqual([]);
  });
});

// —— persistence seams ————————————————————————————————————————————————————————

describe("useChatSessionDomain — turn persistence", () => {
  it("first user turn lazily CREATES the session (active source rides as attachment), stream end appends — FIFO", async () => {
    const { calls, sessions } = stubSessionApi([]);
    cleanup = mount(<Probe sourceId="src_01ARZ3NDEKTSV4RRFFQ69G5FAV" />).cleanup;
    await flush();

    act(() => domain.recordHistory([{ role: "user", content: "什么是酶？" }]));
    act(() => domain.applyChunk("酶是"));
    act(() => domain.applyChunk("催化剂。"));
    expect(domain.messages).toEqual([
      { role: "user", content: "什么是酶？" },
      { role: "assistant", content: "酶是催化剂。" }
    ]);
    act(() => domain.persistAssistant({ role: "assistant", content: "酶是催化剂。" }));
    await flush();

    expect(calls).toEqual([
      "GET /api/chat/sessions",
      "POST /api/chat/sessions",
      "POST /api/chat/sessions/chat_created_1/messages"
    ]);
    const stored = sessions.get("chat_created_1")!;
    expect(stored.attachments).toEqual([{ sourceId: "src_01ARZ3NDEKTSV4RRFFQ69G5FAV", includeNotes: true }]);
    expect(stored.messages.map((m) => m.content)).toEqual(["什么是酶？", "酶是催化剂。"]);
    expect(domain.sessions.activeId).toBe("chat_created_1");
    expect(window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBe("chat_created_1");
    expect(domain.sessions.list).toHaveLength(1);
  });

  it("chunks alone never persist; the non-streamed fallback (appendAssistant) does", async () => {
    const { calls, sessions } = stubSessionApi([]);
    cleanup = mount(<Probe />).cleanup;
    await flush();

    act(() => domain.recordHistory([{ role: "user", content: "q" }]));
    await flush();
    const before = calls.length;
    act(() => domain.applyChunk("partial"));
    await flush();
    expect(calls.length).toBe(before); // render-only

    act(() => domain.appendAssistant({ role: "assistant", content: "full reply" }));
    await flush();
    expect(calls[calls.length - 1]).toBe("POST /api/chat/sessions/chat_created_1/messages");
    expect(sessions.get("chat_created_1")!.messages.map((m) => m.content)).toEqual(["q", "full reply"]);
  });

  it("a second user turn APPENDS to the session created by the first (no duplicate create)", async () => {
    const { calls } = stubSessionApi([]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    act(() => domain.recordHistory([{ role: "user", content: "one" }]));
    act(() =>
      domain.recordHistory([
        { role: "user", content: "one" },
        { role: "user", content: "two" }
      ])
    );
    await flush();
    expect(calls.filter((call) => call === "POST /api/chat/sessions")).toHaveLength(1);
    expect(calls[calls.length - 1]).toBe("POST /api/chat/sessions/chat_created_1/messages");
  });
});

// —— switch / delete ————————————————————————————————————————————————————————

describe("useChatSessionDomain — switch and delete", () => {
  it("select loads the picked session's transcript and stores it for resume", async () => {
    stubSessionApi([
      makeSession("chat_a", "a", T2, [{ role: "user", content: "in a", ts: T1 }]),
      makeSession("chat_b", "b", T1, [{ role: "user", content: "in b", ts: T1 }])
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush(); // resumed chat_a (most recent)
    await act(async () => domain.sessions.select("chat_b"));
    expect(domain.sessions.activeId).toBe("chat_b");
    expect(domain.messages).toEqual([{ role: "user", content: "in b" }]);
    expect(window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBe("chat_b");
  });

  it("removing the ACTIVE session starts a fresh conversation; others just leave the list", async () => {
    const { calls } = stubSessionApi([
      makeSession("chat_a", "a", T2, [{ role: "user", content: "in a", ts: T1 }]),
      makeSession("chat_b", "b", T1, [{ role: "user", content: "in b", ts: T1 }])
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush(); // active = chat_a
    await act(async () => domain.sessions.remove("chat_b"));
    expect(domain.sessions.list.map((s) => s.id)).toEqual(["chat_a"]);
    expect(domain.sessions.activeId).toBe("chat_a"); // untouched

    await act(async () => domain.sessions.remove("chat_a"));
    expect(calls).toContain("DELETE /api/chat/sessions/chat_a");
    expect(domain.sessions.list).toEqual([]);
    expect(domain.sessions.activeId).toBeNull();
    expect(domain.messages).toEqual([]);
  });

  it("startNew clears the panel and the next send creates a NEW session", async () => {
    const { calls } = stubSessionApi([
      makeSession("chat_a", "a", T2, [{ role: "user", content: "in a", ts: T1 }])
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush(); // resumed chat_a
    act(() => domain.sessions.startNew());
    expect(domain.messages).toEqual([]);
    act(() => domain.recordHistory([{ role: "user", content: "fresh" }]));
    await flush();
    expect(calls.filter((call) => call === "POST /api/chat/sessions")).toHaveLength(1);
    expect(domain.sessions.activeId).toBe("chat_created_1");
    expect(domain.sessions.list.map((s) => s.id)).toEqual(["chat_created_1", "chat_a"]);
  });
});

// —— W2 attachments ————————————————————————————————————————————————————————————

describe("useChatSessionDomain — attachments (W2)", () => {
  it("loads a resumed session's attachments into state", async () => {
    stubSessionApi([
      {
        ...makeSession("chat_a", "a", T2, [{ role: "user", content: "x", ts: T1 }]),
        attachments: [{ sourceId: "src_1", includeNotes: true }]
      }
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    expect(domain.sessions.attachments).toEqual([{ sourceId: "src_1", includeNotes: true }]);
  });

  it("addAttachment on a LIVE session updates state and PATCHes the full set", async () => {
    const { calls, sessions } = stubSessionApi([
      makeSession("chat_a", "a", T2, [{ role: "user", content: "x", ts: T1 }])
    ]);
    cleanup = mount(<Probe />).cleanup;
    await flush(); // active = chat_a (no attachments)
    act(() => domain.sessions.addAttachment("src_1"));
    // Optimistic local state updates immediately.
    expect(domain.sessions.attachments).toEqual([{ sourceId: "src_1", includeNotes: true }]);
    await flush();
    expect(calls).toContain("PATCH /api/chat/sessions/chat_a");
    expect(sessions.get("chat_a")!.attachments).toEqual([{ sourceId: "src_1", includeNotes: true }]);
  });

  it("addAttachment is idempotent by sourceId; removeAttachment persists the remainder", async () => {
    const { sessions } = stubSessionApi([makeSession("chat_a", "a", T2, [{ role: "user", content: "x", ts: T1 }])]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    act(() => domain.sessions.addAttachment("src_1"));
    act(() => domain.sessions.addAttachment("src_2"));
    act(() => domain.sessions.addAttachment("src_1", false)); // re-attach updates flag, no dup
    await flush();
    expect(domain.sessions.attachments).toEqual([
      { sourceId: "src_2", includeNotes: true },
      { sourceId: "src_1", includeNotes: false }
    ]);
    act(() => domain.sessions.removeAttachment("src_2"));
    await flush();
    expect(domain.sessions.attachments).toEqual([{ sourceId: "src_1", includeNotes: false }]);
    expect(sessions.get("chat_a")!.attachments).toEqual([{ sourceId: "src_1", includeNotes: false }]);
  });

  it("LAZY-CREATE: attaching BEFORE the first turn creates an empty session carrying the attachment", async () => {
    const { calls, sessions } = stubSessionApi([]);
    cleanup = mount(<Probe />).cleanup;
    await flush();
    expect(domain.sessions.activeId).toBeNull(); // no session yet
    act(() => domain.sessions.addAttachment("src_1"));
    await flush();
    // The queue CREATED an empty session carrying the attachment (create-or-patch trigger).
    expect(calls.filter((call) => call === "POST /api/chat/sessions")).toHaveLength(1);
    expect(domain.sessions.activeId).toBe("chat_created_1");
    const created = sessions.get("chat_created_1")!;
    expect(created.messages).toEqual([]);
    expect(created.attachments).toEqual([{ sourceId: "src_1", includeNotes: true }]);

    // A subsequent turn APPENDS to the lazily-created session (no duplicate create).
    act(() => domain.recordHistory([{ role: "user", content: "now ask" }]));
    await flush();
    expect(calls.filter((call) => call === "POST /api/chat/sessions")).toHaveLength(1);
    expect(calls[calls.length - 1]).toBe("POST /api/chat/sessions/chat_created_1/messages");
  });

  it("attach-then-first-turn: the turn's lazy create carries the EXPLICIT attachment (wins over the focused source)", async () => {
    const { sessions } = stubSessionApi([]);
    // The focused source is src_focus, but the user explicitly attached src_explicit.
    cleanup = mount(<Probe sourceId="src_focus" />).cleanup;
    await flush();
    act(() => domain.sessions.addAttachment("src_explicit"));
    // First turn races with the attachment persist; both bind the same token, only one creates.
    act(() => domain.recordHistory([{ role: "user", content: "q" }]));
    await flush();
    const created = sessions.get("chat_created_1")!;
    // The created session carries the EXPLICIT attachment set — not the focused-source auto ref.
    expect(created.attachments.map((a) => a.sourceId)).toEqual(["src_explicit"]);
    expect(created.messages.map((m) => m.content)).toEqual(["q"]);
    // Exactly ONE session was created (no double-create despite two queued ops).
    expect([...sessions.keys()]).toEqual(["chat_created_1"]);
  });
});
