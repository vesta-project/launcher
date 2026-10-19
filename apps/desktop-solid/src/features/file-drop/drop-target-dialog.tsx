import { Button, Dialog, Select } from '@vesta/ui';
import { createSignal } from 'solid-js';
import { nativeEntries } from '../instances/native-service';
import { importNativePaths } from '../instances/native-import-dialog';
import { navigate } from '../../app/router';
import { openInstallSource } from '../../pages/create/install-navigation';
import { t } from '../../localization';

const [paths, setPaths] = createSignal<string[]>([]);
export function reviewUntargetedDrop(value: string[]) { setPaths(value); }
/** A drop never guesses which instance should receive local files. */
export function DropTargetDialog() {
  const [target, setTarget] = createSignal('');
  const close = () => { setPaths([]); setTarget(''); };
  const submit = () => {
    const files = paths(), id = target();
    if (id === 'modpack' && files.length === 1) {
      close(); openInstallSource({ kind: 'file', value: files[0]! });
    } else if (id) {
      void importNativePaths(id, files); close(); navigate(`/library/${id}/resources`);
    }
  };
  return <Dialog open={paths().length > 0} title={t('drop.review')} onOpenChange={(open) => { if (!open) close(); }}
    footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button tone="accent" disabled={!target()} onClick={submit}>{t('install.import-action')}</Button></>}>
    <Select aria-label={t('drop.target')} placeholder={t('drop.choose-target')} value={target()} onChange={setTarget}
      options={[
        ...(paths().length === 1 && /\.(zip|mrpack)$/i.test(paths()[0]!) ? [{ value: 'modpack', label: t('install.import') }] : []),
        ...nativeEntries().filter((entry) => !['running', 'warming', 'installing'].includes(entry.state.kind)).map((entry) => ({ value: entry.instance.id, label: entry.instance.name })),
      ]} />
  </Dialog>;
}
