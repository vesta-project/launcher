import { NumberField, TextField, type ControlSize } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, For } from 'solid-js';

const column = { width: '220px' };
const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const Basic: Story = {
  render: () => {
    const [ram, setRam] = createSignal(4096);
    return (
      <Stack>
        <div style={column}>
          <NumberField
            label="Allocated memory (MB)"
            value={ram()}
            onChange={setRam}
            min={1024}
            max={32768}
            step={512}
            description="Step with the buttons or arrow keys."
          />
        </div>
        <div style={column}>
          <NumberField label="Concurrent downloads" defaultValue={3} min={1} max={16} />
        </div>
      </Stack>
    );
  },
};

const States: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <NumberField label="Port" defaultValue={25565} error="Port is already in use." />
      </div>
      <div style={column}>
        <NumberField label="Width" defaultValue={1920} disabled />
      </div>
      <div style={column}>
        <NumberField label="No steppers" defaultValue={8} hideSteppers />
      </div>
    </Stack>
  ),
};

const InRow: Story = {
  description: 'Shares the field box so it lines up with text fields of the same size.',
  render: () => (
    <Stack>
      <For each={sizes}>
        {(size) => (
          <Row label={size}>
            <TextField size={size} placeholder="Instance name" aria-label="Instance name" />
            <NumberField size={size} defaultValue={4096} aria-label="Memory" style={{ width: '120px' }} />
          </Row>
        )}
      </For>
    </Stack>
  ),
};

export default {
  title: 'Controls/Number field',
  description: 'Numeric input with optional steppers inside the shared field box.',
  stories: { Basic, States, InRow },
} satisfies StoryMeta;
