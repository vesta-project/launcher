import { For } from 'solid-js';
import { Row } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import art1 from '../../assets/images/placeholders/placeholder-image1.jpg';
import art2 from '../../assets/images/placeholders/placeholder-image2.png';
import art3 from '../../assets/images/placeholders/placeholder-image3.png';
import art4 from '../../assets/images/placeholders/placeholder-image4.png';
import { InstanceCard, type InstanceCardData, type InstanceCardState } from './instance-card';

const base: InstanceCardData = { id: 'survival', name: 'Survival', minecraftVersion: '1.21.4', modloader: 'fabric', image: art1 };

const states: { title: string; state: InstanceCardState; instance?: Partial<InstanceCardData> }[] = [
  { title: 'Idle', state: { kind: 'idle' } },
  { title: 'Running', state: { kind: 'running' }, instance: { image: art2, name: 'Create Skyblock', modloader: 'forge', minecraftVersion: '1.20.1' } },
  { title: 'Warming up', state: { kind: 'warming' } },
  { title: 'Installation interrupted', state: { kind: 'interrupted', label: 'Installation' }, instance: { image: art3, name: 'Vanilla Snapshot', modloader: 'vanilla', minecraftVersion: '24w44a' } },
  { title: 'Interrupted', state: { kind: 'interrupted', label: 'Update' }, instance: { image: art4, name: 'Old Friends Pack', modloader: 'quilt', minecraftVersion: '1.12.2' } },
  { title: 'Recovery needed', state: { kind: 'interrupted', label: 'Update', recovery: true } },
  { title: 'Resuming', state: { kind: 'interrupted', label: 'Update', resuming: true } },
  { title: 'Crashed', state: { kind: 'crashed', summary: 'java.lang.OutOfMemoryError: Java heap space' }, instance: { image: art2 } },
  { title: 'Installing', state: { kind: 'installing', label: 'Installing' } },
  { title: 'Install failed', state: { kind: 'failed', reason: 'Could not download Fabric loader 0.16.9: connection reset by peer' } },
  { title: 'Retrying', state: { kind: 'failed', reason: 'Network timeout', retrying: true } },
];

const States: Story = {
  description: 'Play appears on hover or keyboard focus. Failed and interrupted use the same overlay.',
  render: () => (
    <Row>
      <For each={states}>
        {(entry) => (
          <div style={{ width: '200px', display: 'grid', gap: '6px' }}>
            <span style={{ 'font-size': 'var(--vesta-text-xs)', color: 'var(--vesta-color-text-muted)' }}>{entry.title}</span>
            <InstanceCard instance={{ ...base, ...entry.instance }} state={entry.state} />
          </div>
        )}
      </For>
    </Row>
  ),
};

const Actions: Story = {
  description: 'Right-click a card for the menu. Clicking the play button does not open the card; crashed cards open crash details.',
  render: () => (
    <div style={{ width: '200px' }}>
      <InstanceCard
        instance={base}
        state={{ kind: 'idle' }}
        onPlay={() => {}}
        onOpen={() => {}}
        onTogglePin={() => {}}
        onUninstall={() => {}}
      />
    </div>
  ),
};

const Readability: Story = {
  description: 'Normal and crashed instances on each artwork. Compare light and dark schemes.',
  render: () => (
    <Row>
      <For each={[art1, art2, art3, art4]}>
        {(image) => (
          <div style={{ width: '200px', display: 'grid', gap: '12px' }}>
            <InstanceCard instance={{ ...base, image }} />
            <InstanceCard
              instance={{ ...base, image }}
              state={{ kind: 'crashed', summary: 'java.lang.OutOfMemoryError: Java heap space' }}
            />
          </div>
        )}
      </For>
    </Row>
  ),
};

export default {
  title: 'Launcher/Instance card',
  description: 'Instance tile carried over from the old launcher, state for state.',
  stories: { States, Actions, Readability },
} satisfies StoryMeta;
