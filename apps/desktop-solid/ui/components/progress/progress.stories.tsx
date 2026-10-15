import { Progress } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const column = { width: '320px' };

const States: Story = {
  render: () => (
    <div style={column}>
      <Stack gap={16}>
        <Progress label="Downloading assets" value={42} />
        <Progress label="Installing mods" value={7 / 12 * 100} valueLabel="7 of 12" />
        <Progress label="Resolving dependencies" />
        <Progress label="Verified" value={100} tone="success" />
        <Progress aria-label="Small" value={65} size="sm" />
      </Stack>
    </div>
  ),
};

export default {
  title: 'Feedback/Progress',
  stories: { States },
} satisfies StoryMeta;
