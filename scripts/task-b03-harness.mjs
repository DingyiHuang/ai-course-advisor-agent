import { pathToFileURL } from "node:url";

import {
  DEFAULT_RECOVERY_EVIDENCE_DIR,
  RecoveryGateStopError,
  runTaskB03RecoveryGates,
} from "./task-b03-recovery-runner.mjs";
import { runTaskB03Evidence, StopRunError } from "./task-b03-runner-core.mjs";

function parseOptions(argv) {
  const options = {
    baseUrl: "http://127.0.0.1:3000",
    evidenceDir: DEFAULT_RECOVERY_EVIDENCE_DIR,
    continueFormal: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base-url") options.baseUrl = argv[++index];
    else if (value === "--evidence-dir") options.evidenceDir = argv[++index];
    else if (value === "--no-formal") options.continueFormal = false;
    else throw new Error("Unknown TASK-B03H runner argument");
  }
  return options;
}

function writeProgress({ scenarioId, httpStatus, elapsedMs }) {
  process.stdout.write(
    `${scenarioId} http=${httpStatus ?? "none"} elapsedMs=${elapsedMs}\n`,
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  try {
    const recovery = await runTaskB03RecoveryGates({
      baseUrl: options.baseUrl,
      evidenceDir: options.evidenceDir,
      onProgress: writeProgress,
    });
    if (!options.continueFormal) return recovery;
    return runTaskB03Evidence({
      baseUrl: options.baseUrl,
      evidenceDir: options.evidenceDir,
      batch: "all",
    });
  } catch (error) {
    if (error instanceof RecoveryGateStopError || error instanceof StopRunError) {
      process.stderr.write(
        `stop code=${error.code} scenarioId=${error.scenarioId} stage=${error.stage ?? "formal"}\n`,
      );
      process.exitCode = 2;
      return undefined;
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
