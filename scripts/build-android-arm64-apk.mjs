#!/usr/bin/env node
// Compatibility entrypoint; personal builds use local staging and stable signing.
if (process.argv.slice(2).some((arg) => arg.startsWith("--"))) {
  throw new Error(
    "Use npm run personal:android -- <revision> <output-directory>; legacy staging/install flags were removed.",
  );
}
await import("./personal/build-android.mjs");
