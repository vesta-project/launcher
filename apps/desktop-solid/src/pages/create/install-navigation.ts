import { navigate } from "../../app/router";
import { createSignal } from 'solid-js';
import type { PackSource } from "../../features/installation/install-service";
import type { PendingResourceInstall } from "../../features/browse/new-instance-install";
let pendingResource: PendingResourceInstall | undefined;
/** Resolve provider metadata inside the destination, so navigation never waits on IPC. */
export type InstallSourceHandoff = PackSource | (() => Promise<PackSource>);
let pendingSource: InstallSourceHandoff | undefined;

export type CreateAction = 'new' | 'methods' | 'file' | 'launchers';
let pendingAction: CreateAction | undefined;
const [actionRevision, setActionRevision] = createSignal(0, { name: 'createActionRevision' });
/** An explicit intent also works when Create is already mounted at the same URL. */
export const createActionKey = () => `create:${actionRevision()}`;
export function requestCreateAction(action: CreateAction) {
  pendingSource = undefined;
  pendingResource = undefined;
  pendingAction = action;
  setActionRevision((value) => value + 1);
  navigate('/create');
}
export function takeCreateAction() {
  const action = pendingAction;
  pendingAction = undefined;
  return action;
}
/** One-shot handoff from the launcher-import page to archive installation. */
export function openInstallSource(source: InstallSourceHandoff) {
  pendingAction = undefined;
  pendingResource = undefined;
  pendingSource = source;
  setActionRevision((value) => value + 1);
  navigate("/create");
}
export function takeInstallSource() {
  const source = pendingSource;
  pendingSource = undefined;
  return source;
}

/** Consumed by the mounted form; leaving it drops the unsubmitted resource. */
export function openResourceInstall(resource: PendingResourceInstall) {
  pendingAction = undefined;
  pendingSource = undefined;
  pendingResource = resource;
  setActionRevision((value) => value + 1);
  navigate("/create");
}
export function takeResourceInstall() {
  const resource = pendingResource;
  pendingResource = undefined;
  return resource;
}
