import { instanceSlug } from '../instances/native-model';

export type NotificationDestination = { route: string } | { url: string };
type InstanceIdentity = { id: string | number; name: string };

/** Translate the known old mini-router destinations at the UI boundary; stored actions stay intact. */
export function notificationDestination(
  payload: Record<string, unknown>,
  instances: readonly InstanceIdentity[],
): NotificationDestination | undefined {
  const path = payload.path;
  if (typeof path !== 'string') return;
  // Do not silently send unsupported routes to Library via the router's default fallback.
  if (/^\/(library|browse|create|settings)(\/|$)/.test(path)) return { route: path };
  const params = payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  if (path === '/config') return { route: '/settings' };
  if (path === '/install' || path === '/install/import') return { route: '/create' };
  if (path === '/changelog') return { url: 'https://github.com/vesta-project/launcher/releases' };
  if (path === '/instance') {
    const matches = instances.filter((item) => params.id != null
      ? String(item.id) === String(params.id)
      : typeof params.slug === 'string' && instanceSlug(item.name) === params.slug);
    if (matches.length !== 1) return;
    return { route: `/library/${encodeURIComponent(String(matches[0]!.id))}` };
  }
  if (path === '/resources') {
    const id = params.instanceId;
    const instance = id == null ? undefined : instances.find((item) => String(item.id) === String(id));
    return { route: instance ? `/browse/for/${encodeURIComponent(String(instance.id))}` : '/browse' };
  }
  if (path === '/resource-details') {
    const source = params.platform;
    const id = params.projectId;
    if ((source === 'modrinth' || source === 'curseforge' || source === 'smithed') && typeof id === 'string' && id)
      return { route: `/browse/project/${source}/${encodeURIComponent(id)}` };
  }
}
