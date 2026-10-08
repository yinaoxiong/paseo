#!/usr/bin/env node
// The personal CLI is a universal online npm distribution. Build its five
// runtime packages together; target-specific installation is verified separately.
await import("./build-npm.mjs");
