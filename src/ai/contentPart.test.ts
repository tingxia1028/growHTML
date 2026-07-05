// V-1 (vision-input.md §2, A5) seam — the content-part schema union, the messageText
// collapse helper, the per-provider vision capability bit, VisionUnsupportedError, and
// the mock's deterministic "Saw N image(s)." vision ack. These are the Commit 1 gates:
// the schema admits both a bare string AND a part array; a text-only message stays a
// bare string (byte-identical regression lock); messageText collapses parts to text.

import { describe, expect, it } from "vitest";
import { createEntityId } from "../core/ids";
import { contentPartSchema, messageContentSchema } from "../core/schema/contentPart";
import { messageText } from "./buildPrompt";
import { ClaudeCliProvider } from "./claudeCliProvider";
import { ClaudePtyProvider } from "./claudePtyProvider";
import { ManagedProvider } from "./managed";
import { MockAgentProvider } from "./mockAgentProvider";
import { MockModelProvider } from "./mockProvider";
import { chatMessageSchema, messageHasImage, VisionUnsupportedError } from "./provider";
import { FakePtySession } from "./pty/session";

const assetId = createEntityId("asset");

describe("contentPart wire schema (V-1)", () => {
  it("admits a bare string AND a non-empty part array", () => {
    expect(messageContentSchema.parse("hello")).toBe("hello");
    const parts = messageContentSchema.parse([
      { type: "text", text: "look:" },
      { type: "image", assetId }
    ]);
    expect(parts).toEqual([
      { type: "text", text: "look:" },
      { type: "image", assetId }
    ]);
  });

  it("rejects an empty string and an empty array (min(1) on both arms)", () => {
    expect(() => messageContentSchema.parse("")).toThrow();
    expect(() => messageContentSchema.parse([])).toThrow();
  });

  it("an image part carries a bounded assetId REF, never inline bytes", () => {
    expect(() => contentPartSchema.parse({ type: "image", assetId: "not-an-asset-id" })).toThrow();
    expect(contentPartSchema.parse({ type: "image", assetId, mimeType: "image/png" })).toEqual({
      type: "image",
      assetId,
      mimeType: "image/png"
    });
  });

  it("chatMessageSchema accepts both a string and an image-first array message", () => {
    expect(chatMessageSchema.parse({ role: "user", content: "hi" }).content).toBe("hi");
    const msg = chatMessageSchema.parse({
      role: "user",
      content: [{ type: "image", assetId }, { type: "text", text: "what is this?" }]
    });
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("REGRESSION LOCK: a text-only message is a bare string (byte-identical persist)", () => {
    const parsed = chatMessageSchema.parse({ role: "user", content: "plain text" });
    expect(typeof parsed.content).toBe("string");
    expect(JSON.stringify(parsed)).toBe(JSON.stringify({ role: "user", content: "plain text" }));
  });
});

describe("messageText collapse (V-1)", () => {
  it("passes a bare string through verbatim", () => {
    expect(messageText("verbatim")).toBe("verbatim");
  });

  it("joins text parts and renders images as a [image] placeholder", () => {
    expect(
      messageText([
        { type: "text", text: "before" },
        { type: "image", assetId },
        { type: "text", text: "after" }
      ])
    ).toBe("before\n[image]\nafter");
  });

  it("messageHasImage detects an image part (and only in an array)", () => {
    expect(messageHasImage("text")).toBe(false);
    expect(messageHasImage([{ type: "text", text: "x" }])).toBe(false);
    expect(messageHasImage([{ type: "image", assetId }])).toBe(true);
  });
});

describe("vision capability bit (V-1) — the per-provider literal", () => {
  it("mock + mock-agent declare vision:true (the offline vision proof; mock-agent delegates to the mock)", () => {
    expect(new MockModelProvider().capabilities.vision).toBe(true);
    expect(new MockAgentProvider().capabilities.vision).toBe(true);
  });

  it("cli-agent / managed declare vision:false", () => {
    expect(new ClaudeCliProvider().capabilities.vision).toBe(false);
    expect(new ClaudePtyProvider({ createSession: () => new FakePtySession(() => []) }).capabilities.vision).toBe(false);
    expect(
      new ManagedProvider({ gatewayBaseUrl: "https://gw.test", getSessionToken: () => null }).capabilities.vision
    ).toBe(false);
  });
});

describe("VisionUnsupportedError (V-1)", () => {
  it("constructs with a name + default message", () => {
    const err = new VisionUnsupportedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VisionUnsupportedError");
    expect(err.message).toMatch(/image/i);
  });
});

describe("mock vision echo (V-1)", () => {
  it("echoes 'Saw 1 image.' for an image-carrying user turn", async () => {
    const provider = new MockModelProvider();
    const res = await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", assetId }] }]
    });
    expect(res.message.content).toContain("Saw 1 image.");
    expect(res.message.content).toContain("You asked: what is this?");
  });

  it("pluralizes and counts multiple images", async () => {
    const provider = new MockModelProvider();
    const res = await provider.complete({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", assetId },
            { type: "image", assetId: createEntityId("asset") }
          ]
        }
      ]
    });
    expect(res.message.content).toContain("Saw 2 images.");
  });

  it("REGRESSION: a text-only turn carries NO 'Saw' marker (byte-identical reply)", async () => {
    const provider = new MockModelProvider();
    const withArray = await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "text only" }] }]
    });
    const withString = await provider.complete({ messages: [{ role: "user", content: "text only" }] });
    expect(withArray.message.content).not.toContain("Saw ");
    // A single text part collapses to the same reply as the bare string.
    expect(withArray.message.content).toBe(withString.message.content);
  });
});
