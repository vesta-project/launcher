import { Button } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import type { Story, StoryMeta } from '@workbench/story';
import { EmptyLine, EmptyState } from './empty-state';
import { Icon } from './icon';

/** A stand-in for the board/panel an empty state replaces the content of. */
function Surface(props: { height?: number; toolbar?: boolean; children: JSX.Element }) {
  return (
    <div
      style={{
        'inline-size': '720px',
        'min-block-size': `${props.height ?? 260}px`,
        'border-radius': 'var(--vesta-radius-container)',
        background: 'var(--vesta-color-panel)',
        border: 'var(--vesta-border-width) solid var(--vesta-color-border)',
        overflow: 'hidden',
      }}
    >
      {props.toolbar ? (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '8px 16px',
            'border-block-end': 'var(--vesta-border-width) solid var(--vesta-color-border)',
          }}
        >
          <Button size="sm" variant="outline">Filter</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />}>Add</Button>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

const Page: Story = {
  description: 'Replaces a whole board. Starts at the page gutter, where the grid would.',
  render: () => (
    <Surface height={320}>
      <EmptyState
        icon="icons/rail/servers"
        title="No servers yet"
        description="Connect to a server running Vesta using its address and a pairing code from the server, or your Minecraft account."
      >
        <Button tone="accent" icon={<Icon name="icons/actions/add" />}>Add server</Button>
      </EmptyState>
    </Surface>
  ),
};

const FirstRun: Story = {
  name: 'Page with suggestions',
  description: 'The first-run library: every way an instance can arrive, in place of one Create button.',
  render: () => (
    <Surface height={460}>
      <EmptyState
        icon="icons/rail/library"
        title="No instances yet"
        description="Instances you create or import appear here. Each one keeps its own Minecraft version, mods and worlds."
        suggestionsLabel="Get started"
        suggestions={[
          { icon: 'icons/actions/add', label: 'Create a new instance', description: 'Pick a Minecraft version and modloader.', onSelect: () => {} },
          { icon: 'icons/content/modpack', label: 'Install a modpack', description: 'Browse ready-made packs from Modrinth and CurseForge.', onSelect: () => {} },
          { icon: 'icons/actions/move', label: 'Import from another launcher', description: 'Bring over instances from Prism, MultiMC, CurseForge and others.', onSelect: () => {} },
          { icon: 'icons/content/file', label: 'Import a modpack file', description: 'Open a .mrpack or .zip you already have.', onSelect: () => {} },
        ]}
      />
    </Surface>
  ),
};

const Suggestions: Story = {
  description: 'Several ways to start. Rows instead of one loud button; the first-run library and automation use this.',
  render: () => (
    <Surface height={420} toolbar>
      <EmptyState
        variant="inline"
        icon="icons/content/timer"
        title="No workflows yet"
        description="Workflows run on a schedule or when something happens on the server."
        suggestionsLabel="Start from a template"
        suggestions={[
          { icon: 'icons/content/storage', label: 'Nightly backup', description: 'Back up the world every night at 04:00.', onSelect: () => {} },
          { icon: 'icons/actions/reload', label: 'Restart every 12 hours', description: 'Warn players, then restart Minecraft.', onSelect: () => {} },
          { icon: 'icons/content/chat', label: 'Announce on first join', description: 'Greet players the first time they join.', onSelect: () => {} },
          { icon: 'icons/actions/add', label: 'Blank workflow', onSelect: () => {} },
        ]}
      />
    </Surface>
  ),
};

const Inline: Story = {
  description: 'Replaces a list or panel body under its toolbar. Icon beside the text, aligned with the rows.',
  render: () => (
    <Surface toolbar>
      <EmptyState
        variant="inline"
        icon="icons/content/layers"
        title="No matching resources"
        description="Try another name or author."
      >
        <Button size="sm" variant="outline">Clear search</Button>
      </EmptyState>
    </Surface>
  ),
};

const Line: Story = {
  description: 'Menus, popovers, pickers and small lists: one muted line.',
  render: () => (
    <div style={{ 'inline-size': '320px', background: 'var(--vesta-color-surface-raised)', 'border-radius': 'var(--vesta-radius-container)' }}>
      <EmptyLine>No notifications</EmptyLine>
    </div>
  ),
};

export default {
  title: 'Launcher/EmptyState',
  description: 'What a surface shows before it has content: what will appear, and the next step.',
  stories: { Page, FirstRun, Suggestions, Inline, Line },
} satisfies StoryMeta;
