import { For } from 'solid-js';
import { Button, IconButton, type ButtonVariant } from '@vesta/ui';
import type { ControlSize, Tone } from '@vesta/ui';
import { ChevronDownIcon, FolderIcon, PlayIcon, PlusIcon, SettingsIcon, TrashIcon } from '@workbench/icons';
import { Matrix, Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';


const tones: Tone[] = ['neutral', 'accent', 'danger', 'warning', 'success'];
const variants: ButtonVariant[] = ['solid', 'outline', 'ghost'];
const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const Variants: Story = {
  description: 'Every tone in every variant. Neutral solid is the default button.',
  render: () => (
    <Matrix
      rows={tones}
      cols={variants}
      render={(tone, variant) => (
        <Button tone={tone} variant={variant}>
          Button
        </Button>
      )}
    />
  ),
};

const Sizes: Story = {
  description: 'Heights come from --vesta-size-control-*; icon buttons stay square.',
  render: () => (
    <Stack>
      <For each={sizes}>{(size) => (
        <Row label={size}>
          <Button size={size}>Label</Button>
          <Button size={size} tone="accent" icon={<PlayIcon />}>
            Play
          </Button>
          <Button size={size} variant="outline" iconEnd={<ChevronDownIcon />}>
            Version
          </Button>
          <IconButton size={size} variant="ghost" icon={<SettingsIcon />} label="Settings" />
          <IconButton size={size} icon={<PlusIcon />} label="Add" />
        </Row>
      )}</For>
    </Stack>
  ),
};

const IconOnly: Story = {
  render: () => (
    <Matrix
      rows={tones}
      cols={variants}
      render={(tone, variant) => (
        <IconButton tone={tone} variant={variant} icon={<FolderIcon />} label="Open folder" />
      )}
    />
  ),
};

const Disabled: Story = {
  render: () => (
    <Row>
      <For each={variants}>{(variant) => (
        <Button variant={variant} tone="accent" disabled>
          {variant}
        </Button>
      )}</For>
      <IconButton icon={<TrashIcon />} label="Delete" tone="danger" variant="ghost" disabled />
    </Row>
  ),
};

const LongLabels: Story = {
  description: 'Labels never wrap; a constrained button truncates instead of growing taller.',
  render: () => (
    <Stack>
      <Row>
        <Button tone="accent">Installer les modules recommandés</Button>
        <Button>Einstellungen zurücksetzen</Button>
      </Row>
      <div style={{ width: '160px', display: 'flex' }}>
        <Button icon={<FolderIcon />}>Open the instance folder in the file manager</Button>
      </div>
    </Stack>
  ),
};

const InContext: Story = {
  description: 'Typical launcher compositions.',
  render: () => (
    <Stack gap={24}>
      <Row label="Toolbar">
        <Button tone="accent" size="lg" icon={<PlayIcon />}>
          Play
        </Button>
        <Button size="lg" variant="outline" iconEnd={<ChevronDownIcon />}>
          1.21.4 · Fabric
        </Button>
        <IconButton size="lg" variant="ghost" icon={<FolderIcon />} label="Open folder" />
        <IconButton size="lg" variant="ghost" icon={<SettingsIcon />} label="Instance settings" />
      </Row>
      <Row label="Dialog footer">
        <Button variant="ghost">Cancel</Button>
        <Button tone="danger" icon={<TrashIcon />}>
          Delete instance
        </Button>
      </Row>
      <Row label="Dense list">
        <Button size="sm" variant="ghost" icon={<PlusIcon />}>
          Add mod
        </Button>
        <Button size="sm" variant="ghost">
          Check for updates
        </Button>
        <IconButton size="sm" variant="ghost" tone="danger" icon={<TrashIcon />} label="Remove" />
      </Row>
    </Stack>
  ),
};

export default {
  title: 'Controls/Button',
  description: 'Three independent axes: variant (fill treatment), tone (meaning) and size (geometry).',
  stories: { Variants, Sizes, IconOnly, Disabled, LongLabels, InContext },
} satisfies StoryMeta;
