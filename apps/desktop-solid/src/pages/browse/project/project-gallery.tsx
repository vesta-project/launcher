import { ImageViewer } from '@vesta/ui';
import { createSignal, For } from 'solid-js';
import type { ResourceProject } from '../../../features/browse/browse-model';
import { t } from '../../../localization';
import { failed, loaded } from './project-shared';

/** The project's screenshots as an even grid of thumbnails; any opens the full viewer. */
export function ProjectGallery(props: { project: ResourceProject }) {
  const [viewing, setViewing] = createSignal<number | undefined>(undefined, { name: 'projectGalleryIndex' });
  const images = () => props.project.gallery.map((src) => ({ src }));
  return (
    <>
      <ul data-vesta="project-gallery" aria-label={t('browse.tab-gallery')}>
        <For each={props.project.gallery}>
          {(src, index) => (
            <li>
              <button
                type="button"
                data-vesta="project-gallery-item"
                aria-label={t('browse.gallery-open', { count: index() + 1 })}
                onClick={() => setViewing(index())}
              >
                <img src={src} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={failed} />
              </button>
            </li>
          )}
        </For>
      </ul>
      <ImageViewer
        open={viewing() !== undefined}
        onOpenChange={(open) => !open && setViewing(undefined)}
        images={images()}
        index={viewing() ?? 0}
        onIndexChange={setViewing}
      />
    </>
  );
}
