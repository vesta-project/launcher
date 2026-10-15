import { Skeleton } from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const InstanceRow: Story = {
  description: 'Typical loading placeholder for a library row.',
  render: () => (
    <Stack gap={12}>
      <Row>
        <Skeleton circle height={40} />
        <div style={{ flex: 1, 'min-width': '0' }}>
          <Stack gap={6}>
            <Skeleton width={160} height={14} />
            <Skeleton width={220} height={12} />
          </Stack>
        </div>
      </Row>
      <Row>
        <Skeleton circle height={40} />
        <div style={{ flex: 1, 'min-width': '0' }}>
          <Stack gap={6}>
            <Skeleton width={120} height={14} />
            <Skeleton width={180} height={12} />
          </Stack>
        </div>
      </Row>
    </Stack>
  ),
};

const Blocks: Story = {
  render: () => (
    <Row>
      <Skeleton width={120} height={80} radius={8} />
      <Skeleton width={80} height={80} radius={8} />
      <Skeleton circle height={80} />
      <Skeleton width={200} height={12} animate={false} />
    </Row>
  ),
};

export default {
  title: 'Display/Skeleton',
  description: 'Loading placeholders with a soft pulse; respects reduced motion.',
  stories: { InstanceRow, Blocks },
} satisfies StoryMeta;
