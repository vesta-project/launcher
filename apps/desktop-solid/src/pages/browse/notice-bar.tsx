import { createEffect, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { notice, setNotice } from '../../features/browse/browse-store';
import { t } from '../../localization';

/** Install outcomes and other short messages; each dismisses itself after a few seconds. */
export function NoticeBar() {
  createEffect(
    () => notice(),
    (current) => {
      if (!current) return;
      const timer = setTimeout(() => setNotice(undefined), 7000);
      return () => clearTimeout(timer);
    },
  );
  return (
    <Show when={notice()}>
      {(current) => (
        <p data-vesta="browse-notice" data-tone={current().tone} role="status">
          <span>{current().text}</span>
          <button
            type="button"
            data-vesta="browse-notice-close"
            aria-label={t('browse.dismiss')}
            onClick={() => setNotice(undefined)}
          >
            <Icon name="icons/actions/close" size={10} />
          </button>
        </p>
      )}
    </Show>
  );
}
