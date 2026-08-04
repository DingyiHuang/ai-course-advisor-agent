import { pathToFileURL } from "node:url";

import {
  parseCliOptions,
  runTaskB03Evidence,
  StopRunError,
} from "./task-b03-runner-core.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  try {
    const result = await runTaskB03Evidence(options);
    process.stdout.write(
      JSON.stringify({
        batch: result.batch,
        completedThisRun: result.completedThisRun,
        completedScenarios: result.summary.completedScenarios,
        functionalPassRate: result.summary.functionalPassRate,
        feeFirstPassHitRate: result.summary.feeFirstPassHitRate,
        groundingRegenerationCount: result.summary.groundingRegenerationCount,
        fallbackCount: result.summary.fallbackCount,
        transientModelErrorCount: result.summary.transientModelErrorCount,
      }) + "\n",
    );
  } catch (error) {
    if (error instanceof StopRunError) {
      process.stderr.write(
        JSON.stringify({ code: error.code, scenarioId: error.scenarioId }) + "\n",
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
