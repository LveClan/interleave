import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Processes } from "./processes.mjs";
import {
  commandEnv,
  inspect,
  manifest,
  onPath,
  pnpmVersion,
  repoRoot,
  sameExecutable,
  selectNode,
  selectPnpm,
  toolsDir,
} from "./toolchain.mjs";

const desktopDir = path.join(repoRoot, "apps/desktop");
const desktopRequire = createRequire(path.join(desktopDir, "package.json"));
const processes = new Processes();
const [command = "help", ...args] = process.argv.slice(2);
const stateDir = path.join(repoRoot, ".interleave");
const stateFile = path.join(stateDir, "prepared.json");
const nativeCheck = path.join(desktopDir, "scripts/check-native.cjs");

function help() {
  console.log(`Native desktop commands (repository root):
  node scripts/desktop.mjs doctor       Read-only environment + native ABI checks
  node scripts/desktop.mjs setup        Prepare pinned pnpm and native dependencies
  node scripts/desktop.mjs build        Build renderer, main, preload and workers
  node scripts/desktop.mjs dev          Build main + start Vite and Electron
  node scripts/desktop.mjs start        Run existing local build (no build/tests)
  node scripts/desktop.mjs start --smoke Isolated startup check; closes automatically
  node scripts/desktop.mjs dev --smoke   Same check with the Vite development server
  node scripts/desktop.mjs package       Existing target-OS packaging; never publish
  node scripts/desktop.mjs pnpm <args>   Run pinned pnpm with the selected Node
Equivalent pnpm scripts (use pnpm run): doctor, setup, build:desktop, dev, start, smoke:desktop,
package:desktop. Make is optional. See docs/windows-development.md.
Node ${manifest.engines.node}; pnpm ${pnpmVersion} (${manifest.engines.pnpm}).`);
}

function fingerprint() {
  const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(repoRoot, parent), { withFileTypes: true })) {
      const file = `${parent}/${entry.name}/package.json`;
      if (entry.isDirectory() && existsSync(path.join(repoRoot, file))) files.push(file);
    }
  }
  const hash = createHash("sha256");
  for (const file of files.sort())
    hash
      .update(file)
      .update(readFileSync(path.join(repoRoot, file), "utf8").replace(/\r\n/g, "\n"));
  return {
    platform: process.platform,
    arch: process.arch,
    abi: process.versions.modules,
    pnpm: pnpmVersion,
    inputs: hash.digest("hex"),
  };
}

function nativeStatus() {
  const node = inspect(process.execPath, [nativeCheck]);
  let electron = { ok: false, output: "Electron not installed. Run setup." };
  try {
    const executable = desktopRequire("electron");
    electron = inspect(executable, [nativeCheck, "--electron"], {
      env: commandEnv({ ELECTRON_RUN_AS_NODE: "1" }),
    });
  } catch (error) {
    electron.output = error.message;
  }
  return { node, electron };
}

function dependencyStatus() {
  try {
    const viteCli = path.join(
      path.dirname(desktopRequire.resolve("vite/package.json")),
      "bin/vite.js",
    );
    const vite = inspect(process.execPath, [viteCli, "--version"]);
    if (!vite.ok) return vite;
    const esbuild = inspect(
      process.execPath,
      [
        "-e",
        "const e=require('esbuild'); e.transformSync('let n = 1'); console.log('esbuild '+e.version)",
      ],
      { cwd: desktopDir },
    );
    return {
      ok: esbuild.ok,
      output: `${vite.output}; ${esbuild.output}; Electron ${desktopRequire("electron/package.json").version}: ${desktopRequire("electron")}`,
    };
  } catch (error) {
    return { ok: false, output: error.message };
  }
}

function requirePrepared() {
  if (
    !existsSync(stateFile) ||
    JSON.stringify(JSON.parse(readFileSync(stateFile, "utf8"))) !== JSON.stringify(fingerprint())
  ) {
    throw new Error(
      "Dependencies are missing or inputs/runtime changed. Run node scripts/desktop.mjs setup.",
    );
  }
  const status = nativeStatus();
  const dependencies = dependencyStatus();
  if (!dependencies.ok)
    throw new Error(`Build dependencies failed: ${dependencies.output}. Run setup.`);
  for (const [runtime, result] of Object.entries(status)) {
    if (!result.ok)
      throw new Error(
        `${runtime} SQLite check failed: ${result.output}\nRun setup; do not rebuild the shared package for Electron.`,
      );
  }
}

async function doctor() {
  let failures = 0;
  const report = (name, result, required = true) => {
    console.log(`[${result.ok ? "OK" : required ? "FAIL" : "OPTIONAL"}] ${name}: ${result.output}`);
    if (!result.ok && required) failures++;
  };
  console.log(
    `OS: ${os.type()} ${os.release()} ${process.platform}/${process.arch}; shell: ${process.env.PSModulePath ? "PowerShell environment" : (process.env.SHELL ?? process.env.ComSpec ?? "unknown")}`,
  );
  console.log(
    `Node: ${process.version}, ABI ${process.versions.modules}, ${process.execPath}; required ${manifest.engines.node}`,
  );
  if (process.platform === "win32") {
    report(
      "Windows / shell",
      inspect("powershell.exe", [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture | Format-List | Out-String).Trim(); $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID); for($i=0;$i -lt 8 -and $p.ParentProcessId;$i++){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId); if($p.Name -match '^(powershell|pwsh|cmd)\\.exe$'){ 'Calling shell: '+$p.Name+' ('+$p.ExecutablePath+')'; break } }; 'Probe PowerShell: '+$PSVersionTable.PSVersion.ToString()",
      ]),
      false,
    );
  }
  for (const [name, required] of [
    ["git", true],
    ["make", false],
    ["python", false],
  ]) {
    const executable = onPath(name).find((entry) => !/\.(cmd|bat)$/i.test(entry));
    const result = executable ? inspect(executable) : { ok: false, output: "not on PATH" };
    report(`${name}${executable ? ` (${executable})` : ""}`, result, required);
  }
  report("Git checkout", inspect("git", ["status", "--short", "--branch"]), false);
  const cli = selectPnpm();
  report(`pnpm ${pnpmVersion}`, {
    ok: !!cli,
    output: cli ?? "Run node scripts/desktop.mjs setup (project-local install).",
  });
  report("Dependency receipt", {
    ok:
      existsSync(stateFile) &&
      JSON.stringify(JSON.parse(readFileSync(stateFile, "utf8"))) === JSON.stringify(fingerprint()),
    output: existsSync(stateFile) ? stateFile : "not prepared; run setup",
  });
  report("Build dependencies", dependencyStatus());
  for (const [runtime, result] of Object.entries(nativeStatus()))
    report(`${runtime} SQLite`, result);
  console.log(
    "Development: native Node, pinned pnpm, installed Electron and both SQLite ABIs. make is optional.",
  );
  console.log(
    "Packaging only: electron-builder, model download/cache and target-OS packaging assets; signing credentials are optional.",
  );
  console.log(
    "Source-build fallback only: Python + MSVC Desktop C++ workload/Windows SDK (Windows), or the host C++ toolchain. Prebuilt SQLite needs neither.",
  );
  if (process.platform === "win32") {
    const vswhere = path.join(
      process.env["ProgramFiles(x86)"] ?? "",
      "Microsoft Visual Studio/Installer/vswhere.exe",
    );
    const result = existsSync(vswhere)
      ? inspect(vswhere, [
          "-latest",
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-property",
          "installationPath",
        ])
      : { ok: false, output: "vswhere not found" };
    report(
      "MSVC (fallback only)",
      { ok: result.ok && !!result.output, output: result.output || "C++ workload not found" },
      false,
    );
  }
  process.exitCode = failures ? 1 : 0;
}

async function setup() {
  let cli = selectPnpm();
  if (!cli) {
    const npm = [
      path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
      path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ].find(existsSync);
    if (!npm)
      throw new Error(
        "Selected Node has no npm CLI. Use an official Node distribution, or provide INTERLEAVE_PNPM_CLI pointing to pnpm's JS entry.",
      );
    console.log(`[setup] Installing pnpm ${pnpmVersion} locally in ${toolsDir}`);
    await processes.run(
      process.execPath,
      [
        npm,
        "install",
        "--prefix",
        toolsDir,
        "--no-save",
        "--no-package-lock",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `pnpm@${pnpmVersion}`,
      ],
      { cwd: repoRoot, env: commandEnv() },
    );
    cli = selectPnpm();
    if (!cli) throw new Error("Local pnpm installation did not produce the pinned CLI.");
  }
  const expected = fingerprint();
  const ownerFile = path.join(stateDir, "dependencies-platform.json");
  const owner = existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, "utf8")) : undefined;
  const hasModules = existsSync(path.join(repoRoot, "node_modules"));
  if (hasModules && owner && (owner.platform !== process.platform || owner.arch !== process.arch)) {
    throw new Error(
      `Dependencies belong to ${owner.platform}/${owner.arch}. Use a separate native checkout; setup will not overwrite them.`,
    );
  }
  if (hasModules && !owner && !inspect(process.execPath, [nativeCheck]).ok) {
    throw new Error(
      "Unmanaged node_modules has no working native Node SQLite. Use a clean native checkout or move that dependency directory aside before setup; WSL dependencies cannot be reused.",
    );
  }
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    ownerFile,
    `${JSON.stringify({ platform: process.platform, arch: process.arch })}\n`,
  );
  const previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined;
  const env = commandEnv({
    INTERLEAVE_SKIP_ELECTRON_REBUILD: "0",
    npm_config_runtime: "node",
    npm_config_target: process.versions.node,
    npm_config_arch: process.arch,
  });
  if (
    !hasModules ||
    JSON.stringify(previous) !== JSON.stringify(expected) ||
    !dependencyStatus().ok
  ) {
    await processes.run(process.execPath, [cli, "install", "--frozen-lockfile"], {
      cwd: repoRoot,
      env,
    });
  } else console.log("[setup] Dependency inputs unchanged; skipping pnpm install.");
  if (!inspect(process.execPath, [nativeCheck]).ok) {
    await processes.run(process.execPath, [cli, "rebuild", "better-sqlite3"], {
      cwd: repoRoot,
      env,
    });
  }
  await processes.run(process.execPath, [path.join(desktopDir, "scripts/vendor-native.mjs")], {
    cwd: desktopDir,
    env: commandEnv({ INTERLEAVE_SKIP_ELECTRON_REBUILD: "0" }),
  });
  for (const [runtime, result] of Object.entries(nativeStatus())) {
    console.log(`[setup] ${runtime} SQLite: ${result.output}`);
    if (!result.ok)
      throw new Error(
        `${runtime} native module failed. See docs/windows-development.md; do not run Electron rebuild against shared node_modules.`,
      );
  }
  await processes.run(process.execPath, [path.join(desktopDir, "scripts/vendor-sqlite-vec.mjs")], {
    cwd: desktopDir,
    env: commandEnv(),
  });
  writeFileSync(stateFile, JSON.stringify(expected));
  console.log("[setup] Ready. No system PATH or configuration was changed.");
}

async function main() {
  if (command === "help" || command === "--help") return help();
  if (!["doctor", "setup", "build", "dev", "start", "package", "pnpm"].includes(command))
    throw new Error(`Unknown command: ${command}. Run help.`);
  if (!["dev", "start", "pnpm", "package"].includes(command) && args.length)
    throw new Error(`${command} accepts no arguments.`);
  const selected = selectNode();
  if (!sameExecutable(selected.executable, process.execPath)) {
    console.log(`[toolchain] ${process.version} -> ${selected.version}: ${selected.executable}`);
    await processes.run(
      selected.executable,
      [path.join(repoRoot, "scripts/desktop.mjs"), command, ...args],
      { cwd: repoRoot },
    );
    return;
  }
  if (command === "doctor") return doctor();
  if (command === "setup") return setup();
  const cli = selectPnpm();
  if (!cli) throw new Error("Pinned pnpm is missing. Run node scripts/desktop.mjs setup.");
  const env = commandEnv({ npm_execpath: cli });
  if (command === "pnpm")
    return processes.run(process.execPath, [cli, ...args], { cwd: repoRoot, env });
  requirePrepared();
  if (command === "build") {
    await processes.run(process.execPath, [cli, "--filter", "@interleave/web", "build"], {
      cwd: repoRoot,
      env,
    });
    await processes.run(process.execPath, [path.join(desktopDir, "build.mjs")], {
      cwd: desktopDir,
      env,
    });
  } else if (command === "package") {
    await processes.run(process.execPath, [path.join(desktopDir, "scripts/dist.mjs"), ...args], {
      cwd: desktopDir,
      env,
    });
  } else {
    await processes.run(
      process.execPath,
      [
        path.join(desktopDir, "scripts/dev.mjs"),
        ...(command === "start" ? ["--built"] : []),
        ...args,
      ],
      { cwd: desktopDir, env },
    );
  }
}

processes.handleSignals();
main()
  .catch((error) => {
    console.error(`[desktop] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => processes.close());
