function getTerminalHookSmokeCommand(marker, platform = process.platform) {
  if (!/^[A-Za-z0-9-]+$/.test(marker)) throw new Error("Unsafe terminal proof marker");
  if (platform === "win32") {
    const script = [
      "& $env:PASEO_HOOK_CLI hooks codex Stop",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      `Write-Output '${marker}'`,
    ].join("; ");
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  const split = Math.floor(marker.length / 2);
  // The full marker never appears in the command echo, including wrapped rows.
  return `"$PASEO_HOOK_CLI" hooks codex Stop && printf '%s%s\\n' '${marker.slice(0, split)}' '${marker.slice(split)}'`;
}

function hasTerminalCompletionLine(lines, marker) {
  return (
    Array.isArray(lines) && lines.some((line) => typeof line === "string" && line.trim() === marker)
  );
}

module.exports = { getTerminalHookSmokeCommand, hasTerminalCompletionLine };
