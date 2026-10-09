import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Reviewed overlay after replaying all 18 private commits onto official v0.11.2.
// Move this pin only after auditing a new private baseline; upstream ancestry alone
// does not authorize running fork code with signing credentials.
export const trustedPersonalBase = "c3b671672521ececce77fce2d9bfe94daef944dc";
const root = fileURLToPath(new URL("../../", import.meta.url));

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
