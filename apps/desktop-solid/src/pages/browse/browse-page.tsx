import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';

export function BrowsePage() {
  return (
    <Board>
      <EmptyState
        icon="icons/content/search"
        title={t('settings.browse-coming-title')}
        description={t('settings.browse-coming-description')}
      />
    </Board>
  );
}
