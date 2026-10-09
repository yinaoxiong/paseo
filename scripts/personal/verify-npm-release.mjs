import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import {
  validateNpmApproval,
  verifyNpmFiles,
  assertRegistryVersion,
  npmPublicationInputs,
} from "./npm-publication.mjs";
import { assertTrustedPersonalSource } from "./trusted-source.mjs";

const approved = validateNpmApproval(
  JSON.parse(await readFile(new URL("./npm-release-approved.json", import.meta.url))),
);
const source = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)));
const inputs = npmPublicationInputs(approved, source.version);
if (
  process.env.GITHUB_REPOSITORY !== approved.repository ||
  process.env.GITHUB_REF !== "refs/heads/personal/stable" ||
  process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
  process.env.PASEO_NPM_CONFIRMATION !== inputs.confirmation
)
  throw new Error("Unapproved publication context");
if (process.argv[2] === "--inputs") {
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow output file");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${inputs.version}\nbuild_run_id=${inputs.buildRunId}\n`,
  );
  process.exit(0);
}
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
assertTrustedPersonalSource(approved.payloadSource);
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
