import { navigate } from "../../app/router";
import type { PackSource } from "../../features/installation/install-service";
import type { PendingResourceInstall } from "../../features/browse/new-instance-install";
let pendingResource: PendingResourceInstall | undefined;
let pendingSource: PackSource | undefined;
/** One-shot handoff from the launcher-import page to archive installation. */
export function openInstallSource(source: PackSource) {
  pendingResource = undefined;
  pendingSource = source;
  navigate("/create");
}
export function takeInstallSource() {
  const source = pendingSource;
  pendingSource = undefined;
  return source;
}

/** Consumed by the mounted form; leaving it drops the unsubmitted resource. */
export function openResourceInstall(resource: PendingResourceInstall) {
  pendingSource = undefined;
  pendingResource = resource;
  navigate("/create");
}
export function takeResourceInstall() {
  const resource = pendingResource;
  pendingResource = undefined;
  return resource;
}
