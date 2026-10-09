import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, repoRoot } from "./build-info.mjs";
import { assertTrustedPersonalSource } from "./trusted-source.mjs";

if (
  process.platform !== "darwin" ||
  process.arch !== "arm64" ||
  process.env.GITHUB_ACTIONS !== "true"
)
  throw new Error("Archive verification requires native GitHub macOS arm64");
const originalRun = process.env.PASEO_MAC_ARCHIVE_RUN_ID;
const expectedHash = process.env.PASEO_MAC_ARCHIVE_SHA256;
if (!/^[1-9][0-9]{0,19}$/.test(originalRun ?? "") || !/^[0-9a-f]{64}$/.test(expectedHash ?? ""))
  throw new Error(
    "Set the exact original build Run ID and independently accepted archive checksum",
  );
const info = createBuildInfo(Number(process.env.PASEO_PERSONAL_REVISION));
const directory = path.resolve(process.env.PASEO_MAC_ARCHIVE_DIR);
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest-macos-arm64.json"), "utf8"),
);
const asset = manifest.assets?.[0];
assert.equal(manifest.assets.length, 1);
assert.equal(manifest.target, "macos-arm64");
assert.equal(manifest.version, info.version);
assert.equal(manifest.githubRunId, originalRun);
assert.match(manifest.sourceSha, /^[0-9a-f]{40}$/);
assert.equal(asset.name, `Paseo-${info.version}-macos-arm64.tar.gz`);
assert.equal(asset.sha256, expectedHash);
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
assertTrustedPersonalSource(manifest.sourceSha);
git("merge-base", "--is-ancestor", manifest.sourceSha, info.sourceSha);
const run = JSON.parse(
  execFileSync("gh", ["api", `repos/yinaoxiong/paseo/actions/runs/${originalRun}`], {
    encoding: "utf8",
  }),
);
assert.equal(run.conclusion, "success");
assert.equal(run.head_sha, manifest.sourceSha);
assert.equal(run.head_branch, "personal/stable");
assert.equal(run.event, "workflow_dispatch");
assert.equal(run.workflow_id, 377643758);
const archive = path.join(directory, asset.name);
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
assert.equal(hash.digest("hex"), expectedHash);
assert.equal(
  (await readFile(`${archive}.sha256`, "utf8")).trim(),
  `${expectedHash}  ${asset.name}`,
);
const scratch = await mkdtemp(path.join(os.tmpdir(), "paseo-final-mac-proof-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", scratch], { stdio: "inherit" });
  const app = path.join(scratch, "Paseo.app");
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  const require = createRequire(path.join(repoRoot, "packages/desktop/package.json"));
  const { smokePackagedDesktopApp } = require("./e2e/packaged-app-smoke.js");
  const proof = await smokePackagedDesktopApp({ appPath: app });
  assert.equal(proof.terminalProof.exactMarkerLine, true);
  assert.equal(proof.terminalProof.commandEchoContainsMarker, false);
  assert.equal(proof.terminalProof.outputLine, proof.terminalProof.marker);
  const report = {
    schemaVersion: 1,
    version: manifest.version,
    archiveName: asset.name,
    archiveSha256: expectedHash,
    artifactSourceSha: manifest.sourceSha,
    verifierSourceSha: info.sourceSha,
    originalBuildRunId: originalRun,
    verificationRunId: process.env.GITHUB_RUN_ID,
    marker: process.env.PASEO_BUILD_MARKER,
    platform: process.platform,
    arch: process.arch,
    codesignVerified: true,
    finalArchiveExtracted: true,
    ...proof,
  };
  const output = path.resolve(process.env.PASEO_MAC_VERIFICATION_OUTPUT);
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "verification-macos-arm64.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
