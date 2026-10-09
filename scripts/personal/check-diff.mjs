import { execFileSync } from "node:child_process";
import { repoRoot } from "./build-info.mjs";
import { resolvePersonalDiffBase } from "./trusted-source.mjs";

const base = resolvePersonalDiffBase(process.env.PASEO_DIFF_BASE);
const diff = execFileSync("git", ["diff", "--unified=0", base, "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const patterns = [
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})/,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/,
  /#offer=[A-Za-z0-9_-]{80,}/,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/,
];
let file = "unknown";
let additions = 0;
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) {
    file = line.slice(6);
    continue;
  }
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  additions++;
  if (patterns.some((pattern) => pattern.test(line.slice(1))))
    throw new Error(
      `Potential credential in newly added content: ${file}; inspect privately. Value omitted.`,
    );
}
console.log(
  `Checked ${additions} added lines against ${base}; this is a small diff check, not a history audit.`,
);
