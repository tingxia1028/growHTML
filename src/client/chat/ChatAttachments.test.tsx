// @vitest-environment jsdom
// W2 — ChatAttachments renders the session's attached-source chips (removable) and a
// "+" picker over the not-yet-attached library sources. Pure view over a fake
// ChatSessionsApi (add/remove/attachments), createRoot idiom mirrors the other chat
// view tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatAttachments } from "./ChatAttachments";
import type { ChatSessionsApi } from "./useChatSessions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
function render(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function api(over: Partial<ChatSessionsApi> = {}): ChatSessionsApi {
  return {
    list: [],
    activeId: null,
    startNew: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    ...over
  };
}

const SOURCES = [
  { id: "src_a", title: "Alpha" },
  { id: "src_b", title: "Beta" }
];

describe("ChatAttachments", () => {
  it("renders a chip per attachment, using the source's title", () => {
    render(<ChatAttachments api={api({ attachments: [{ sourceId: "src_a", includeNotes: true }] })} sources={SOURCES} />);
    const chip = container!.querySelector('.chat-attachment-chip[data-source-id="src_a"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("Alpha");
  });

  it("remove chip → removeAttachment(sourceId)", () => {
    const removeAttachment = vi.fn();
    render(
      <ChatAttachments
        api={api({ attachments: [{ sourceId: "src_a", includeNotes: true }], removeAttachment })}
        sources={SOURCES}
      />
    );
    const btn = container!.querySelector<HTMLButtonElement>(".chat-attachment-chip .chat-attachment-remove")!;
    act(() => btn.click());
    expect(removeAttachment).toHaveBeenCalledWith("src_a");
  });

  it("the + picker lists only NOT-yet-attached sources; picking one → addAttachment", () => {
    const addAttachment = vi.fn();
    render(
      <ChatAttachments
        api={api({ attachments: [{ sourceId: "src_a", includeNotes: true }], addAttachment })}
        sources={SOURCES}
      />
    );
    // Open the "+" menu.
    const trigger = container!.querySelector<HTMLButtonElement>(".chat-attachment-add")!;
    act(() => trigger.click());
    // The popover portals to document.body — Alpha (attached) is absent, Beta is offered.
    const picks = Array.from(document.querySelectorAll<HTMLButtonElement>(".chat-attachment-pick"));
    expect(picks.map((btn) => btn.getAttribute("data-source-id"))).toEqual(["src_b"]);
    act(() => picks[0].click());
    expect(addAttachment).toHaveBeenCalledWith("src_b");
  });
});
