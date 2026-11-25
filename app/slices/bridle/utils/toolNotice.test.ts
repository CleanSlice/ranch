import { describe, expect, test } from "bun:test";
import { toolNotice, toolSummary } from "./toolNotice";

describe("toolSummary", () => {
  test("the two words the hub sends, nothing else", () => {
    expect(toolSummary("connecting")).toBe("connecting");
    expect(toolSummary("limited")).toBe("limited");
    expect(toolSummary("ready")).toBe(null);
    expect(toolSummary(null)).toBe(null);
    expect(toolSummary(undefined)).toBe(null);
    expect(toolSummary({ phase: "limited" })).toBe(null);
  });
});

describe("toolNotice", () => {
  test("still starting, and running with less", () => {
    expect(toolNotice("connecting")).toEqual({
      kind: "connecting",
      key: "chat.tools_starting",
    });
    expect(toolNotice("limited")).toEqual({
      kind: "limited",
      key: "chat.tools_limited",
    });
  });

  test("nothing to say when all its servers answer", () => {
    expect(toolNotice(null)).toBe(null);
    expect(toolNotice(undefined)).toBe(null);
  });
});
