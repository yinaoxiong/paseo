import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCliTool } from "./cli-platform.mjs";
import nativeVersions from "../../packages/app/native-release-version.js";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const runtimePackages = [
  "highlight",
  "relay",
  "protocol",
  "client",
  "plugin",
  "server",
  "cli",
];

export function personalVersion(upstreamVersion, revision) {
  const native = nativeVersions.getPersonalNativeReleaseVersion(upstreamVersion, revision);
  return {
    upstreamVersion,
    revision,
    version: `${upstreamVersion}+personal.${revision}`,
    ...native,
  };
}

export function createBuildInfo(revision, { allowDirty = false } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const dirtyPaths = git("status", "--porcelain", "--untracked-files=all");
  if (!allowDirty && dirtyPaths) {
    throw new Error(
      `Commit build inputs before creating release metadata. Changed paths:\n${dirtyPaths}`,
    );
  }
  const root = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const lock = readFileSync(path.join(repoRoot, "package-lock.json"));
  return {
    schemaVersion: 1,
    ...personalVersion(root.version, revision),
    sourceSha: git("rev-parse", "HEAD"),
    lockSha256: createHash("sha256").update(lock).digest("hex"),
    nodeVersion: process.version,
    npmVersion: runCliTool("npm", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform,
    arch: process.arch,
    signature: "unsigned",
    ...(process.env.GITHUB_ACTIONS === "true"
      ? {
          githubRunId: process.env.GITHUB_RUN_ID,
          githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
          marker: process.env.PASEO_BUILD_MARKER,
        }
      : {}),
  };
}

export function loadBuildInfo(file) {
  const info = JSON.parse(readFileSync(file, "utf8"));
  const expected = createBuildInfo(info.revision);
  for (const key of [
    "schemaVersion",
    "version",
    "sourceSha",
    "lockSha256",
    "nodeVersion",
    "npmVersion",
    "platform",
    "arch",
    "androidVersionCode",
  ]) {
    if (info[key] !== expected[key]) throw new Error(`Build metadata mismatch: ${key}`);
  }
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [revisionText, output] = process.argv.slice(2);
  const info = createBuildInfo(Number(revisionText));
  if (!output)
    throw new Error("Usage: node scripts/personal/build-info.mjs <revision> <output.json>");
  writeFileSync(output, JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
}
