import { Button, Popover, TextField } from '@vesta/ui';
import { FilterIcon } from '@workbench/icons';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const Filters: Story = {
  description: 'A small form anchored to its trigger.',
  render: () => (
    <Row>
      <Popover
        title="Filter mods"
        description="Only show mods matching these values."
        trigger={(props) => (
          <Button {...props} variant="outline" icon={<FilterIcon />}>
            Filters
          </Button>
        )}
      >
        <Stack gap={8}>
          <TextField label="Author" placeholder="Any" size="sm" />
          <TextField label="Category" placeholder="Any" size="sm" />
          <Row>
            <Button size="sm" tone="accent">
              Apply
            </Button>
            <Button size="sm" variant="ghost">
              Reset
            </Button>
          </Row>
        </Stack>
      </Popover>
    </Row>
  ),
};

const Info: Story = {
  render: () => (
    <Popover trigger={(props) => <Button {...props} variant="ghost">What is Fabric?</Button>} placement="right-start">
      A lightweight mod loader. Most performance and utility mods for recent versions target it.
    </Popover>
  ),
};

export default {
  title: 'Overlays/Popover',
  stories: { Filters, Info },
} satisfies StoryMeta;
