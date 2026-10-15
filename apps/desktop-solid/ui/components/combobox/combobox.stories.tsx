import { Combobox, type ComboboxOption } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const versions: ComboboxOption[] = [
  '1.21.4',
  '1.21.3',
  '1.21.1',
  '1.20.6',
  '1.20.4',
  '1.20.1',
  '1.19.4',
  '1.18.2',
  '1.16.5',
  '1.12.2',
].map((version) => ({ value: version, label: version }));

const loaders: ComboboxOption[] = [
  { value: 'vanilla', label: 'Vanilla', description: 'No mod loader' },
  { value: 'fabric', label: 'Fabric', description: 'Lightweight, fast updates' },
  { value: 'quilt', label: 'Quilt', description: 'Fabric-compatible fork' },
  { value: 'forge', label: 'Forge', description: 'Large legacy mod ecosystem' },
  { value: 'neoforge', label: 'NeoForge', description: 'Modern Forge successor' },
];

const column = { width: '280px' };

const Basic: Story = {
  description: 'Type to filter; the list reuses select/menu styling.',
  render: () => {
    const [version, setVersion] = createSignal('1.21.4');
    return (
      <Stack>
        <div style={column}>
          <Combobox label="Game version" options={versions} value={version()} onChange={setVersion} placeholder="Search versions" />
        </div>
        <div style={column}>
          <Combobox label="Mod loader" options={loaders} defaultValue="fabric" description="Changing loader rebuilds the instance." />
        </div>
      </Stack>
    );
  },
};

const States: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <Combobox label="Java runtime" options={[]} placeholder="No runtimes found" error="Install Java 21 to launch 1.21." />
      </div>
      <div style={column}>
        <Combobox label="Game version" options={versions} defaultValue="1.20.1" disabled />
      </div>
    </Stack>
  ),
};

export default {
  title: 'Controls/Combobox',
  description: 'A searchable field that filters an overlay list; closed it matches text fields, open it matches selects.',
  stories: { Basic, States },
} satisfies StoryMeta;
