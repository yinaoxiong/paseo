import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Reviewed overlay after replaying all 18 private commits onto official v0.11.2.
// Move this pin only after auditing a new private baseline; upstream ancestry alone
// does not authorize running fork code with signing credentials.
export const trustedPersonalBase = "c3b671672521ececce77fce2d9bfe94daef944dc";
const root = fileURLToPath(new URL("../../", import.meta.url));

export function resolvePersonalBuildBranch(context, cwd = root) {
  const { ref, eventName, buildScope, sourceSha, workflowSha } = context;
  if (eventName !== "workflow_dispatch") throw new Error("Personal builds require manual dispatch");
  if (buildScope === "android-delivery-only" && sourceSha !== workflowSha)
    throw new Error("Delivery must build its exact approved workflow source");
  if (ref === "refs/heads/personal/stable") return "personal/stable";
  if (ref !== "refs/heads/integration/android-latex") throw new Error("Unapproved build branch");
  if (!["android-only", "android-qa-verify", "android-delivery-only"].includes(buildScope))
    throw new Error("Candidate branch allows Android-only builds or secret-free QA reverification");
  if (sourceSha !== workflowSha) throw new Error("Candidate must build its exact workflow commit");
  assertTrustedPersonalSource(sourceSha, cwd);
  // This candidate belongs to one reviewed prototype, not arbitrary future feature branches.
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", "2f852a5f444d2e5d1605a14b0798045a9e4a4042", sourceSha],
    { cwd, stdio: "pipe" },
  );
  return "integration/android-latex";
}

export function assertTrustedPersonalSource(sha, cwd = root) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Invalid personal source SHA");
  execFileSync("git", ["merge-base", "--is-ancestor", trustedPersonalBase, sha], {
    cwd,
    stdio: "pipe",
  });
}

export function resolvePersonalDiffBase(supplied, cwd = root) {
  assertTrustedPersonalSource(
    execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
    cwd,
  );
  if (/^[a-f0-9]{40}$/.test(supplied ?? "") && !/^0+$/.test(supplied)) {
    const object = spawnSync("git", ["cat-file", "-e", `${supplied}^{commit}`], { cwd });
    if (object.error) throw object.error;
    if (object.status === 0) {
      const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", supplied, "HEAD"], {
        cwd,
      });
      if (ancestor.error) throw ancestor.error;
      if (ancestor.status === 0) return supplied;
      if (ancestor.status !== 1) throw new Error("Cannot inspect personal diff ancestry");
    }
  }
  // A first force-push may not contain github.event.before at all. Comparing an
  // unrelated old branch also hides the distinction between replay and new work.
  return trustedPersonalBase;
}
