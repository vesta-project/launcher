import { For } from 'solid-js';
import art1 from '../../assets/images/placeholders/placeholder-image1.jpg';
import art2 from '../../assets/images/placeholders/placeholder-image2.png';
import art4 from '../../assets/images/placeholders/placeholder-image4.png';
import art5 from '../../assets/images/placeholders/placeholder-image5.png';
import { InstanceCard, type InstanceCardData } from '../../features/instances/instance-card';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';

const demos: { id: string; name: MessageId; minecraftVersion: string; modloader: string; image: string }[] = [
  { id: 'tour-world', name: 'tour.demo-world', minecraftVersion: '1.21.4', modloader: 'vanilla', image: art1 },
  { id: 'tour-farm', name: 'tour.demo-farm', minecraftVersion: '1.21.1', modloader: 'fabric', image: art2 },
  { id: 'tour-tech', name: 'tour.demo-tech', minecraftVersion: '1.21.1', modloader: 'neoforge', image: art4 },
  { id: 'tour-sky', name: 'tour.demo-sky', minecraftVersion: '1.20.1', modloader: 'forge', image: art5 },
];

/**
 * Pretend instances for the tour's library step, so a brand new (empty) library shows what it
 * will look like. They are the real card, laid out in the real grid, but inert and unsaved.
 */
export function TourDemoCards() {
  return (
    <ul data-vesta="library-grid" data-library-surface="main" data-tour-demo="" inert aria-hidden="true">
      <For each={demos}>
        {(demo, index) => {
          const instance: InstanceCardData = { ...demo, name: t(demo.name) };
          return (
            <li data-vesta="tour-demo-card" style={{ '--tour-demo-index': String(index()) }}>
              <div data-vesta="library-card-slot">
                <InstanceCard instance={instance} state={{ kind: 'idle' }} />
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
