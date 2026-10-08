import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, repoRoot, runtimePackages } from "./build-info.mjs";
import { writeArtifactManifest } from "./manifest.mjs";
import { installWindowsPackage } from "./windows-install.mjs";

const revision = Number(process.argv[2]);
const output = path.resolve(process.argv[3] ?? path.join(repoRoot, ".local-build"));
const target = process.platform === "darwin" ? "macos-arm64" : "windows-x64";
if (
  !(
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "win32" && process.arch === "x64")
  )
) {
  throw new Error("Use a native macOS arm64 or Windows x64 runner");
}
if (process.env.GITHUB_ACTIONS !== "true")
  throw new Error("Personal native desktop builds run on GitHub hosted runners");
const info = createBuildInfo(revision);
info.signature = process.platform === "darwin" ? "ad-hoc; not notarized" : "unsigned";
const scratch = await mkdtemp(path.join(os.tmpdir(), "paseo-personal-desktop-"));
const desktop = path.join(repoRoot, "packages/desktop");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
  PASEO_DESKTOP_SMOKE: "0",
  PASEO_WEB_PLATFORM: "electron",
};
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: command === "npm.cmd",
    ...options,
  });
const requireDesktop = createRequire(path.join(desktop, "package.json"));
const { build, Platform, Arch } = requireDesktop("electron-builder");
const { smokePackagedDesktopApp } = requireDesktop("./e2e/packaged-app-smoke.js");
const config = requireDesktop("./electron-builder.personal.cjs");
const originals = new Map();
function stampedManifest(original, version) {
  const manifest = JSON.parse(original);
  manifest.version = version;
  const names = new Set(runtimePackages.map((name) => `@getpaseo/${name}`));
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[section])
      manifest[section] = Object.fromEntries(
        Object.entries(manifest[section]).map(([name, range]) => [
          name,
          names.has(name) ? version : range,
        ]),
      );
  }
  return manifest;
}
let builtFiles;
try {
  const artifactName =
    process.platform === "darwin"
      ? `Paseo-${info.version}-macos-arm64.tar.gz`
      : `Paseo-Setup-${info.version}-windows-x64.exe`;
  try {
    await access(path.join(output, artifactName));
    throw new Error("Refusing to overwrite desktop installer");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  run(npm, ["run", "build:server:clean"]);
  run(npm, ["run", "build:app-deps:clean"]);
  run(npm, ["run", "build:web", "--workspace=@getpaseo/app"]);
  run(npm, ["run", "build:main", "--workspace=@getpaseo/desktop"]);
  for (const key of [...runtimePackages, "desktop"]) {
    const file = path.join(repoRoot, `packages/${key}/package.json`);
    const original = await readFile(file, "utf8");
    originals.set(file, original);
    const manifest = stampedManifest(original, info.version);
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  }
  const configWithMetadata = {
    ...config,
    extraMetadata: { version: info.version, paseoPersonalBuild: info },
    directories: { output: path.join(scratch, "release") },
    buildVersion: `${info.upstreamVersion}.${info.revision}`,
    artifactName,
    win: { artifactName },
  };
  const targets =
    process.platform === "darwin"
      ? Platform.MAC.createTarget(["dir"], Arch.arm64)
      : Platform.WINDOWS.createTarget(["nsis"], Arch.x64);
  builtFiles = await build({
    projectDir: desktop,
    targets,
    publish: "never",
    config: configWithMetadata,
  });
  await mkdir(output, { recursive: true });
  const final = path.join(output, artifactName);
  let validation;
  if (process.platform === "darwin") {
    const app = path.join(scratch, "release/mac-arm64/Paseo.app");
    run("codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--preserve-metadata=entitlements,flags,runtime",
      app,
    ]);
    run("codesign", ["--verify", "--deep", "--strict", app]);
    const archive = path.join(scratch, artifactName);
    run("tar", ["-czf", archive, "-C", path.dirname(app), "Paseo.app"]);
    const extracted = path.join(scratch, "extracted");
    await mkdir(extracted);
    run("tar", ["-xzf", archive, "-C", extracted]);
    const extractedApp = path.join(extracted, "Paseo.app");
    run("codesign", ["--verify", "--deep", "--strict", extractedApp]);
    await smokePackagedDesktopApp({ appPath: extractedApp });
    await copyFile(archive, final);
    info.signature = "ad-hoc; not notarized";
    validation = {
      finalArchiveExtracted: true,
      codesignVerified: true,
      rendererBridgeDaemonTerminal: "passed",
    };
  } else {
    const installer = builtFiles.find((file) => file.endsWith(".exe"));
    if (!installer) throw new Error("NSIS installer missing");
    const installed = path.join(scratch, "installed");
    installWindowsPackage(installer, installed, env);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (
        await access(path.join(installed, "Paseo.exe")).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await smokePackagedDesktopApp({ appPath: installed });
    await copyFile(installer, final);
    validation = { finalInstallerInstalled: true, rendererBridgeDaemonTerminal: "passed" };
  }
  await writeArtifactManifest(output, target, info, [final], validation);
} finally {
  for (const [file, original] of originals) await writeFile(file, original);
  await rm(scratch, { recursive: true, force: true });
}
