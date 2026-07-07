import { describe, expect, it } from "vitest";
import { FlaskConical, Sigma } from "lucide-react";
import type { ToolbarAction } from "./WorkspaceContext";
import { actionIcon, namedActionIcon } from "./actionIcons";

describe("actionIcon", () => {
  it("resolves subject/toolkit icon names instead of falling back to the generic wand", () => {
    expect(namedActionIcon("sigma")).toBe(Sigma);
    expect(namedActionIcon("flask-conical")).toBe(FlaskConical);
  });

  it("uses the named icon carried by a built-in toolbar action", () => {
    const action: ToolbarAction = {
      id: "subject.generate-formula",
      title: "Generate formula",
      icon: "sigma",
      kind: "builtin",
      scope: "anchor"
    };

    expect(actionIcon(action)).toBe(Sigma);
  });
});
