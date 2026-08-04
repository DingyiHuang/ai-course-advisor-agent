import { pathToFileURL } from "node:url";
import {
  parseCliOptions,
  runTaskB02Evidence,
  StopRunError,
} from "./task-b02-runner-core.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  try {
    const result = await runTaskB02Evidence(options);
    process.stdout.write(
      JSON.stringify({
        batch: result.batch,
        completedThisRun: result.completedThisRun,
        failedThisRun: result.failedThisRun,
        recheckedThisRun: result.recheckedThisRun,
        completedFunctionalScenarios:
          result.summary.completedFunctionalScenarios,
        functionalPassRate: result.summary.functionalPassRate,
        transientErrorCount: result.summary.transientErrorCount,
      }) + "\n",
    );
    if (result.failedThisRun > 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof StopRunError) {
      process.stderr.write(
        JSON.stringify({
          code: error.code,
          scenarioId: error.scenarioId,
        }) + "\n",
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
