import { constants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, repoRoot } from "./build-info.mjs";
import { localCliScratch, runCliTool } from "./cli-platform.mjs";
import {
  npmPackages,
  npmVersion,
  npmManifest,
  pinDirectDependencies,
  rebrandExecutable,
  assertPackageFiles,
  hashBytes,
} from "./npm-distribution.mjs";
import { writeArtifactManifest } from "./manifest.mjs";

const argv = process.argv.slice(2);
let revision = 1;
let output = ".local-build";
let skipBuild = false;
for (let index = 0; index < argv.length; index++) {
  if (argv[index] === "--revision") revision = Number(argv[++index]);
  else if (argv[index] === "--output-dir") output = argv[++index];
  else if (argv[index] === "--skip-build") skipBuild = true;
  else throw new Error(`Unsupported npm build argument ${argv[index]}`);
}
if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("Build universal JavaScript npm candidates in the Node24 Linux devcontainer");
if (process.env.GITHUB_ACTIONS !== "true") await access("/.dockerenv");
const info = createBuildInfo(revision);
const version = npmVersion(info.upstreamVersion, revision);
const directory = path.resolve(output);
const scratch = await mkdtemp(path.join(await localCliScratch(os.tmpdir()), "paseo-npm-build-"));
const packs = path.join(scratch, "packs");
const lock = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
const env = {
  ...process.env,
  npm_config_registry: "https://registry.npmjs.org/",
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
};
const run = (cmd, args, options = {}) =>
  runCliTool(cmd, args, { cwd: repoRoot, env, stdio: "inherit", ...options });
async function json(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
async function editIdentities(key, root, relative = "") {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) await editIdentities(key, root, next);
    else if (entry.name.endsWith(".js")) {
      const file = path.join(root, next);
      const original = await readFile(file, "utf8");
      const edited = rebrandExecutable(key, next, original);
      if (edited !== original) await writeFile(file, edited);
    }
  }
}
async function pack(dir) {
  const result = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packs], {
      cwd: dir,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  assertPackageFiles(result[0].files);
  return path.join(packs, result[0].filename);
}
try {
  await mkdir(packs);
  await mkdir(directory, { recursive: true });
  await access(path.join(directory, "manifest-npm.json")).then(
    () => {
      throw new Error("Refusing to overwrite npm batch");
    },
    (e) => {
      if (e.code !== "ENOENT") throw e;
    },
  );
  if (!skipBuild) {
    run("npm", ["run", "build:server"]);
    run("npm", ["run", "build:daemon-web-ui"]);
  }
  const files = [];
  const packageRecords = [];
  for (const key of npmPackages) {
    const staged = path.join(scratch, key);
    await cp(path.join(repoRoot, "packages", key), staged, {
      recursive: true,
      filter: (file) =>
        !["node_modules", ".turbo", ".cache", "coverage"].includes(path.basename(file)),
    });
    const original = JSON.parse(await readFile(path.join(staged, "package.json"), "utf8"));
    const manifest = pinDirectDependencies(
      npmManifest(original, version, info.upstreamVersion),
      key,
      lock,
    );
    await json(path.join(staged, "package.json"), manifest);
    await json(path.join(staged, "build-info.json"), {
      ...info,
      version,
      packageName: manifest.name,
      desktopVersion: info.version,
    });
    await editIdentities(key, staged);
    if (key === "server") {
      const sdk = lock.packages["packages/server/node_modules/@opencode-ai/sdk"];
      const result = JSON.parse(
        run(
          "npm",
          ["pack", sdk.resolved, "--ignore-scripts", "--json", "--pack-destination", packs],
          { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
        ),
      );
      const archive = path.join(packs, result[0].filename);
      const integrity =
        "sha512-" +
        createHash("sha512")
          .update(await readFile(archive))
          .digest("base64");
      if (integrity !== sdk.integrity)
        throw new Error("SDK archive differs from the source lock integrity");
      const sdkDir = path.join(staged, "node_modules/@opencode-ai/sdk");
      await mkdir(sdkDir, { recursive: true });
      run("tar", ["-xzf", archive, "--strip-components=1", "-C", sdkDir]);
      const patch = path.join(repoRoot, "patches", `@opencode-ai+sdk+${sdk.version}.patch`);
      run("git", ["apply", "--check", patch], { cwd: staged });
      run("git", ["apply", patch], { cwd: staged });
      await json(path.join(staged, "sdk-patch-info.json"), {
        version: sdk.version,
        sourceIntegrity: sdk.integrity,
        patchSha256: hashBytes(await readFile(patch)),
      });
      manifest.files.push("sdk-patch-info.json");
      await json(path.join(staged, "package.json"), manifest);
    }
    const archive = await pack(staged);
    const destination = path.join(directory, path.basename(archive));
    await copyFile(archive, destination, constants.COPYFILE_EXCL);
    files.push(destination);
    packageRecords.push({
      key,
      name: manifest.name,
      version,
      file: path.basename(destination),
      dependencies: manifest.dependencies,
      peerDependencies: manifest.peerDependencies ?? {},
    });
  }
  await writeArtifactManifest(
    directory,
    "npm",
    {
      ...info,
      version,
      desktopVersion: info.version,
      packages: packageRecords,
      publicationGraphSha256: hashBytes(Buffer.from(JSON.stringify(packageRecords))),
      universalJavaScript: true,
    },
    files,
    { stage: "candidate; installation pending", sdkPatchBundled: true },
  );
  console.log(`Built five universal npm candidates in ${directory}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
