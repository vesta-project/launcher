import { navigate } from "../../app/router";
import type { PackSource } from "../../features/installation/install-service";
let pendingSource: PackSource | undefined;
/** One-shot handoff from the launcher-import page to archive installation. */
export function openInstallSource(source: PackSource) {
  pendingSource = source;
  navigate("/create");
}
export function takeInstallSource() {
  const source = pendingSource;
  pendingSource = undefined;
  return source;
}
