import { Checkbox } from '@vesta/ui';
import type { ControlSize } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, For } from 'solid-js';

const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const States: Story = {
  render: () => (
    <Stack gap={12}>
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Indeterminate" indeterminate />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled, checked" disabled defaultChecked />
      <Checkbox label="Read only, checked" readOnly defaultChecked />
      <Checkbox label="Accept the EULA" error="You must accept the EULA to continue." />
      <Checkbox
        label="Keep launcher open"
        description="The launcher stays in the background while the game runs."
        defaultChecked
      />
    </Stack>
  ),
};

const Sizes: Story = {
  description: 'The box follows --vesta-size-icon-*; the label text steps down at sm.',
  render: () => (
    <Stack>
      <For each={sizes}>{(size) => (
        <Row label={size} gap={24}>
          <Checkbox size={size} label="Unchecked" />
          <Checkbox size={size} label="Checked" defaultChecked />
          <Checkbox size={size} label="Mixed" indeterminate />
        </Row>
      )}</For>
    </Stack>
  ),
};

const Controlled: Story = {
  description: 'A "select all" parent shows the indeterminate state while only some children are checked.',
  render: () => {
    const options = ['Sodium', 'Lithium', 'Iris Shaders'];
    const [selected, setSelected] = createSignal<string[]>(['Sodium'], { name: 'selected' });
    const all = () => selected().length === options.length;
    const some = () => selected().length > 0 && !all();
    const toggle = (option: string, on: boolean) =>
      setSelected((list) => (on ? [...list, option] : list.filter((o) => o !== option)));

    return (
      <Stack gap={8}>
        <Checkbox
          label="Select all mods"
          checked={all()}
          indeterminate={some()}
          onChange={(on) => setSelected(on ? options : [])}
        />
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-inline-start': '24px' }}>
          <For each={options}>{(option) => (
            <Checkbox label={option} checked={selected().includes(option)} onChange={(on) => toggle(option, on)} />
          )}</For>
        </div>
      </Stack>
    );
  },
};

const LongLabel: Story = {
  description: 'The label wraps in its own column and the box stays centred on the first line.',
  render: () => (
    <Stack gap={12}>
      <div style={{ width: '260px' }}>
        <Checkbox
          label="Automatically download and install recommended performance mods whenever a new instance is created"
          defaultChecked
        />
      </div>
      <div style={{ width: '260px' }}>
        <Checkbox
          size="lg"
          label="Share anonymous crash reports with the Vesta team to help us fix problems faster"
          description="Reports never include your account name, file paths or world data."
        />
      </div>
    </Stack>
  ),
};

export default {
  title: 'Controls/Checkbox',
  description: 'Tone-coloured when checked; shares the label, description and error layout with the switch.',
  stories: { States, Sizes, Controlled, LongLabel },
} satisfies StoryMeta;
