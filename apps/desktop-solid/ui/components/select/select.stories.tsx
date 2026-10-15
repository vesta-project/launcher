import { Button, Select, TextField, type ControlSize, type SelectOption } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, For } from 'solid-js';

const loaders: SelectOption[] = [
  { value: 'vanilla', label: 'Vanilla', description: 'No mod loader' },
  { value: 'fabric', label: 'Fabric', description: 'Lightweight, fast updates' },
  { value: 'quilt', label: 'Quilt', description: 'Fabric-compatible fork' },
  { value: 'forge', label: 'Forge', description: 'Large legacy mod ecosystem' },
  { value: 'neoforge', label: 'NeoForge', description: 'Modern Forge successor' },
];

const versions: SelectOption[] = ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'].map(
  (version) => ({ value: version, label: version }),
);

const column = { width: '260px' };

const Basic: Story = {
  render: () => {
    const [loader, setLoader] = createSignal('fabric');
    return (
      <Stack>
        <div style={column}>
          <Select label="Mod loader" options={loaders} value={loader()} onChange={setLoader} description="Changing loader rebuilds the instance." />
        </div>
        <div style={column}>
          <Select label="Game version" options={versions} placeholder="Choose a version" />
        </div>
      </Stack>
    );
  },
};

const States: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <Select label="Java runtime" options={[]} placeholder="No runtimes found" error="Install Java 21 to launch 1.21." />
      </div>
      <div style={column}>
        <Select label="Mod loader" options={loaders} defaultValue="forge" disabled />
      </div>
      <div style={column}>
        <Select
          label="Memory preset"
          options={[
            { value: 'low', label: 'Low (2 GB)' },
            { value: 'balanced', label: 'Balanced (4 GB)' },
            { value: 'high', label: 'High (8 GB)', disabled: true },
          ]}
          defaultValue="balanced"
        />
      </div>
    </Stack>
  ),
};

const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const InRow: Story = {
  description: 'Selects share the field box, so they line up with text fields and buttons of the same size.',
  render: () => (
    <Stack>
      <For each={sizes}>
        {(size) => (
          <Row label={size}>
            <TextField size={size} placeholder="Search mods" aria-label="Search mods" />
            <Select size={size} options={versions} defaultValue="1.21.4" aria-label="Game version" style={{ width: '120px' }} />
            <Button size={size}>Filter</Button>
          </Row>
        )}
      </For>
    </Stack>
  ),
};

export default {
  title: 'Controls/Select',
  description: 'A field whose box opens an overlay list; closed it matches text fields, open it matches menus.',
  stories: { Basic, States, InRow },
} satisfies StoryMeta;
