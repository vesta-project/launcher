import { Button, IconButton, Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { findInstance, playInstance } from '../../features/instances/fixtures';
import './instance-page.css';

const tabs = [
  { id: 'overview', label: 'Overview', icon: 'icons/content/cube', text: 'Playtime, last launch and quick actions will show here.' },
  { id: 'mods', label: 'Mods', icon: 'icons/content/layers', text: 'Installed mods, updates and dependencies.' },
  { id: 'resources', label: 'Resource packs', icon: 'icons/content/resource-pack', text: 'Resource packs and shaders for this instance.' },
  { id: 'worlds', label: 'Worlds', icon: 'icons/content/globe', text: 'Saved worlds, with backup and transfer.' },
  { id: 'logs', label: 'Logs', icon: 'icons/content/terminal', text: 'Game output and crash details.' },
];

/** One instance: art banner with its main actions, then tabbed content. */
export function InstancePage(props: { id: string }) {
  const entry = () => findInstance(props.id);

  return (
    <Show
      when={entry()}
      fallback={
        <Board>
          <EmptyState icon="icons/content/search" title="Instance not found" description="It may have been removed. Go back to the library to pick another." />
        </Board>
      }
    >
      {(found) => {
        const running = () => found().state.kind === 'running';
        const starting = () => found().state.kind === 'warming';
        return (
          <Board>
            <header data-vesta="instance-hero" style={{ '--hero-image': `url('${found().instance.image}')` } as never}>
              <div data-vesta="instance-hero-copy">
                <h1 data-vesta="instance-hero-title">{found().instance.name}</h1>
                <p data-vesta="instance-hero-meta">
                  {found().instance.minecraftVersion} · <span data-vesta="instance-hero-loader">{found().instance.modloader}</span>
                </p>
              </div>
              <div data-vesta="instance-hero-actions">
                <Button
                  tone={running() ? 'danger' : 'accent'}
                  disabled={starting()}
                  icon={<Icon name={running() ? 'icons/actions/stop' : 'icons/actions/play'} size={14} />}
                  onClick={() => playInstance(found().instance.id)}
                >
                  {running() ? 'Stop' : starting() ? 'Starting…' : 'Play'}
                </Button>
                <IconButton variant="outline" label="Open folder" icon={<Icon name="icons/content/folder" size={14} />} />
                <IconButton variant="outline" label="Instance settings" icon={<Icon name="icons/content/sliders" size={14} />} />
              </div>
            </header>

            <Tabs defaultValue="overview" class="instance-tabs">
              <TabList aria-label="Instance sections">
                <For each={tabs}>{(tab) => <Tab value={tab.id}>{tab.label}</Tab>}</For>
              </TabList>
              <For each={tabs}>
                {(tab) => (
                  <TabPanel value={tab.id}>
                    <EmptyState icon={tab.icon} title={tab.label} description={tab.text} />
                  </TabPanel>
                )}
              </For>
            </Tabs>
          </Board>
        );
      }}
    </Show>
  );
}
