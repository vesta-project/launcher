import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';

export function CreatePage() {
  return (
    <Board>
      <EmptyState
        icon="icons/actions/add"
        title={t('settings.new-instance-title')}
        description={t('settings.new-instance-description')}
      />
    </Board>
  );
}
