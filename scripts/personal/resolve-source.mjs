import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { repoRoot, personalVersion } from "./build-info.mjs";
import { assertTrustedPersonalSource, resolvePersonalBuildBranch } from "./trusted-source.mjs";

const sha = process.env.PASEO_SOURCE_SHA || process.env.GITHUB_SHA;
const revision = Number(process.env.PASEO_PERSONAL_REVISION);
const marker = process.env.PASEO_BUILD_MARKER;
if (
  process.env.GITHUB_REPOSITORY !== "yinaoxiong/paseo" ||
  !/^[0-9a-f]{40}$/.test(sha ?? "") ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(marker ?? "")
)
  throw new Error("Invalid repository, source SHA or unique marker");
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const branch = resolvePersonalBuildBranch({
  ref: process.env.GITHUB_REF,
  eventName: process.env.GITHUB_EVENT_NAME,
  buildScope: process.env.PASEO_BUILD_SCOPE,
  sourceSha: sha,
  workflowSha: process.env.GITHUB_SHA,
});
const remoteRef = `refs/remotes/origin/${branch}`;
git("fetch", "--no-tags", "origin", `${branch}:${remoteRef}`);
git("merge-base", "--is-ancestor", sha, remoteRef);
if (branch === "integration/android-latex" && git("rev-parse", remoteRef) !== sha) {
  throw new Error("Candidate branch changed since dispatch; refusing stale signing source");
}
assertTrustedPersonalSource(sha);
const sourcePackage = JSON.parse(git("show", `${sha}:package.json`));
personalVersion(sourcePackage.version, revision);
appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nrevision=${revision}\nmarker=${marker}\n`);
