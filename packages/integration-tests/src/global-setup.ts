import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject, TestSpecification } from "vitest/node";
import { pnpmCommand } from "../../../scripts/pnpm-command.js";
import { isWorkerInput } from "./worker-inputs.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATED_ENTRIES = [
  join(PACKAGE_DIR, "../workshop-backend/.wrangler/validate/src/server.ts"),
  join(PACKAGE_DIR, "fixtures/gatekeeper-test/.wrangler/validate/src/test-gatekeeper.ts"),
];

/**
 * Longer than vitest's own 100ms watcher debounce, which is what keeps a rename from running the
 * suite twice: a rename fires `unlink` then `add`, the `add` path reruns first, and the whole-suite
 * rerun it schedules cancels the timer below. A plain deletion has no `add`, so nothing cancels it
 * and the timer fires.
 */
const DELETE_DEBOUNCE_MS = 200;

function rebuildWorkshopForWatch(): void {
  const [command, args] = pnpmCommand(["run", "test:prebuild"]);
  execFileSync(command, args, { cwd: PACKAGE_DIR, stdio: "inherit" });
}

/** Share validated Worker builds across isolated test-file processes. */
export default function setup(project: TestProject): () => void {
  const missingEntries = VALIDATED_ENTRIES.filter(entry => !existsSync(entry));
  if (missingEntries.length > 0) {
    throw new Error(`Integration-test builds did not produce: ${missingEntries.join(", ")}`);
  }
  process.env.WORKSHOP_INTEGRATION_PREBUILT = "1";

  const { vitest } = project;
  let pendingDelete: NodeJS.Timeout | undefined;
  const cancelPendingDelete = () => {
    clearTimeout(pendingDelete);
    pendingDelete = undefined;
  };

  /**
   * Whether a rerun about to start already runs everything a pending deletion would have rerun.
   *
   * Only a whole-suite rerun makes that timer redundant. Cancelling on a *partial* rerun -- one
   * test file saved while the timer is pending -- would rebuild the Worker and then run only that
   * file against it, silently dropping the rest of the suite the deletion was meant to recheck.
   *
   * Measured against the files on disk, which is the same unfiltered set the timer below reruns. A
   * rerun narrowed by a filename filter, or one predating a newly added test file, therefore counts
   * as partial. Erring that way costs an extra rerun; the other direction costs coverage.
   */
  const coversWholeSuite = async (rerunning: TestSpecification[]) => {
    const rerunningIds = new Set(rerunning.map(spec => spec.moduleId));
    const all = await vitest.globTestSpecifications();
    return all.every(spec => rerunningIds.has(spec.moduleId));
  };

  // Vite+ owns the initial build. A watch process stays alive, so later reruns invoke that task here.
  project.onTestsRerun(async specs => {
    // Guarded so an ordinary rerun does not pay for the glob.
    if (pendingDelete && (await coversWholeSuite(specs))) cancelPendingDelete();
    rebuildWorkshopForWatch();
  });

  // Deleting a Worker input has to rerun the suite too, and `forceRerunTriggers` does not cover it:
  // vitest's `onFileDelete` invalidates its module state without ever consulting them (only the
  // change and create paths do). Rerunning by hand is the whole of the gap.
  const onUnlink = (path: string) => {
    if (!isWorkerInput(path)) return;
    cancelPendingDelete();
    pendingDelete = setTimeout(() => {
      pendingDelete = undefined;
      // `rerunTestSpecifications` awaits `onTestsRerun` handlers first, so the rebuild above
      // completes before any test file runs. A rejection here must not take the watch process down.
      vitest.globTestSpecifications()
        .then(specs => vitest.rerunTestSpecifications(specs, true))
        .catch((error: unknown) => {
          console.error("failed to rerun after a deleted Worker input:", error);
        });
    }, DELETE_DEBOUNCE_MS);
    // A pending rerun should never be the reason the process stays alive.
    pendingDelete.unref();
  };
  vitest.vite.watcher.on("unlink", onUnlink);

  return () => {
    cancelPendingDelete();
    vitest.vite.watcher.off("unlink", onUnlink);
    delete process.env.WORKSHOP_INTEGRATION_PREBUILT;
  };
}
