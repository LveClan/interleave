import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// @ts-expect-error Executable JavaScript build script exposes its target validation for tests.
import { packagingArgs } from "../../scripts/dist.mjs";

describe("desktop packaging targets", () => {
  it("packages native Windows x64 without publishing", () => {
    expect(packagingArgs("win32", "x64", ["--win"])).toEqual([
      "--win",
      "--x64",
      "--publish",
      "never",
    ]);
  });

  it("preserves the native macOS arm64 target", () => {
    expect(packagingArgs("darwin", "arm64")).toEqual(["--mac", "--arm64", "--publish", "never"]);
  });

  it("rejects Linux and cross-OS packaging before staging host native binaries", () => {
    expect(() => packagingArgs("linux", "x64")).toThrow(/native SQLite\/ONNX/);
    expect(() => packagingArgs("linux", "x64", ["--win"])).toThrow(/native SQLite\/ONNX/);
    expect(() => packagingArgs("win32", "x64", ["--mac"])).toThrow(/native SQLite\/ONNX/);
  });

  it("rejects architectures that would disagree with the packaged native binary", () => {
    expect(() => packagingArgs("win32", "arm64")).toThrow(/architectures/);
    expect(() => packagingArgs("darwin", "x64")).toThrow(/architectures/);
  });

  it("rejects unrecognized or conflicting flags", () => {
    expect(() => packagingArgs("win32", "x64", ["--publish"])).toThrow(/Usage/);
    expect(() => packagingArgs("win32", "x64", ["--mac", "--win"])).toThrow(/Usage/);
  });
});

function loadPackagingConfig(platform: string, env: Record<string, string> = {}) {
  const source = readFileSync(
    new URL("../../electron-builder.config.cjs", import.meta.url),
    "utf8",
  );
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(source, { module, process: { platform, env } });
  return module.exports;
}

describe("platform-specific signing", () => {
  it("preserves the macOS arm64 DMG and ad-hoc signing configuration", () => {
    const config = loadPackagingConfig("darwin");
    expect(config.mac).toMatchObject({
      target: [{ target: "dmg", arch: ["arm64"] }],
      identity: null,
      hardenedRuntime: false,
      notarize: false,
    });
    expect(config.afterPack).toBe("scripts/adhoc-sign.cjs");
  });

  it("retains the macOS release credential guard and hardened signing", () => {
    expect(() => loadPackagingConfig("darwin", { INTERLEAVE_RELEASE_SIGN: "1" })).toThrow(
      /missing: APPLE_ID/,
    );
    const config = loadPackagingConfig("darwin", {
      INTERLEAVE_RELEASE_SIGN: "1",
      APPLE_ID: "test@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "test-only",
      APPLE_TEAM_ID: "TESTTEAM",
      INTERLEAVE_SIGNING_IDENTITY: "Developer ID Application: Test Identity (TESTTEAM)",
    });
    expect(config.mac).toMatchObject({
      identity: "Test Identity (TESTTEAM)",
      hardenedRuntime: true,
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.plist",
    });
  });

  it("does not require Apple credentials when packaging Windows", () => {
    const config = loadPackagingConfig("win32", { INTERLEAVE_RELEASE_SIGN: "1" });
    expect(config.win).toMatchObject({
      target: [
        { target: "nsis", arch: ["x64"] },
        { target: "zip", arch: ["x64"] },
      ],
    });
  });
});
