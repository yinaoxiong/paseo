import { execFileSync } from "node:child_process";
import { repoRoot } from "./build-info.mjs";

const id = process.env.PASEO_NPM_CANDIDATE_RUN_ID;
const hash = process.env.PASEO_NPM_CANDIDATE_MANIFEST_SHA256;
if (!id && !hash) process.exit(0);
if (
  !/^[1-9][0-9]*$/.test(id ?? "") ||
  !/^[a-f0-9]{64}$/.test(hash ?? "") ||
  process.env.PASEO_BUILD_SCOPE !== "online-verify" ||
  process.env.PASEO_MAC_ARCHIVE_RUN_ID
)
  throw new Error("Candidate reverification requires an exact Run/hash and online-verify only");
const api = (route) =>
  JSON.parse(execFileSync("gh", ["api", `repos/yinaoxiong/paseo/${route}`], { encoding: "utf8" }));
const run = api(`actions/runs/${id}`);
if (
  run.event !== "workflow_dispatch" ||
  run.workflow_id !== 377643758 ||
  run.head_branch !== "personal/stable" ||
  run.repository.full_name !== "yinaoxiong/paseo"
)
  throw new Error("Unapproved candidate Run identity");
const jobs = api(`actions/runs/${id}/jobs?per_page=100`).jobs;
if (
  !jobs.some(
    (job) => job.name === "cli" && job.status === "completed" && job.conclusion === "success",
  )
)
  throw new Error("Candidate build job has not succeeded");
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
git("fetch", "--no-tags", "origin", run.head_sha);
git("merge-base", "--is-ancestor", "de796a7e2e7bc941fcf194346a043e2717bd8c5a", run.head_sha);
git(
  "merge-base",
  "--is-ancestor",
  run.head_sha,
  process.env.PASEO_SOURCE_SHA || process.env.GITHUB_SHA,
);
console.log(`Reverify candidate Run ${id}, source ${run.head_sha}, manifest ${hash}`);
