import { Button, Dialog, Select } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { instances } from '../instances/catalog';
import { t } from '../../localization';
import { cancelSyncSourceRequest, confirmSyncSource, syncSourceRequest } from './sync';

/** Initializing a shared bundle needs a deliberate source; never seed from an arbitrary instance. */
export function SyncSourceDialog() {
  return <Show when={syncSourceRequest()} keyed>{(_id) => {
    const [source, setSource] = createSignal('', { name: 'syncInitialSource' });
    const options = () => instances().filter((entry) => entry.state.kind === 'idle').map((entry) => ({
      value: entry.instance.id, label: entry.instance.name,
    }));
    return <Dialog open onOpenChange={(open) => { if (!open) cancelSyncSourceRequest(); }}
      title={t('prefs.sync.source-title')}
      description={t('prefs.sync.source-description')}
      footer={<><Button variant="ghost" onClick={cancelSyncSourceRequest}>{t('common.cancel')}</Button>
        <Button disabled={!options().some((item) => item.value === source())} onClick={() => void confirmSyncSource(source())}>{t('prefs.done')}</Button></>}>
      <Show when={options().length} fallback={<p>{t('prefs.sync.source-none')}</p>}>
        <Select label={t('prefs.sync.source-label')} value={source()} options={options()} onChange={setSource} />
      </Show>
    </Dialog>;
  }}</Show>;
}
