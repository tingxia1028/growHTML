import { describe, expect, it } from "vitest";
import { ClaudePtyProvider } from "./claudePtyProvider";
import { FakePtySession } from "./pty/session";

const ESC = String.fromCharCode(27);

describe("ClaudePtyProvider", () => {
  it("returns the cleaned assistant answer captured from the PTY turn", async () => {
    const session = new FakePtySession((input) => [`${ESC}[32mYou said: ${input.trim()}${ESC}[0m\n`]);
    const provider = new ClaudePtyProvider({ createSession: () => session, idleMs: 10, timeoutMs: 2000 });

    const response = await provider.complete({ messages: [{ role: "user", content: "hello pty" }] });

    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toBe("You said: hello pty");

    provider.dispose();
    expect(session.killed).toBe(true);
  });

  it("reuses one persistent session across turns (no cold restart)", async () => {
    let created = 0;
    const provider = new ClaudePtyProvider({
      createSession: () => {
        created += 1;
        return new FakePtySession((input) => [`ok:${input.trim()}\n`]);
      },
      idleMs: 10,
      timeoutMs: 2000
    });

    const first = await provider.complete({ messages: [{ role: "user", content: "a" }] });
    const second = await provider.complete({ messages: [{ role: "user", content: "b" }] });

    expect(first.message.content).toBe("ok:a");
    expect(second.message.content).toBe("ok:b");
    expect(created).toBe(1);
  });
});
