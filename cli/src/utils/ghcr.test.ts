import { describe, expect, test } from "bun:test";
import { parseDotEnv, pickGithubToken, pickGithubUser } from "./ghcr";

describe("parseDotEnv", () => {
  test("reads KEY=value, skips comments, strips quotes", () => {
    const env = parseDotEnv(
      [
        "# comment",
        "GITHUB_TOKEN=abc",
        "GH_USER=\"someone\"",
        "EMPTY=",
        "  SPACED = 'quoted'  ",
      ].join("\n"),
    );
    expect(env.GITHUB_TOKEN).toBe("abc");
    expect(env.GH_USER).toBe("someone");
    expect(env.EMPTY).toBe("");
    expect(env.SPACED).toBe("quoted");
  });
});

describe("pickGithubToken", () => {
  test("prefers GITHUB_TOKEN over GH_TOKEN", () => {
    expect(pickGithubToken({ GITHUB_TOKEN: "a", GH_TOKEN: "b" })).toBe("a");
    expect(pickGithubToken({ GH_TOKEN: " b " })).toBe("b");
    expect(pickGithubToken({ GHCR_PAT: "c" })).toBe("c");
    expect(pickGithubToken({})).toBeUndefined();
  });
});

describe("pickGithubUser", () => {
  test("reads GITHUB_USER / GH_USER", () => {
    expect(pickGithubUser({ GITHUB_USER: "me" })).toBe("me");
    expect(pickGithubUser({ GH_USER: "you" })).toBe("you");
    expect(pickGithubUser({})).toBeUndefined();
  });
});
