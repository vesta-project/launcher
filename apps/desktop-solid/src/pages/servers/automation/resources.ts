// Cached reads for the Automation tab, shared by the list, the editor, run history and the
// nav hover prefetch. See `loadWorkflowSummaries` for what each view is allowed to read.
import { toServerError } from '../../../features/servers/errors';
import { loadRunPage, loadWorkflowSummaries, type RunPageArgs, stepRows, type StepRow } from '../../../features/servers/automation-model';
import { invalidateServerResources, serverResource } from '../../../features/servers/resources';
import { serverCommand } from '../../../features/servers/store';
import type { ConnectionId } from '../../../features/servers/native';
import type { Paged, RunDetail, RunStep } from '../../../features/servers/native-automation';
import type { ServerUser } from '../../../features/servers/native-manage';

/** Workflow summaries, with their triggers. The list never reads definitions. */
export const workflowsResource = serverResource('automation-workflows', (id) =>
  serverCommand((client) => loadWorkflowSummaries(client, id)));

/** One workflow with its definition; read when it is opened or duplicated. */
export const workflowResource = serverResource('automation-workflow', (id, workflowId: string) =>
  serverCommand((client) => client.automationWorkflow(id, workflowId)));

/** One newest-first page of runs. Older pages are read only when asked for. */
export const runPageResource = serverResource('automation-runs', (id, args: RunPageArgs) =>
  serverCommand((client) => loadRunPage(client, id, args)));

/** A run's pinned definition joined with its attempts. `progress` changes as the run moves. */
export const runStepsResource = serverResource('automation-run', async (id, args: { runId: string; progress: string }): Promise<{ run: RunDetail; rows: StepRow[] }> => {
  const [run, attempts] = await Promise.all([
    serverCommand((client) => client.automationRun(id, args.runId)),
    serverCommand(async (client) => {
      const all: RunStep[] = [];
      let after: string | null = null;
      // 32 steps × 6 attempts fit in two pages.
      for (let page = 0; page < 2; page++) {
        const result: Paged<RunStep> = await client.automationRunSteps(id, args.runId, after);
        all.push(...result.items);
        if (!result.nextAfter) break;
        after = result.nextAfter;
      }
      return all;
    }),
  ]);
  return { run, rows: stepRows(run, attempts) };
});

/** The caller's own principal, to tell "you" from someone else. */
export const automationSelfResource = serverResource('automation-self', (id) =>
  serverCommand((client) => client.automationSelf(id)));

/**
 * People a workflow can run as. Only needed for names other than yours and for the editor's
 * "Run as" choice; a role that can't list users simply sees fewer names.
 */
export const automationUsersResource = serverResource('automation-users', async (id): Promise<ServerUser[]> => {
  const all: ServerUser[] = [];
  let offset: number | null = 0;
  try {
    for (let page = 0; offset !== null && page < 10; page++) {
      const result: { users: ServerUser[]; nextOffset: number | null } = await serverCommand((client) => client.users(id, offset!));
      all.push(...result.users);
      offset = result.nextOffset;
    }
  } catch (reason) {
    const code = toServerError(reason).code;
    if (code === 'forbidden' || code === 'not_found') return all;
    throw reason;
  }
  return all;
});

/** After a workflow mutation: the list and history revalidate; shown data stays meanwhile. */
export const invalidateAutomation = (id: ConnectionId, also: readonly string[] = []) =>
  invalidateServerResources(id, [workflowsResource.name, runPageResource.name, ...also]);
