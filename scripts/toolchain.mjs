import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
export const toolsDir = path.join(repoRoot, ".interleave", "toolchain");
export const pnpmVersion = manifest.packageManager.match(/^pnpm@([\d.]+)(?:\+.*)?$/)?.[1];
if (!pnpmVersion) throw new Error("packageManager must pin a pnpm version.");
if (!satisfies(pnpmVersion, manifest.engines.pnpm)) {
  throw new Error("packageManager pnpm version does not satisfy engines.pnpm.");
}

export function sameExecutable(left, right) {
  const a = realpathSync(left);
  const b = realpathSync(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Bootstrap runs before dependencies exist. Fail closed if engines adopts other syntax.
export function satisfies(version, range) {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  return range.split(/\s+/).every((term) => {
    const match = /^(>=|<)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(term);
    if (!match) throw new Error(`Unsupported bootstrap engine range: ${range}`);
    const expected = match.slice(2).map((value) => Number(value ?? 0));
    const index = parts.findIndex((part, i) => part !== expected[i]);
    const comparison = index < 0 ? 0 : parts[index] - expected[index];
    return match[1] === ">=" ? comparison >= 0 : comparison < 0;
  });
}

export function inspect(command, args = ["--version"], options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    ...options,
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`.trim(),
  };
}

export function onPath(name) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .flatMap((dir) => extensions.map((ext) => path.join(dir.replace(/^"|"$/g, ""), name + ext)))
    .filter((candidate) => existsSync(candidate));
}

function versionedNodes(root) {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => /^v?\d+\./.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    .map((entry) =>
      path.join(root, entry.name, process.platform === "win32" ? "node.exe" : "bin/node"),
    );
}

export function selectNode() {
  const configFile = path.join(repoRoot, ".interleave", "toolchain.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  const override = process.env.INTERLEAVE_NODE ?? config.node;
  const candidates = override
    ? [path.resolve(repoRoot, override)]
    : [
        process.execPath,
        ...onPath("node"),
        ...versionedNodes(process.env.NVM_HOME),
        ...versionedNodes(process.env.NVM_HOME && path.join(process.env.NVM_HOME, "nodejs")),
        ...versionedNodes(
          path.join(process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm"), "versions/node"),
        ),
      ];
  const checked = [];
  for (const executable of new Set(candidates)) {
    if (!existsSync(executable)) continue;
    const result = inspect(executable);
    checked.push(`${executable}: ${result.output}`);
    if (
      result.ok &&
      /^v\d+\.\d+\.\d+$/.test(result.output) &&
      satisfies(result.output, manifest.engines.node)
    ) {
      return { executable, version: result.output, checked };
    }
  }
  throw new Error(
    `Node ${manifest.engines.node} required. Checked:\n${checked.join("\n")}\n` +
      'Install a compatible native Node, or set {"node":"absolute/path/to/node"} in .interleave/toolchain.json. No system settings were changed.',
  );
}

export function selectPnpm() {
  const candidates = process.env.INTERLEAVE_PNPM_CLI
    ? [process.env.INTERLEAVE_PNPM_CLI]
    : [
        path.join(toolsDir, "node_modules", "pnpm", "bin", "pnpm.cjs"),
        process.env.npm_execpath,
        ...onPath("pnpm").flatMap((entry) => [
          entry.endsWith(".cjs") ? entry : undefined,
          path.join(path.dirname(entry), "node_modules/pnpm/bin/pnpm.cjs"),
          path.resolve(path.dirname(entry), "../lib/node_modules/pnpm/bin/pnpm.cjs"),
        ]),
      ];
  for (const cli of new Set(candidates.filter(Boolean))) {
    if (!existsSync(cli) || !/\.(c?js|mjs)$/.test(cli)) continue;
    // Corepack shims may download on --version; doctor must remain read-only.
    const packageFile = path.resolve(path.dirname(cli), "../package.json");
    if (!existsSync(packageFile)) continue;
    const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
    if (pkg.name !== "pnpm" || pkg.version !== pnpmVersion) continue;
    const result = inspect(process.execPath, [cli, "--version"]);
    if (result.ok && result.output === pnpmVersion) return cli;
  }
  if (process.env.INTERLEAVE_PNPM_CLI) {
    throw new Error(
      `INTERLEAVE_PNPM_CLI must point to pnpm ${pnpmVersion}'s working JavaScript entry: ${process.env.INTERLEAVE_PNPM_CLI}`,
    );
  }
  return undefined;
}

export function commandEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // Windows treats Path and PATH as the same key; Node passes only the first one.
  const oldPath = Object.keys(env).find((key) => key.toLowerCase() === "path");
  const value = oldPath ? env[oldPath] : "";
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  env.PATH = [
    path.dirname(process.execPath),
    path.join(toolsDir, "node_modules", ".bin"),
    path.join(repoRoot, "node_modules", ".bin"),
    value,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  return env;
}
