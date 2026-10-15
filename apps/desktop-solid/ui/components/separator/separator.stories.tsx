import { Separator } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const Basic: Story = {
  render: () => (
    <div style={{ width: '240px' }}>
      <Stack gap={12}>
        <span>Above</span>
        <Separator />
        <span>Below</span>
      </Stack>
    </div>
  ),
};

const Vertical: Story = {
  render: () => (
    <div style={{ height: '48px' }}>
      <Row gap={12}>
        <span>Left</span>
        <Separator orientation="vertical" />
        <span>Right</span>
      </Row>
    </div>
  ),
};

export default {
  title: 'Display/Separator',
  description: 'A thin rule for grouping content. Menu separators share the same hook.',
  stories: { Basic, Vertical },
} satisfies StoryMeta;
