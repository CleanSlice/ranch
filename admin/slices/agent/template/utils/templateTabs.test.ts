import { describe, expect, test } from "bun:test";
import { TEMPLATE_TAB_IDS, templateTabFromQuery } from "./templateTabs";

describe("templateTabFromQuery", () => {
  test("every tab of the page is reachable from the query, Tools included", () => {
    for (const id of TEMPLATE_TAB_IDS)
      expect(templateTabFromQuery(id)).toBe(id);
    expect(templateTabFromQuery("tools")).toBe("tools");
  });

  test("nothing, an unknown name or a non-string falls back to Overview", () => {
    expect(templateTabFromQuery(undefined)).toBe("overview");
    expect(templateTabFromQuery("")).toBe("overview");
    expect(templateTabFromQuery("settings")).toBe("overview");
    expect(templateTabFromQuery(["tools"])).toBe("overview");
  });
});
