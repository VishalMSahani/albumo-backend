// Backward-compatible entry point. Albumo uses R2 for new uploads.
import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--import",
    "tsx",
    "scripts/configure-r2.mts",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
