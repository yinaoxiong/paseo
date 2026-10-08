import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  relative as relativePath,
  join as joinPath,
  isAbsolute as isAbsolutePath,
} from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { load as loadYaml } from "js-yaml";
import {
  cliTarget,
  assertMacScratchInfo,
  tarToolPath,
  installedCliPaths,
  windowsShimCommand,
  terminalProofCommand,
  terminalProofMatches,
} from "./personal/cli-platform.mjs";
import {
  npmManifest,
  pinDirectDependencies,
  rebrandExecutable,
  assertPackageFiles,
} from "./personal/npm-distribution.mjs";
import { windowsInstallerArgs } from "./personal/windows-install.mjs";

const repoRoot = new URL("../", import.meta.url);
test("npm fork keeps canonical imports, moves internal peers to explicit aliases and reuses upstream leaves", () => {
  const result = npmManifest(
    {
      name: "@getpaseo/plugin",
      version: "0.11.0",
      files: ["dist"],
      scripts: { install: "bad" },
      peerDependencies: {
        "@getpaseo/client": "0.11.0",
        "@getpaseo/protocol": "0.11.0",
        react: "~19.1.0",
      },
      dependencies: { "@getpaseo/relay": "*", "@getpaseo/highlight": "*" },
    },
    "0.11.0-personal.1",
    "0.11.0",
  );
  assert.equal(result.name, "@yinaoxiong/paseo-plugin");
  assert.equal(
    result.dependencies["@getpaseo/client"],
    "npm:@yinaoxiong/paseo-client@0.11.0-personal.1",
  );
  assert.equal(
    result.dependencies["@getpaseo/protocol"],
    "npm:@yinaoxiong/paseo-protocol@0.11.0-personal.1",
  );
  assert.deepEqual(result.peerDependencies, { react: "~19.1.0" });
  assert.equal(result.dependencies["@getpaseo/relay"], "0.11.0");
  assert.equal(result.dependencies["@getpaseo/highlight"], "0.11.0");
  assert.equal(result.scripts, undefined);
  assert.equal(result.os, undefined);
  assert.equal(result.cpu, undefined);
});
test("npm executable identity changes do not rewrite canonical plugin imports", () => {
  const input =
    'import { start } from "@getpaseo/server/daemon-control"; if (packageJson.name !== "@getpaseo/server") return null;';
  const result = rebrandExecutable("cli", "dist/commands/daemon/local-daemon.js", input);
  assert.match(result, /from "@getpaseo\/server\/daemon-control"/);
  assert.match(result, /packageJson.name !== "@yinaoxiong\/paseo-server"/);
  assert.equal(
    rebrandExecutable(
      "server",
      "dist/server/server/plugins/plugin-sdk-specifiers.js",
      '"@getpaseo/plugin/server"',
    ),
    '"@getpaseo/plugin/server"',
  );
  assert.throws(
    () => rebrandExecutable("cli", "dist/commands/daemon/local-daemon.js", "unexpected"),
    /Missing expected/,
  );
  const manifest = {
    dependencies: {
      zod: "^4.0.0",
      "@getpaseo/client": "npm:@yinaoxiong/paseo-client@0.11.0-personal.1",
    },
  };
  pinDirectDependencies(manifest, "cli", {
    packages: { "node_modules/zod": { version: "4.4.3" } },
  });
  assert.equal(manifest.dependencies.zod, "4.4.3");
  assert.throws(
    () => assertPackageFiles([{ path: "node_modules/node-pty/build/pty.node" }]),
    /Unexpected bundled/,
  );
  assert.doesNotThrow(() =>
    assertPackageFiles([{ path: "node_modules/@opencode-ai/sdk/dist/index.js" }]),
  );
  assert.doesNotThrow(() =>
    assertPackageFiles([{ path: "dist/server/web-ui/assets/__node_modules/react/icon.png" }]),
  );
});
test("Mac scratch admits local disk filesystems and rejects remote or unknown storage", () => {
  assert.doesNotThrow(() => assertMacScratchInfo("/dev/disk3s1s1", "apfs"));
  assert.doesNotThrow(() => assertMacScratchInfo("/dev/disk2s1", "hfs"));
  assert.throws(() => assertMacScratchInfo("server:/share", "apfs"), /local APFS/);
  assert.throws(() => assertMacScratchInfo("/dev/disk2s1", "nfs"), /local APFS/);
  assert.throws(() => assertMacScratchInfo("/dev/disk2s1", "Directory"), /local APFS/);
});
test("standalone CLI targets reject unsupported architectures and map actual npm prefixes", () => {
  assert.equal(tarToolPath("win32", "C:\\Windows"), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarToolPath("linux"), "tar");
  assert.throws(() => tarToolPath("win32", "relative"), /system directory/);
  assert.equal(cliTarget("linux", "x64"), "linux-x64");
  assert.equal(cliTarget("darwin", "arm64"), "macos-arm64");
  assert.equal(cliTarget("win32", "x64"), "windows-x64");
  assert.throws(() => cliTarget("linux", "arm64"), /Unsupported/);
  assert.deepEqual(installedCliPaths("C:\\Temp\\space prefix", "win32"), {
    executable: "C:\\Temp\\space prefix\\paseo.cmd",
    package: "C:\\Temp\\space prefix\\node_modules\\@getpaseo\\cli",
  });
  assert.equal(
    installedCliPaths("/tmp/space prefix", "darwin").package,
    "/tmp/space prefix/lib/node_modules/@getpaseo/cli",
  );
});
test("standalone Terminal proof requires output plus a nonce, host and cwd receipt", () => {
  const expected = { nonce: "paseo-cli-test-123", hostname: "machine", cwd: "/tmp/space path" };
  assert.equal(terminalProofMatches(expected, expected, expected.nonce), true);
  assert.equal(terminalProofMatches(undefined, expected, expected.nonce), false);
  assert.equal(
    terminalProofMatches({ ...expected, hostname: "other" }, expected, expected.nonce),
    false,
  );
  assert.equal(
    terminalProofMatches({ ...expected, cwd: "/wrong" }, expected, expected.nonce),
    false,
  );
  assert.equal(
    terminalProofMatches({ ...expected, nonce: "stale" }, expected, expected.nonce),
    false,
  );
  assert.equal(terminalProofMatches(expected, expected, `prompt> ${expected.nonce}`), false);
  assert.equal(terminalProofMatches(expected, expected, expected.nonce + "-suffix"), false);
  const command = terminalProofCommand("/node with spaces/node", "/tmp/proof's file.cjs", "linux");
  assert.equal(command.includes(expected.nonce), false);
  const win = terminalProofCommand("C:\\Node Tools\\node.exe", "C:\\Temp\\proof file.cjs", "win32");
  assert.match(win, /-EncodedCommand [A-Za-z0-9+/=]+$/);
  assert.equal(win.includes(expected.nonce), false);
  assert.throws(() => windowsShimCommand("paseo.cmd", ["a\nsecond"]), /Unsafe/);
  assert.throws(() => windowsShimCommand("paseo.cmd", ["%PATH%"]), /Unsafe/);
});
test("packaged Terminal proof rejects command echo and failed hooks, accepts real output", () => {
  const require = createRequire(import.meta.url);
  const {
    getTerminalHookSmokeCommand,
    hasTerminalCompletionLine,
  } = require("../packages/desktop/e2e/terminal-smoke-proof.cjs");
  const marker = "paseo-packaged-terminal-smoke-123456";
  const command = getTerminalHookSmokeCommand(marker, "darwin");
  assert.equal(command.includes(marker), false);
  assert.equal(hasTerminalCompletionLine([command], marker), false);
  assert.equal(hasTerminalCompletionLine([`prompt> echo ${marker}`], marker), false);
  assert.equal(hasTerminalCompletionLine([marker.slice(0, 15), marker.slice(15)], marker), false);
  assert.equal(hasTerminalCompletionLine([`${marker}-extra`], marker), false);
  assert.equal(getTerminalHookSmokeCommand(marker, "win32").includes(marker), false);
  if (process.platform !== "win32") {
    const failed = spawnSync("/bin/sh", ["-c", command], {
      env: { ...process.env, PASEO_HOOK_CLI: "/usr/bin/false" },
      encoding: "utf8",
    });
    assert.notEqual(failed.status, 0);
    assert.equal(hasTerminalCompletionLine([command, ...failed.stdout.split("\n")], marker), false);
    const passed = spawnSync("/bin/sh", ["-c", command], {
      env: { ...process.env, PASEO_HOOK_CLI: "/usr/bin/true" },
      encoding: "utf8",
    });
    assert.equal(passed.status, 0);
    assert.equal(hasTerminalCompletionLine(passed.stdout.split("\n"), marker), true);
  }
});
test("Windows installer forces per-user mode and keeps NSIS directory last and unquoted", () => {
  assert.deepEqual(windowsInstallerArgs("C:\\Temp\\Personal App"), [
    "/S",
    "/currentuser",
    "/D=C:\\Temp\\Personal App",
  ]);
  for (const directory of ["relative", 'C:\\bad"path', "C:\\bad\npath"]) {
    assert.throws(() => windowsInstallerArgs(directory), /safe absolute Windows directory/);
  }
});
test(
  "CI root container trusts only its mounted checkout with foreign ownership",
  { skip: process.platform !== "linux" || process.getuid?.() !== 0 },
  () => {
    const temp = mkdtempSync(joinPath(os.tmpdir(), "paseo-ci-ownership-"));
    const repo = joinPath(temp, "repo");
    const home = joinPath(temp, "home");
    mkdirSync(repo);
    mkdirSync(home);
    const env = { ...process.env, HOME: home, GITHUB_ACTIONS: "true", RUNNER_TEMP: temp };
    delete env.SUDO_UID;
    try {
      execFileSync("git", ["init", repo], { env, stdio: "pipe" });
      execFileSync("chown", ["12345", repo, joinPath(repo, ".git")]);
      const refused = spawnSync("git", ["status", "--porcelain"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      assert.equal(refused.status, 128);
      assert.match(refused.stderr, /dubious ownership/);
      execFileSync(
        process.execPath,
        [new URL("scripts/personal/prepare-ci-container.mjs", repoRoot).pathname],
        { env },
      );
      const config = JSON.parse(
        readFileSync(joinPath(temp, "paseo-personal-ci-devcontainer.json"), "utf8"),
      );
      const trust = config.onCreateCommand.split(" && ")[0];
      assert.doesNotMatch(trust, /\*/);
      execFileSync("sh", ["-c", trust], { cwd: repo, env });
      assert.equal(
        execFileSync("git", ["status", "--porcelain"], { cwd: repo, env, encoding: "utf8" }),
        "",
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
test("personal desktop packages use manual fork releases and never official publishing", () => {
  const require = createRequire(import.meta.url);
  const config = require("../packages/desktop/electron-builder.personal.cjs");
  assert.deepEqual(config.publish, [
    { provider: "github", owner: "yinaoxiong", repo: "paseo", publishAutoUpdate: false },
  ]);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(isAbsolutePath(config.afterPack), true);
  assert.equal(isAbsolutePath(config.afterSign), true);
  assert.match(readFileSync(config.afterPack, "utf8"), /pruneNativeModules/);
  assert.match(readFileSync(config.afterSign, "utf8"), /smokePackagedDesktopApp/);
});

test("personal CI builds are manual, source pinned and least privileged", () => {
  const build = loadYaml(
    readFileSync(new URL(".github/workflows/personal-build.yml", repoRoot), "utf8"),
  );
  assert.deepEqual(Object.keys(build.on), ["workflow_dispatch"]);
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.equal(build.jobs.resolve.if, "github.repository == 'yinaoxiong/paseo'");
  for (const key of ["cli", "desktop", "android"]) {
    assert.equal(build.jobs[key].needs, "resolve");
    assert.equal(build.jobs[key].steps[0].with.ref, "${{ needs.resolve.outputs.sha }}");
    assert.equal(build.jobs[key].steps[0].with["persist-credentials"], false);
  }
  assert.deepEqual(build.jobs.desktop.strategy.matrix.include, [
    { runner: "macos-14", target: "macos-arm64" },
    { runner: "windows-2025", target: "windows-x64" },
  ]);
  assert.equal(
    build.jobs.cli.if,
    "inputs.mac_archive_run_id == '' && inputs.npm_candidate_run_id == ''",
  );
  assert.match(build.jobs["npm-install"].if, /!cancelled\(\).*needs\.cli\.result/);
  assert.deepEqual(build.jobs["npm-install"].permissions, { contents: "read", actions: "read" });
  for (const key of ["desktop", "android"])
    assert.equal(
      build.jobs[key].if,
      "inputs.mac_archive_run_id == '' && inputs.build_scope == 'all'",
    );
  assert.deepEqual(build.on.workflow_dispatch.inputs.build_scope.options, ["all", "online-verify"]);
  assert.equal(build.on.workflow_dispatch.inputs.build_scope.default, "all");
  assert.deepEqual(build.jobs["npm-install"].needs, ["resolve", "cli"]);
  assert.deepEqual(build.jobs["npm-install"].strategy.matrix.include, [
    { runner: "ubuntu-24.04", target: "linux-x64" },
    { runner: "macos-14", target: "macos-arm64" },
    { runner: "windows-2025", target: "windows-x64" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(build.jobs["npm-install"]),
    /secrets\.|build:server|personal:desktop/,
  );
  assert.match(JSON.stringify(build.jobs["npm-install"]), /personal-npm-candidates/);
  const verification = build.jobs["mac-archive-verification"];
  assert.equal(verification.if, "inputs.mac_archive_run_id != ''");
  assert.equal(verification.needs, "resolve");
  assert.deepEqual(verification.permissions, { contents: "read", actions: "read" });
  assert.equal(verification.steps[0].with.ref, "${{ needs.resolve.outputs.sha }}");
  assert.doesNotMatch(JSON.stringify(verification), /secrets\./);
  assert.match(JSON.stringify(verification), /verify-mac-archive\.mjs/);
  const checks = loadYaml(
    readFileSync(new URL(".github/workflows/personal-checks.yml", repoRoot), "utf8"),
  );
  assert.deepEqual(checks.permissions, { contents: "read" });
  assert.deepEqual(checks.on.pull_request.branches, ["personal/stable"]);
  assert.doesNotMatch(JSON.stringify(checks), /secrets\./);
});
const ciWorkflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const dockerWorkflowPath = new URL(".github/workflows/docker.yml", repoRoot);
const nixWorkflowPath = new URL(".github/workflows/nix.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);
const serverTsconfigPath = new URL("packages/server/tsconfig.server.json", repoRoot);
const desktopPackagePath = new URL("packages/desktop/package.json", repoRoot);

const gatedCiJobs = new Map([
  ["format", { name: "format", contract: "format" }],
  ["lint", { name: "lint", contract: "quality" }],
  ["typecheck", { name: "typecheck", contract: "quality" }],
  ["server-tests-ubuntu", { name: "server-tests (ubuntu-latest)", contracts: ["server", "hub"] }],
  ["server-tests-windows", { name: "server-tests (windows-latest)", contracts: ["server", "hub"] }],
  ["server-tests-macos", { name: "server-tests (macos-14, file observation)", contract: "server" }],
  ["desktop-tests-ubuntu", { name: "desktop-tests (ubuntu-latest)", contract: "desktop" }],
  ["desktop-tests-windows", { name: "desktop-tests (windows-latest)", contract: "desktop" }],
  ["app-tests", { name: "app-tests", contract: "app" }],
  ["sdk-tests", { name: "sdk-tests", contract: "sdk" }],
  ["playwright-1", { name: "playwright (shard 1/4)", contract: "browser" }],
  ["playwright-2", { name: "playwright (shard 2/4)", contract: "browser" }],
  ["playwright-3", { name: "playwright (shard 3/4)", contract: "browser" }],
  ["playwright-4", { name: "playwright (shard 4/4)", contract: "browser" }],
  ["relay-tests", { name: "relay-tests", contract: "relay" }],
  ["cli-tests-1", { name: "cli-tests (shard 1/3)", contract: "cli" }],
  ["cli-tests-2", { name: "cli-tests (shard 2/3)", contract: "cli" }],
  ["cli-tests-3", { name: "cli-tests (shard 3/3)", contract: "cli" }],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(fileURLToPath(directory), entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

test("gated checks are statically named jobs with real job-level gating", () => {
  const workflowSource = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(workflowSource);
  const trigger = workflowSource.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(workflowSource, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(workflowSource, /RUN_TESTS|Skip unaffected|No .* changes detected/);

  for (const [jobId, expected] of gatedCiJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${expected.name.replace(/[()]/g, "\\$&")}$`, "m"));
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    for (const contract of expected.contracts ?? [expected.contract]) {
      assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
    }
  }
});

test("change gating allows superseded workflow runs to cancel", () => {
  for (const workflowPath of [ciWorkflowPath, dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    assert.doesNotMatch(
      source,
      /\$\{\{\s*always\(\)/,
      "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
    );
  }
});

test("focused contracts stay inside existing required checks", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const changes = jobs.get("changes")?.join("\n") ?? "";
  const server = jobs.get("server-tests-ubuntu")?.join("\n") ?? "";
  const desktop = jobs.get("desktop-tests-ubuntu")?.join("\n") ?? "";

  assert.match(changes, /scripts\/daemon-launch-contract\.test\.mjs/);
  assert.doesNotMatch(changes, /Install dependencies|npm run build/);

  assert.match(server, /test:hub-cli-contract/);
  assert.match(server, /npm run test --workspace=@getpaseo\/server/);
  assert.ok(!jobs.has("hub-cli-contract"));

  assert.match(desktop, /test:e2e:renderer/);
  assert.match(desktop, /test:e2e:browser-tabs/);
  assert.match(desktop, /npm run test --workspace=@getpaseo\/desktop/);
  assert.ok(!jobs.has("desktop-browser-bridge"));
  assert.ok(!jobs.has("playwright-desktop"));
});

test("server builds exclude test utilities at every domain depth", () => {
  const tsconfig = JSON.parse(readFileSync(serverTsconfigPath, "utf8"));
  assert.ok(tsconfig.exclude.includes("src/server/**/test-utils/**"));
  assert.ok(!tsconfig.exclude.includes("src/server/test-utils/**"));
});

test("PR routing declares stable behavior ownership", () => {
  const filters = loadFilters(filtersPath);
  assert.deepEqual(filters, {
    routing: [".github/ci-paths.yml"],
    workspace: [
      ".mise.toml",
      ".tool-versions",
      "package.json",
      "package-lock.json",
      "patches/**",
      "scripts/**",
      "tsconfig.json",
      "tsconfig.base.json",
      "vitest.config.ts",
    ],
    ci: [".github/actions/**", ".github/workflows/ci.yml"],
    format: [
      ".agents/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      ".github/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "packages/expo-two-way-audio/**",
    ],
    quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}", "packages/expo-two-way-audio/**"],
    hub: ["packages/cli/src/commands/hub/**", "packages/server/src/server/hub/**"],
    server: ["plugins/**", "packages/server/**", "packages/app/e2e/support/fixtures/recording.*"],
    desktop: [
      "packages/desktop/**",
      "packages/app/src/desktop/**",
      "packages/server/src/server/browser-tools/**",
      "packages/app/e2e/support/**",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    app: ["packages/app/**", "packages/expo-two-way-audio/**"],
    sdk: [
      "packages/plugin/**",
      "plugin-examples/**",
      "public-docs/plugins/**",
      "packages/client/**",
      "packages/highlight/**",
      "packages/protocol/**",
    ],
    browser: [
      "packages/server/src/server/agent/provider-snapshot-manager.ts",
      "packages/server/src/server/session/provider/provider-catalog-session.ts",
      "packages/client/src/compat/normalize-provider-models.ts",
      "packages/protocol/src/client-capabilities.ts",
      "packages/server/src/server/agent/provider-registry.ts",
      "packages/server/src/server/agent/agent-sdk-types.ts",
      "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
      "packages/server/src/server/agent/providers/claude/agent.ts",
      "packages/server/src/server/agent/plugin-provider.ts",
      "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
      "packages/server/src/executable-resolution/**",
      "packages/plugin/src/server/provider.ts",
      "packages/app/src/!(desktop)/**",
      "packages/app/e2e/browser/**",
      "packages/app/e2e/support/**",
      "packages/app/assets/**",
      "packages/app/public/**",
      "packages/app/index.ts",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    relay: ["packages/relay/**"],
    cli: ["packages/cli/**"],
  });
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
      path,
    );
  }

  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("browser and desktop tests have exclusive, directory-owned suites", () => {
  const filters = loadFilters(filtersPath);
  const browserSpecs = filesUnder("packages/app/e2e", (path) => path.endsWith(".spec.ts"));
  const desktopSpecs = filesUnder("packages/desktop/e2e", (path) => path.endsWith(".spec.ts"));
  const electronModules = filesUnder("packages/app/src", (path) => /\.electron\.tsx?$/.test(path));

  assert.ok(browserSpecs.length > 0);
  assert.ok(desktopSpecs.length > 0);
  assert.ok(browserSpecs.every((path) => path.startsWith("packages/app/e2e/browser/")));
  assert.ok(desktopSpecs.every((path) => path.startsWith("packages/desktop/e2e/")));
  assert.ok(electronModules.every((path) => path.startsWith("packages/app/src/desktop/")));

  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  assert.match(desktopPackage.scripts.test, /--exclude ["']e2e\/\*\*["']/);

  for (const path of browserSpecs) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /paseoDesktop|injectDesktopBridge/,
    );
  }
  for (const path of desktopSpecs) {
    assert.ok(path.startsWith("packages/desktop/e2e/"));
  }

  const routingSource = readFileSync(filtersPath, "utf8");
  assert.doesNotMatch(routingSource, /desktop_bridge|playwright_desktop|browser-\*|browser-\*\//);
  assert.deepEqual(filters.desktop, [
    "packages/desktop/**",
    "packages/app/src/desktop/**",
    "packages/server/src/server/browser-tools/**",
    "packages/app/e2e/support/**",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
  assert.deepEqual(filters.browser, [
    "packages/server/src/server/agent/provider-snapshot-manager.ts",
    "packages/server/src/server/session/provider/provider-catalog-session.ts",
    "packages/client/src/compat/normalize-provider-models.ts",
    "packages/protocol/src/client-capabilities.ts",
    "packages/server/src/server/agent/provider-registry.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
    "packages/server/src/server/agent/providers/claude/agent.ts",
    "packages/server/src/server/agent/plugin-provider.ts",
    "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
    "packages/server/src/executable-resolution/**",
    "packages/plugin/src/server/provider.ts",
    "packages/app/src/!(desktop)/**",
    "packages/app/e2e/browser/**",
    "packages/app/e2e/support/**",
    "packages/app/assets/**",
    "packages/app/public/**",
    "packages/app/index.ts",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
});

test("packaging runs on main without allocating pull-request runners", () => {
  for (const workflowPath of [dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    const trigger = source.split("jobs:", 1)[0];
    assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
    assert.doesNotMatch(trigger, /pull_request/);
    assert.doesNotMatch(source, /dorny\/paths-filter/);
  }
});

test("desktop packaging smokes main pushes and only the pull requests that touch packaging", () => {
  const source = readFileSync(new URL(".github/workflows/desktop-packages.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
  assert.match(trigger, /pull_request:\s*\n\s+branches: \[main\]\s*\n\s+paths:/);
  assert.match(trigger, /- "packages\/desktop\/\*\*"/);
  assert.doesNotMatch(source, /dorny\/paths-filter/);
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    assert.match(source, new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  }
});
