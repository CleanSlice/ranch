import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { hasBinary } from "./bin";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withFakeBin(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ranch-bin-"));
  created.push(dir);
  const filename = process.platform === "win32" ? `${name}.cmd` : name;
  const file = join(dir, filename);
  writeFileSync(file, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
  if (process.platform !== "win32") chmodSync(file, 0o755);
  const prev = process.env.PATH ?? "";
  process.env.PATH = `${dir}${process.platform === "win32" ? ";" : ":"}${prev}`;
  return prev;
}

describe("hasBinary", () => {
  test("finds a platform helper that is already on PATH", () => {
    expect(hasBinary(process.platform === "win32" ? "where" : "sh")).toBe(true);
  });

  test("finds a binary we drop onto PATH", () => {
    const prev = withFakeBin("ranch-fake-bin");
    try {
      expect(hasBinary("ranch-fake-bin")).toBe(true);
    } finally {
      process.env.PATH = prev;
    }
  });

  test("returns false when the binary is not on PATH", () => {
    expect(hasBinary("ranch-missing-binary-CLEAN-41")).toBe(false);
  });
});
