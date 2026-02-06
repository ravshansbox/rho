/**
 * Workspace resolution for Rho extensions.
 *
 * A workspace is a directory containing a .rho/ state dir.
 * Phase 1: Always resolves to ~/.rho/ (home workspace).
 * Phase 2 (future): Walk up from cwd looking for .rho/.
 *
 * Has a no-op default export so pi can load it as an extension without error.
 */
import * as path from "node:path";
import * as os from "node:os";

const HOME_RHO = path.join(os.homedir(), ".rho");

// Phase 1: always home. Phase 2 will add walk-up resolution.
export function getWorkspaceRoot(): string {
  return os.homedir();
}

export function rhoDir(): string {
  return HOME_RHO;
}

export function brainDir(): string {
  return path.join(HOME_RHO, "brain");
}

export function vaultDir(): string {
  return path.join(HOME_RHO, "vault");
}

export function resultsDir(): string {
  return path.join(HOME_RHO, "results");
}

export function tasksFile(): string {
  return path.join(HOME_RHO, "tasks.jsonl");
}

export function stateFile(): string {
  return path.join(HOME_RHO, "rho-state.json");
}

export function configFile(): string {
  return path.join(HOME_RHO, "config.json");
}

// No-op extension export -- pi loads all .ts files in extensions/
export default function () {}
