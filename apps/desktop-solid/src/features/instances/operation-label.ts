import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';

/**
 * Instance state labels come from two places: the backend's operation ids ("install", "update",
 * "external-import") and the frontend's own display words ("Installing", "Resuming"). Both are
 * shown as titles, so known operations get their localized word and anything else is sentence-cased.
 */
const active: Record<string, MessageId> = {
  install: 'instance.op.installing',
  installing: 'instance.op.installing',
  update: 'instance.op.updating',
  updating: 'instance.op.updating',
  repair: 'instance.op.repairing',
  repairing: 'instance.op.repairing',
  'external-import': 'instance.op.importing',
  import: 'instance.op.importing',
  importing: 'instance.op.importing',
};

const noun: Record<string, MessageId> = {
  install: 'instance.op.install',
  installing: 'instance.op.install',
  update: 'instance.op.update',
  updating: 'instance.op.update',
  repair: 'instance.op.repair',
  repairing: 'instance.op.repair',
  'external-import': 'instance.op.import',
  import: 'instance.op.import',
  importing: 'instance.op.import',
};

const sentence = (label: string) => {
  const text = label.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The running operation, e.g. "Installing". */
export const activeOperationLabel = (label: string | undefined) => {
  const id = label ? active[label.trim().toLowerCase()] : undefined;
  return id ? t(id) : sentence(label || t('instance.op.installing'));
};

/** The operation as a noun, e.g. "Install" in "Install was interrupted". */
export const operationLabel = (label: string | undefined) => {
  const id = label ? noun[label.trim().toLowerCase()] : undefined;
  return id ? t(id) : sentence(label || t('instance.op.install'));
};
