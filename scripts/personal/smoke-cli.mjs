import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { npmPackages, npmName } from "./npm-distribution.mjs";
import {
  runCliTool,
  installedCliPaths,
  localCliScratch,
  terminalProofCommand,
  terminalProofMatches,
} from "./cli-platform.mjs";

function inspectInstalledPackages(run, installed, info) {
  const inspectCode = `const { createRequire } = require('node:module'); const fs = require('node:fs'); const path = require('node:path');
      const root = ${JSON.stringify(installed.package)}; const req = createRequire(path.join(root,'package.json'));
      function findPackage(file,name) { let current=path.dirname(file); while(true) { const manifest=path.join(current,'package.json'); if(fs.existsSync(manifest)) { const value=JSON.parse(fs.readFileSync(manifest)); if(value.name===name) return {path:manifest,value}; } const parent=path.dirname(current); if(parent===current) throw new Error('Missing '+name); current=parent; } }
      const identities={cli:JSON.parse(fs.readFileSync(path.join(root,'package.json')))};
      for(const key of ['protocol','client','plugin','server']) { const spec=key==='protocol'?'@getpaseo/protocol/messages': '@getpaseo/'+key; identities[key]=findPackage(req.resolve(spec),'@yinaoxiong/paseo-'+key).value; }
      const server=findPackage(req.resolve('@getpaseo/server'),'@yinaoxiong/paseo-server'); const serverRequire=createRequire(server.path);
      for(const key of ['relay','highlight']) identities[key]=findPackage(serverRequire.resolve('@getpaseo/'+key),'@getpaseo/'+key).value;
      const ptyEntry=serverRequire.resolve('node-pty');const loader=serverRequire(path.join(path.dirname(ptyEntry),'utils.js'));const loaded=loader.loadNativeModule(process.platform==='win32'?'conpty':'pty');if(!loaded.dir.includes('prebuilds'))throw new Error('Native loader selected a compiled build instead of published prebuild');const native=Object.keys(require.cache).filter(file=>file.endsWith('.node')&&file.includes('node-pty'));
      if(!native.length||native.some(file=>!file.includes('prebuilds'))) throw new Error('node-pty did not load its packaged prebuild');
      const sdkRoot=path.join(path.dirname(server.path),'node_modules/@opencode-ai/sdk'); if(JSON.parse(fs.readFileSync(path.join(sdkRoot,'package.json'))).name!=='@opencode-ai/sdk') throw new Error('Bundled SDK identity missing');
      for(const relative of ['dist/gen/core/serverSentEvents.gen.js','dist/v2/gen/core/serverSentEvents.gen.js']) if(!fs.readFileSync(path.join(sdkRoot,relative),'utf8').includes('reader.cancel().catch')) throw new Error('Installed SDK patch missing');
      const plugin=serverRequire('@getpaseo/plugin/server/provider'); if(!plugin) throw new Error('Plugin SDK resolution failed');
      console.log(JSON.stringify({identities:Object.fromEntries(Object.entries(identities).map(([key,value])=>[key,{name:value.name,version:value.version}])),native,sdkPatch:true,pluginResolution:true}));`;
  const inspection = JSON.parse(run(process.execPath, ["-e", inspectCode]));
  for (const key of npmPackages)
    if (
      inspection.identities[key].name !== npmName(key) ||
      inspection.identities[key].version !== info.version
    )
      throw new Error(`Private runtime mismatch ${key}`);
  for (const key of ["relay", "highlight"])
    if (inspection.identities[key].version !== info.upstreamVersion)
      throw new Error(`Official leaf version mismatch ${key}`);
  return inspection;
}

export async function smokeCli(tarball, info, registry) {
  if (!registry || !/^http:\/\/127\.0\.0\.1:\d+$/.test(registry))
    throw new Error("Candidate validation requires a loopback registry");
  const scratch = await mkdtemp(path.join(await localCliScratch(), "paseo CLI smoke "));
  const prefix = path.join(scratch, "install prefix");
  const home = path.join(scratch, "daemon home");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PASEO_")),
  );
  Object.assign(env, {
    PASEO_HOME: home,
    PASEO_RELAY_ENABLED: "false",
    NO_COLOR: "1",
    npm_config_registry: registry,
    npm_config_cache: path.join(scratch, "empty cache"),
  });
  const run = (executable, args, timeout = 120000) =>
    runCliTool(executable, args, {
      env,
      encoding: "utf8",
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
  const installed = installedCliPaths(prefix, process.platform, npmName("cli"));
  const cli = installed.executable;
  let started = false;
  let terminal;
  let report;
  let failure;
  const cleanupErrors = [];
  try {
    await mkdir(home);
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    await writeFile(
      path.join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          listen: `127.0.0.1:${port}`,
          relay: { enabled: false },
          mcp: { enabled: false, injectIntoAgents: false },
        },
      }),
    );
    console.log(
      "Online CLI smoke: installing exact candidate, empty cache, lifecycle scripts enabled",
    );
    const installStart = Date.now();
    const installOutput = run(
      "npm",
      [
        "install",
        "-g",
        path.resolve(tarball),
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "--foreground-scripts",
        "--allow-scripts=esbuild,node-pty,msgpackr-extract",
        "--timing",
      ],
      900000,
    );
    const installDurationMs = Date.now() - installStart;
    console.log(`Online installation completed in ${installDurationMs}ms\n${installOutput}`);
    if (/gyp info spawn|Building the projects in this solution/i.test(installOutput))
      throw new Error("Native build fallback is not an accepted prebuilt install");
    if (run(cli, ["--version"]).trim() !== info.version)
      throw new Error("Installed CLI version mismatch");
    const inspection = inspectInstalledPackages(run, installed, info);
    const json = (...args) => JSON.parse(run(cli, [...args, "--home", home, "--json"]));
    started = true;
    json("daemon", "start", "--timeout", "90");
    const status = json("daemon", "status");
    if (status.daemonVersion !== info.version) throw new Error("Daemon version mismatch");
    terminal = json("terminal", "create", "--cwd", scratch, "--name", "personal-package-smoke").id;
    const expected = { nonce: `paseo-cli-${randomUUID()}`, hostname: os.hostname(), cwd: scratch };
    const receiptFile = path.join(scratch, "terminal receipt.json");
    const proofScript = path.join(scratch, "terminal proof.cjs");
    await writeFile(
      proofScript,
      `const fs = require('node:fs'); const os = require('node:os'); const receipt = { nonce: ${JSON.stringify(expected.nonce)}, hostname: os.hostname(), cwd: process.cwd() }; fs.writeFileSync(${JSON.stringify(receiptFile + ".tmp")}, JSON.stringify(receipt), { flag: 'wx' }); fs.renameSync(${JSON.stringify(receiptFile + ".tmp")}, ${JSON.stringify(receiptFile)}); console.log(receipt.nonce); console.log(receipt.hostname); console.log(receipt.cwd);`,
    );
    const command = terminalProofCommand(process.execPath, proofScript);
    if (command.includes(expected.nonce))
      throw new Error("Terminal nonce must not appear in command echo");
    run(cli, ["terminal", "send-keys", terminal, "-l", command, "--home", home]);
    run(cli, ["terminal", "send-keys", terminal, "Enter", "--home", home]);
    let output = "";
    let receipt;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      output = run(cli, ["terminal", "capture", terminal, "--scrollback", "--home", home]);
      try {
        receipt = JSON.parse(await readFile(receiptFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (terminalProofMatches(receipt, expected, output)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!terminalProofMatches(receipt, expected, output))
      throw new Error(
        "Terminal smoke did not produce its exact output and matching execution receipt",
      );
    report = {
      onlineInstall: true,
      installDurationMs,
      installedPackages: inspection.identities,
      nativePrebuilds: inspection.native,
      sdkPatch: inspection.sdkPatch,
      pluginResolution: inspection.pluginResolution,
      cliVersion: info.version,
      daemonVersion: status.daemonVersion,
      hostname: receipt.hostname,
      terminal: "passed",
      executionReceipt: receipt,
      terminalOutput: output,
      npmEntry: path.basename(cli),
      spacePathInstall: true,
    };
    console.log("Standalone CLI execution receipt:", JSON.stringify(receipt));
  } catch (error) {
    failure = error;
  } finally {
    if (terminal) {
      try {
        run(cli, ["terminal", "kill", terminal, "--home", home]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (started) {
      try {
        run(cli, ["daemon", "stop", "--home", home, "--timeout", "30", "--force"]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (!cleanupErrors.length) await rm(scratch, { recursive: true, force: true });
  }
  if (failure || cleanupErrors.length)
    throw new AggregateError(
      [failure, ...cleanupErrors].filter(Boolean),
      "CLI smoke or cleanup failed",
    );
  return { ...report, cleanup: "passed" };
}
