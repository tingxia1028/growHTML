import { describe, expect, it } from "vitest";
import { extractAnswer, stripAnsi } from "./terminalParse";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("stripAnsi", () => {
  it("removes CSI color/style codes", () => {
    expect(stripAnsi(`${ESC}[32mYou said: hi${ESC}[0m`)).toBe("You said: hi");
  });

  it("removes OSC title sequences", () => {
    expect(stripAnsi(`${ESC}]0;window title${BEL}hello`)).toBe("hello");
  });

  it("removes carriage returns but keeps newlines and plain brackets", () => {
    expect(stripAnsi("line[1]\r\nline[2]")).toBe("line[1]\nline[2]");
  });
});

describe("extractAnswer", () => {
  it("strips ANSI and trims", () => {
    expect(extractAnswer(`  ${ESC}[1mAnswer${ESC}[0m  \n`)).toBe("Answer");
  });
});
