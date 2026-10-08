import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { validateNpmApproval, verifyNpmFiles, assertRegistryVersion } from "./npm-publication.mjs";

const approved = validateNpmApproval(
  JSON.parse(await readFile(new URL("./npm-release-approved.json", import.meta.url))),
);
if (
  process.env.GITHUB_REPOSITORY !== approved.repository ||
  process.env.GITHUB_REF !== "refs/heads/personal/stable" ||
  process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
  process.env.PASEO_NPM_CONFIRMATION !== "PUBLISH @yinaoxiong 0.11.0-personal.1"
)
  throw new Error("Unapproved publication context");
const selected = JSON.parse(process.env.PASEO_NPM_PACKAGES);
const keys = new Set(approved.packages.map((p) => p.key));
if (
  !Array.isArray(selected) ||
  !selected.length ||
  new Set(selected).size !== selected.length ||
  selected.some((key) => !keys.has(key))
)
  throw new Error("Invalid pending package selection");
await verifyNpmFiles(process.argv[2], approved);
const build = JSON.parse(
  execFileSync("gh", ["api", `repos/${approved.repository}/actions/runs/${approved.buildRunId}`], {
    encoding: "utf8",
  }),
);
if (
  build.repository.full_name !== approved.repository ||
  build.workflow_id !== approved.buildWorkflowId ||
  build.event !== "workflow_dispatch" ||
  build.head_branch !== "personal/stable" ||
  build.head_sha !== approved.payloadSource ||
  build.status !== "completed" ||
  build.conclusion !== "success"
)
  throw new Error("Original build identity or success mismatch");
const git = (...args) => execFileSync("git", args, { stdio: "pipe" });
git(
  "merge-base",
  "--is-ancestor",
  "de796a7e2e7bc941fcf194346a043e2717bd8c5a",
  approved.payloadSource,
);
git("merge-base", "--is-ancestor", approved.payloadSource, process.env.GITHUB_SHA);
for (const p of approved.packages) {
  const response = await fetch(`${approved.registry}${encodeURIComponent(p.name)}/${p.version}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (selected.includes(p.key)) {
    if (response.status !== 404)
      throw new Error(`Version exists or lookup failed for ${p.name}; reconcile before publishing`);
  } else {
    if (!response.ok) throw new Error(`Unselected package is not confirmed: ${p.name}`);
    assertRegistryVersion(await response.json(), p);
  }
}
console.log(
  "Original successful build, exact accepted files and pending registry versions verified",
);
