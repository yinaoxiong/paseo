import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, repoRoot } from "./build-info.mjs";
import { androidBuildScript } from "./android-build-script.mjs";

const info = createBuildInfo(Number(process.argv[2]));
const output = path.resolve(process.argv[3]);
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Linux x64 builder required");
if (
  ![0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630, 0x858458f6].includes(
    statfsSync(os.tmpdir()).type >>> 0,
  )
)
  throw new Error("QA scratch must use local disk");
const scratch = mkdtempSync(path.join(os.tmpdir(), "paseo-android-qa-"));
const source = path.join(scratch, "source");
const image = process.env.PASEO_ANDROID_BUILDER_IMAGE ?? "paseo-android-builder:local";
const run = (command, args, capture = false) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    maxBuffer: 32 * 1024 * 1024,
  });
let buildError;
let imagePresent = false;
try {
  info.androidBuilderId = run(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    true,
  ).trim();
  imagePresent = true;
  const archive = path.join(scratch, "source.tar");
  run("git", ["archive", "--format=tar", `--output=${archive}`, info.sourceSha]);
  mkdirSync(source);
  run("tar", ["-xf", archive, "-C", source]);
  const root = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
  const prefix = `paseo-qa-${process.env.GITHUB_RUN_ID ?? process.pid}`;
  const volumes = ["", ...root.workspaces].flatMap((relative) => [
    "-v",
    `${prefix}-${relative.replaceAll("/", "-") || "root"}:/workspaces/paseo/${relative ? relative + "/" : ""}node_modules`,
  ]);
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${source}:/workspaces/paseo`,
    ...volumes,
    "-v",
    `${process.env.PASEO_ANDROID_NPM_CACHE ?? "paseo-android-npm-cache"}:/root/.npm`,
    "-v",
    `${process.env.PASEO_ANDROID_GRADLE_CACHE ?? "paseo-android-gradle-cache"}:/root/.gradle`,
    "-w",
    "/workspaces/paseo",
    "-e",
    "CI=1",
    "-e",
    "APP_VARIANT=personal",
    "-e",
    `PASEO_PERSONAL_REVISION=${info.revision}`,
    "-e",
    "NODE_OPTIONS=--max-old-space-size=4096",
    "-e",
    "npm_config_registry=https://registry.npmjs.org/",
    image,
    "bash",
    "-lc",
    androidBuildScript("x86_64"),
  ]);
  const apk = path.join(
    source,
    "packages/app/android/app/build/outputs/apk/release/app-release.apk",
  );
  const names = run("unzip", ["-Z1", apk], true);
  const abis = new Set([...names.matchAll(/^lib\/([^/]+)\//gm)].map((m) => m[1]));
  if (abis.size !== 1 || !abis.has("x86_64")) throw new Error("QA APK must contain x86_64 only");
  const verification = run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${apk}:/tmp/qa.apk:ro`,
      image,
      "bash",
      "-lc",
      "set -euo pipefail; apksigner verify --verbose --print-certs /tmp/qa.apk; aapt dump badging /tmp/qa.apk",
    ],
    true,
  );
  if (
    !verification.includes("name='sh.paseo.personal'") ||
    !verification.includes(`versionCode='${info.androidVersionCode}'`)
  )
    throw new Error("QA package identity mismatch");
  const qaCert = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(verification)?.[1].toLowerCase();
  const productionCert = JSON.parse(
    readFileSync(new URL("./android-signing.json", import.meta.url), "utf8"),
  ).certificateSha256;
  if (!/^[a-f0-9]{64}$/.test(qaCert ?? "") || qaCert === productionCert)
    throw new Error("QA must use its generated debug key, not the production signer");
  info.signature = "qa-debug-key";
  info.signerSha256 = qaCert;
  const name = `paseo-qa-${info.version}-android-x86_64.apk`;
  mkdirSync(output, { recursive: true });
  if (existsSync(path.join(output, name))) throw new Error("Refusing to overwrite QA APK");
  copyFileSync(apk, path.join(output, name));
  const bytes = readFileSync(apk);
  writeFileSync(
    path.join(output, "qa-build.json"),
    JSON.stringify(
      {
        ...info,
        kind: "emulator-qa-only",
        abi: "x86_64",
        buildType: "release",
        hermes: true,
        productionSigner: false,
        apk: name,
        apkBytes: bytes.length,
        apkSha256: createHash("sha256").update(bytes).digest("hex"),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} catch (error) {
  buildError = error;
} finally {
  try {
    if (imagePresent)
      run("docker", [
        "run",
        "--rm",
        "-v",
        `${scratch}:/cleanup`,
        "-v",
        `${process.env.PASEO_ANDROID_NPM_CACHE ?? "paseo-android-npm-cache"}:/root/.npm`,
        "-v",
        `${process.env.PASEO_ANDROID_GRADLE_CACHE ?? "paseo-android-gradle-cache"}:/root/.gradle`,
        image,
        "bash",
        "-lc",
        `set -euo pipefail; rm -rf /cleanup/source /cleanup/source.tar; chown -R ${process.getuid()}:${process.getgid()} /root/.npm /root/.gradle`,
      ]);
    rmSync(scratch, { recursive: true, force: true });
  } catch (cleanupError) {
    console.error("QA scratch cleanup failed:", cleanupError);
    buildError ??= cleanupError;
  }
}
if (buildError) {
  console.error(buildError);
  process.exitCode = 1;
}
