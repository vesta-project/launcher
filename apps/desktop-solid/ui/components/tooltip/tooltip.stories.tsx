import { Button, IconButton, Tooltip } from '@vesta/ui';
import { FolderIcon, PlayIcon, SettingsIcon, TrashIcon } from '@workbench/icons';
import { Row } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const IconButtons: Story = {
  description: 'Icon buttons show their label as a tooltip by default. Hover or focus with the keyboard.',
  render: () => (
    <Row>
      <IconButton variant="ghost" icon={<PlayIcon />} label="Play" />
      <IconButton variant="ghost" icon={<FolderIcon />} label="Open folder" />
      <IconButton variant="ghost" icon={<SettingsIcon />} label="Instance settings" tooltipPlacement="bottom" />
      <IconButton variant="ghost" tone="danger" icon={<TrashIcon />} label="Delete" />
    </Row>
  ),
};

const Custom: Story = {
  render: () => (
    <Tooltip
      content="Requires Java 21. Vesta will download it on first launch."
      trigger={(props) => (
        <Button {...props} tone="accent">
          Play
        </Button>
      )}
    />
  ),
};

export default {
  title: 'Overlays/Tooltip',
  stories: { IconButtons, Custom },
} satisfies StoryMeta;
