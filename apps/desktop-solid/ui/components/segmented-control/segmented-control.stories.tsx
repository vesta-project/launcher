import { Button } from '@vesta/ui';
import type { ControlSize } from '@vesta/ui';
import { SegmentedControl } from '@vesta/ui/components/segmented-control';
import { GridIcon, ListIcon } from '@workbench/icons';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, For } from 'solid-js';

const sizes: ControlSize[] = ['sm', 'md', 'lg'];

const viewOptions = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

const Basic: Story = {
  description: 'Arrow keys move and select; Tab leaves the group.',
  render: () => {
    const [view, setView] = createSignal('grid');
    return (
      <Stack gap={12}>
        <SegmentedControl aria-label="View" options={viewOptions} value={view()} onChange={setView} />
        <div class="wb-kit-label">Selected: {view()}</div>
      </Stack>
    );
  },
};

const Sizes: Story = {
  description: 'Track heights match buttons and fields of the same size.',
  render: () => (
    <Stack>
      <For each={sizes}>
        {(size) => (
          <Row label={size}>
            <SegmentedControl
              size={size}
              aria-label="View"
              defaultValue="grid"
              options={[
                { value: 'grid', label: 'Grid', icon: <GridIcon /> },
                { value: 'list', label: 'List', icon: <ListIcon /> },
              ]}
            />
            <Button size={size}>Button</Button>
          </Row>
        )}
      </For>
    </Stack>
  ),
};

const IconOnly: Story = {
  description: 'Labels stay in the DOM as accessible names.',
  render: () => (
    <Stack>
      <For each={sizes}>
        {(size) => (
          <Row label={size}>
            <SegmentedControl
              size={size}
              iconOnly
              aria-label="View"
              defaultValue="grid"
              options={[
                { value: 'grid', label: 'Grid view', icon: <GridIcon /> },
                { value: 'list', label: 'List view', icon: <ListIcon /> },
              ]}
            />
          </Row>
        )}
      </For>
    </Stack>
  ),
};

const Fill: Story = {
  description: 'Items share the width equally.',
  render: () => (
    <div style={{ width: '320px' }}>
      <SegmentedControl
        fill
        aria-label="Release channel"
        defaultValue="release"
        options={[
          { value: 'release', label: 'Release' },
          { value: 'snapshot', label: 'Snapshot' },
          { value: 'beta', label: 'Beta' },
          { value: 'alpha', label: 'Alpha', disabled: true },
        ]}
      />
    </div>
  ),
};

const WithLabel: Story = {
  render: () => (
    <SegmentedControl
      label="Memory preset"
      defaultValue="balanced"
      options={[
        { value: 'low', label: 'Low' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'high', label: 'High' },
      ]}
    />
  ),
};

export default {
  title: 'Controls/Segmented control',
  description: 'Choose one value among two to five options. Use tabs to switch between panels instead.',
  stories: { Basic, Sizes, IconOnly, Fill, WithLabel },
} satisfies StoryMeta;
