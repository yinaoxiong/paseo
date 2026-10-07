#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const localPackages = ["highlight", "relay", "protocol", "client", "plugin", "server"];
const allLocalPackages = [...localPackages, "cli"];
const packageDirs = {
  highlight: "packages/highlight",
  relay: "packages/relay",
  protocol: "packages/protocol",
  client: "packages/client",
  plugin: "packages/plugin",
  server: "packages/server",
  cli: "packages/cli",
};
const localPackageNames = Object.fromEntries(
  allLocalPackages.map((name) => [name, `@getpaseo/${name}`]),
);

function parseArgs(argv) {
  const args = {
    version: null,
    outputDir: ".local-build",
    tempDir: "/tmp",
    skipBuild: false,
    keepStaging: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      args.version = argv[++index];
    } else if (arg === "--output-dir") {
      args.outputDir = argv[++index];
    } else if (arg === "--temp-dir") {
      args.tempDir = argv[++index];
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
    } else if (arg === "--keep-staging") {
      args.keepStaging = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Build a fully bundled private Paseo CLI tarball.

Usage:
  node .planning/scripts/build-personal-cli-tarball.mjs [options]

Options:
  --version <version>      Private build version, e.g. 0.1.91+personal.1
  --output-dir <dir>      Output directory for the final .tgz (default: .local-build)
  --skip-build            Do not run npm run build:server first
  --temp-dir <dir>         Existing container-local scratch parent (default: /tmp)
  --keep-staging          Keep local scratch files, including on failure

Run through devcontainer exec. Staging, dependencies, npm cache and install
verification stay on verified local storage. Only the verified .tgz is copied
to --output-dir. Network/FUSE or unknown scratch filesystems are rejected.
`);
}

function run(command, args, { cwd, env, json = false } = {}) {
  console.log(`+ ${[command, ...args].join(" ")}`);
  const stdout = execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  return json ? JSON.parse(stdout) : undefined;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function copyPackage(src, dst) {
  await cp(src, dst, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return !["node_modules", ".turbo", ".cache", "coverage"].includes(name);
    },
  });
}

function rewriteLocalVersions(packageJson, version) {
  packageJson.version = version;
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = packageJson[section];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const packageName of Object.values(localPackageNames)) {
      if (packageName in deps) {
        deps[packageName] = version;
      }
    }
  }
}

function stripPublishOnlyFields(packageJson) {
  for (const key of ["devDependencies", "scripts", "publishConfig", "overrides"]) {
    delete packageJson[key];
  }
}

function packStagedPackage(packageDir, packDir, env) {
  const result = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], {
    cwd: packageDir,
    env,
    json: true,
  });
  if (!Array.isArray(result) || result.length === 0 || typeof result[0].filename !== "string") {
    throw new Error(`Unexpected npm pack result for ${packageDir}: ${JSON.stringify(result)}`);
  }
  return path.join(packDir, result[0].filename);
}

async function listTopLevelNodeModules(nodeModules) {
  const bundled = [];
  for (const entry of (await readdir(nodeModules, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name.startsWith("@")) {
      const scopePath = path.join(nodeModules, entry.name);
      for (const scoped of (await readdir(scopePath, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (scoped.isDirectory()) {
          bundled.push(`${entry.name}/${scoped.name}`);
        }
      }
    } else if (entry.isDirectory()) {
      bundled.push(entry.name);
    }
  }
  return bundled;
}

async function assertRepoRoot(repo) {
  try {
    await readJson(path.join(repo, "package.json"));
    await readJson(path.join(repo, "packages/cli/package.json"));
  } catch {
    throw new Error(`${repo} does not look like the Paseo repo root`);
  }
}

async function defaultPrivateVersion(repo) {
  const rootPackage = await readJson(path.join(repo, "package.json"));
  return `${rootPackage.version}+personal.1`;
}

async function resolveLocalScratchParent(directory) {
  // This private build workflow targets the Linux devcontainer. Do not silently
  // inherit TMPDIR, which may point at the network-mounted checkout.
  await access("/.dockerenv");
  const resolved = await realpath(directory);
  const { type } = await statfs(resolved);
  const localTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630, 0x858458f6]);
  if (!localTypes.has(type >>> 0)) {
    throw new Error(`Scratch directory must use a known local filesystem: ${resolved}`);
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = process.cwd();
  await assertRepoRoot(repo);

  const version = args.version ?? (await defaultPrivateVersion(repo));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid private build version: ${version}`);
  }
  const outputDir = path.resolve(repo, args.outputDir);
  const finalTarball = path.join(outputDir, `getpaseo-cli-${version}.tgz`);
  try {
    await lstat(finalTarball);
    throw new Error(`Refusing to overwrite existing tarball: ${finalTarball}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const scratchParent = await resolveLocalScratchParent(args.tempDir);
  const stagingRoot = await mkdtemp(path.join(scratchParent, "paseo-cli-build-"));
  console.log(`Local scratch: ${stagingRoot}`);
  try {
    await buildTarball({ args, repo, version, outputDir, finalTarball, stagingRoot });
  } finally {
    if (args.keepStaging) {
      console.log(`Kept local scratch: ${stagingRoot}`);
    } else {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

async function buildTarball({ args, repo, version, outputDir, finalTarball, stagingRoot }) {
  const workspaceStage = path.join(stagingRoot, "workspaces");
  const packDir = path.join(stagingRoot, "packs");
  const cliStage = path.join(stagingRoot, "cli");
  const env = {
    ...process.env,
    npm_config_registry: process.env.npm_config_registry ?? "https://mirrors.tencent.com/npm/",
    npm_config_cache: path.join(stagingRoot, "npm-cache"),
    NPM_CONFIG_CACHE: path.join(stagingRoot, "npm-cache"),
    TMPDIR: stagingRoot,
    TMP: stagingRoot,
    TEMP: stagingRoot,
  };

  await mkdir(packDir, { recursive: true });

  if (!args.skipBuild) {
    run("npm", ["run", "build:server"], { cwd: repo, env });
  }

  const localTarballs = {};
  for (const key of localPackages) {
    const staged = path.join(workspaceStage, key);
    await copyPackage(path.join(repo, packageDirs[key]), staged);
    const packageJsonPath = path.join(staged, "package.json");
    const packageJson = await readJson(packageJsonPath);
    rewriteLocalVersions(packageJson, version);
    stripPublishOnlyFields(packageJson);
    await writeJson(packageJsonPath, packageJson);
    localTarballs[key] = packStagedPackage(staged, packDir, env);
  }

  await copyPackage(path.join(repo, packageDirs.cli), cliStage);
  const cliPackageJsonPath = path.join(cliStage, "package.json");
  const cliPackageJson = await readJson(cliPackageJsonPath);
  rewriteLocalVersions(cliPackageJson, version);
  stripPublishOnlyFields(cliPackageJson);
  cliPackageJson.dependencies ??= {};
  for (const [key, packageName] of Object.entries(localPackageNames)) {
    if (key !== "cli") {
      cliPackageJson.dependencies[packageName] = `file:${localTarballs[key]}`;
    }
  }
  await writeJson(cliPackageJsonPath, cliPackageJson);

  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--package-lock=false"], {
    cwd: cliStage,
    env,
  });

  const finalPackageJson = await readJson(cliPackageJsonPath);
  for (const [key, packageName] of Object.entries(localPackageNames)) {
    if (key !== "cli") {
      finalPackageJson.dependencies[packageName] = version;
    }
  }
  finalPackageJson.files ??= [];
  if (!finalPackageJson.files.includes("node_modules")) {
    finalPackageJson.files.push("node_modules");
  }
  finalPackageJson.bundledDependencies = await listTopLevelNodeModules(
    path.join(cliStage, "node_modules"),
  );
  await writeJson(cliPackageJsonPath, finalPackageJson);

  const produced = packStagedPackage(cliStage, packDir, env);

  const prefix = await mkdtemp(path.join(stagingRoot, "verify-"));
  try {
    run("npm", ["install", "-g", produced, "--ignore-scripts", "--prefix", prefix], {
      cwd: repo,
      env,
    });
    run(path.join(prefix, "bin/paseo"), ["--version"], { cwd: repo, env });
    const installedCli = path.join(prefix, "lib/node_modules/@getpaseo/cli");
    for (const [key, packageName] of Object.entries(localPackageNames)) {
      if (key === "cli") {
        continue;
      }
      const installedPackageJson = await readJson(
        path.join(installedCli, "node_modules", packageName, "package.json"),
      );
      if (installedPackageJson.version !== version) {
        throw new Error(
          `${packageName} installed as ${installedPackageJson.version}, expected ${version}`,
        );
      }
    }
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }

  await mkdir(outputDir, { recursive: true });
  await copyFile(produced, finalTarball, constants.COPYFILE_EXCL);

  console.log(`Built ${finalTarball}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
