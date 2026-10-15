import { Switch } from '@vesta/ui';
import type { ControlSize } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { For } from 'solid-js';

const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const States: Story = {
  render: () => (
    <Stack gap={12}>
      <Switch label="Off" />
      <Switch label="On" defaultChecked />
      <Switch label="Disabled" disabled />
      <Switch label="Disabled, on" disabled defaultChecked />
      <Switch label="Read only, on" readOnly defaultChecked />
      <Switch label="Use beta channel" error="Beta builds are unavailable for this instance." />
      <Switch
        label="Show snapshots"
        description="Include development snapshots in the version list."
        defaultChecked
      />
    </Stack>
  ),
};

const Sizes: Story = {
  description: 'Track and thumb sizes are knobs; the thumb is always the track height minus the padding.',
  render: () => (
    <Stack>
      <For each={sizes}>{(size) => (
        <Row label={size} gap={24}>
          <Switch size={size} label="Off" />
          <Switch size={size} label="On" defaultChecked />
        </Row>
      )}</For>
    </Stack>
  ),
};

const SettingsList: Story = {
  description: 'A compact launcher settings list.',
  render: () => (
    <div style={{ width: '340px' }}>
      <Stack gap={12}>
        <Switch
          label="Close launcher when game starts"
          description="Reopens automatically when the game exits."
        />
        <Switch
          label="Show snapshots"
          description="Include development snapshots in the version list."
          defaultChecked
        />
        <Switch
          label="Hardware acceleration"
          description="Use the GPU to draw the launcher. Restart required."
          defaultChecked
        />
        <Switch
          label="Check for updates on startup"
          description="Looks for a new launcher version each time it opens."
          defaultChecked
        />
      </Stack>
    </div>
  ),
};

export default {
  title: 'Controls/Switch',
  description: 'Immediate on/off setting. Use a checkbox when the choice is applied later, e.g. on form submit.',
  stories: { States, Sizes, SettingsList },
} satisfies StoryMeta;
