import { TextArea } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const column = { width: '360px' };

function ControlledStory() {
  const [notes, setNotes] = createSignal('Prefer Fabric 1.21.4.\nKeep memory at 6 GB.');
  return (
    <div style={column}>
      <TextArea
        label="Pack notes"
        description="Shown on the instance overview."
        value={notes()}
        onChange={setNotes}
        rows={4}
      />
    </div>
  );
}

const Basic: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <TextArea label="Description" placeholder="What is this instance for?" rows={3} />
      </div>
      <ControlledStory />
      <div style={column}>
        <TextArea label="Java arguments" defaultValue="-Xmx4G" error="Unknown flag." rows={2} />
      </div>
      <div style={column}>
        <TextArea label="Read-only log" defaultValue="Launch OK\nMods loaded: 42" readOnly rows={3} />
      </div>
    </Stack>
  ),
};

export default {
  title: 'Controls/Text area',
  description: 'Multiline field sharing the labelled field shell with text inputs.',
  stories: { Basic },
} satisfies StoryMeta;
