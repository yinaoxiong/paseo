import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeArtifactManifest(directory, target, info, files, validation) {
  const assets = [];
  for (const file of files) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const name = path.basename(file);
    assets.push({ name, sha256, bytes: (await stat(file)).size });
    await writeFile(`${file}.sha256`, `${sha256}  ${name}\n`, { flag: "wx" });
  }
  const manifest = { ...info, target, assets, validation };
  await writeFile(
    path.join(directory, `manifest-${target}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return manifest;
}
