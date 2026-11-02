import { navigate } from "../../app/router";
import { createSignal } from 'solid-js';
import type { PackSource } from "../../features/installation/install-service";
import type { ResourceProject } from "../../features/browse/browse-model";
import type { PendingResourceInstall } from "../../features/browse/new-instance-install";
let pendingResource: PendingResourceInstall | undefined;
/** Resolve provider metadata inside the destination, so navigation never waits on IPC. */
export type InstallSourceHandoff = PackSource | (() => Promise<PackSource>);
let pendingSource: InstallSourceHandoff | undefined;
let pendingListing: ResourceProject | undefined;

export type CreateAction = 'new' | 'methods' | 'file' | 'launchers';
let pendingAction: CreateAction | undefined;
const [actionRevision, setActionRevision] = createSignal(0, { name: 'createActionRevision' });
/** An explicit intent also works when Create is already mounted at the same URL. */
export const createActionKey = () => `create:${actionRevision()}`;
export function requestCreateAction(action: CreateAction) {
  pendingServer = undefined;
  pendingSource = undefined; pendingListing = undefined;
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
export function openInstallSource(source: InstallSourceHandoff, listing?: ResourceProject) {
  pendingServer = undefined;
  pendingAction = undefined;
  pendingResource = undefined;
  pendingSource = source;
  pendingListing = listing;
  setActionRevision((value) => value + 1);
  navigate("/create");
}
export function takeInstallSource() {
  const source = pendingSource;
  pendingSource = undefined;
  return source;
}
/** A Modrinth server listing the pack from openInstallSource should follow once created. */
export function takeServerListing() {
  const listing = pendingListing;
  pendingListing = undefined;
  return listing;
}

/** Consumed by the mounted form; leaving it drops the unsubmitted resource. */
export function openResourceInstall(resource: PendingResourceInstall) {
  pendingServer = undefined;
  pendingAction = undefined;
  pendingSource = undefined; pendingListing = undefined;
  pendingResource = resource;
  setActionRevision((value) => value + 1);
  navigate("/create");
}
export function takeResourceInstall() {
  const resource = pendingResource;
  pendingResource = undefined;
  return resource;
}

let pendingServer: string | undefined;
export function openServerInstall(connectionId: string) {
  pendingSource = undefined; pendingListing = undefined; pendingResource = undefined; pendingAction = undefined;
  pendingServer = connectionId;
  setActionRevision(value => value + 1); navigate('/create');
}
export function takeServerInstall() { const id = pendingServer; pendingServer = undefined; return id; }
