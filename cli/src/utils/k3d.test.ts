import { describe, expect, test } from "bun:test";
import { k3dInstallHint } from "./k3d";

describe("k3dInstallHint", () => {
  test("windows uses winget/choco/scoop", () => {
    const hint = k3dInstallHint("win32");
    expect(hint).toContain("winget install");
    expect(hint).toContain("choco install k3d");
    expect(hint).not.toContain("brew install k3d");
  });

  test("mac uses brew", () => {
    expect(k3dInstallHint("darwin")).toBe("brew install k3d");
  });

  test("linux uses the k3d install script", () => {
    expect(k3dInstallHint("linux")).toContain("install.sh");
  });
});
