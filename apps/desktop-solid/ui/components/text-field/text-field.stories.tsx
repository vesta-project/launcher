import { Button, IconButton, TextField } from '@vesta/ui';
import type { ControlSize } from '@vesta/ui';
import { FolderIcon, SearchIcon } from '@workbench/icons';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, For } from 'solid-js';


const sizes: ControlSize[] = ['sm', 'md', 'lg'];
const column = { width: '280px' };

const States: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <TextField label="Instance name" placeholder="My survival world" />
      </div>
      <div style={column}>
        <TextField label="Java arguments" defaultValue="-Xmx4G" description="Passed to the JVM when the game starts." />
      </div>
      <div style={column}>
        <TextField label="Instance name" defaultValue="survival/1" error="Names cannot contain “/”." />
      </div>
      <div style={column}>
        <TextField label="Game directory" defaultValue="~/Vesta/instances/survival" readOnly />
      </div>
      <div style={column}>
        <TextField label="Server address" placeholder="play.example.net" disabled />
      </div>
    </Stack>
  ),
};

const Controlled: Story = {
  render: () => {
    const [name, setName] = createSignal('Survival');
    const error = () => (name().trim() === '' ? 'A name is required.' : undefined);
    return (
      <div style={column}>
        <TextField label="Instance name" value={name()} onChange={setName} error={error()} required />
      </div>
    );
  },
};

const SizesWithButtons: Story = {
  description: 'Fields and buttons of the same size share a height, so mixed rows align.',
  render: () => (
    <Stack>
      <For each={sizes}>{(size) => (
        <Row label={size}>
          <TextField size={size} icon={<SearchIcon />} placeholder="Search mods" aria-label="Search mods" />
          <Button size={size} tone="accent">
            Search
          </Button>
          <IconButton size={size} variant="outline" icon={<FolderIcon />} label="Browse" />
        </Row>
      )}</For>
    </Stack>
  ),
};

export default {
  title: 'Controls/Text field',
  description: 'Label, control box, description and error share the field anatomy used by all form controls.',
  stories: { States, Controlled, SizesWithButtons },
} satisfies StoryMeta;
