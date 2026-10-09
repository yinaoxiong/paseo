import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { repoRoot, personalVersion } from "./build-info.mjs";
import { assertTrustedPersonalSource } from "./trusted-source.mjs";

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
git("fetch", "--no-tags", "origin", "personal/stable:refs/remotes/origin/personal/stable");
git("merge-base", "--is-ancestor", sha, "refs/remotes/origin/personal/stable");
assertTrustedPersonalSource(sha);
const sourcePackage = JSON.parse(git("show", `${sha}:package.json`));
personalVersion(sourcePackage.version, revision);
appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nrevision=${revision}\nmarker=${marker}\n`);
