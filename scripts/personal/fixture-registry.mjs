import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { runCliTool } from "./cli-platform.mjs";
import { npmName, npmPackages } from "./npm-distribution.mjs";

// Read-only fixture: no publishing/login API, exactly five hash-verified tarballs.
// Public metadata is fetched anonymously; no incoming authorization is forwarded.
const [directory, readyFile] = process.argv.slice(2);
if (!directory || !readyFile)
  throw new Error("Usage: fixture-registry <candidate-directory> <ready-file>");
const batch = JSON.parse(await readFile(path.join(directory, "manifest-npm.json"), "utf8"));
const packages = new Map();
for (const entry of batch.packages) {
  if (!npmPackages.includes(entry.key) || entry.name !== npmName(entry.key))
    throw new Error("Unexpected candidate identity");
  const asset = batch.assets.find((a) => a.name === entry.file);
  const file = path.join(directory, path.basename(entry.file));
  const bytes = await readFile(file);
  if (!asset || createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new Error("Candidate digest mismatch");
  const manifest = JSON.parse(
    runCliTool("tar", ["-xOzf", file, "package/package.json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }),
  );
  if (manifest.name !== entry.name || manifest.version !== batch.version)
    throw new Error("Candidate package mismatch");
  packages.set(manifest.name, {
    manifest,
    file,
    filename: path.basename(entry.file),
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
    shasum: createHash("sha1").update(bytes).digest("hex"),
  });
}
if (packages.size !== 5) throw new Error("Incomplete candidate batch");
let base;
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("Read-only fixture");
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const route = decodeURIComponent(url.pathname).slice(1);
    const name = route.startsWith("@")
      ? route.split("/").slice(0, 2).join("/")
      : route.split("/")[0];
    if (/^@getpaseo\/(cli|server|client|protocol|plugin)$/.test(name)) {
      res.writeHead(403);
      res.end("Official private-runtime substitute forbidden");
      return;
    }
    const entry = packages.get(name);
    if (entry) {
      if (route.includes("/-/")) {
        if (path.basename(route) !== entry.filename) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream" });
        createReadStream(entry.file).pipe(res);
        return;
      }
      const manifest = {
        ...entry.manifest,
        dist: {
          tarball: `${base}/${entry.manifest.name}/-/${entry.filename}`,
          integrity: entry.integrity,
          shasum: entry.shasum,
        },
      };
      const value =
        route === name
          ? {
              name,
              "dist-tags": { latest: manifest.version },
              versions: { [manifest.version]: manifest },
            }
          : manifest;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
      return;
    }
    if (name.startsWith("@yinaoxiong/")) {
      res.writeHead(404);
      res.end("Unknown private package");
      return;
    }
    const response = await fetch(`https://registry.npmjs.org${url.pathname}${url.search}`, {
      headers: { accept: req.headers.accept ?? "application/json" },
      signal: AbortSignal.timeout(60000),
    });
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") ?? "application/json",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Fixture request failed:", error.message);
    if (!res.headersSent) res.writeHead(502);
    res.end("Fixture upstream request failed");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;
await writeFile(
  `${readyFile}.tmp`,
  JSON.stringify({ registry: base, pid: process.pid, sourceSha: batch.sourceSha }) + "\n",
  { flag: "wx" },
);
await rename(`${readyFile}.tmp`, readyFile);
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
