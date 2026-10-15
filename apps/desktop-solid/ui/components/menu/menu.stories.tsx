import { Button, IconButton, Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator, MenuSub } from '@vesta/ui';
import { ChevronDownIcon, CopyIcon, DownloadIcon, FolderIcon, MoreIcon, PencilIcon, PlayIcon, TrashIcon } from '@workbench/icons';
import { Row } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const InstanceActions: Story = {
  description: 'Icons, shortcuts, a submenu and a destructive action. Trigger is an icon button with its tooltip.',
  render: () => (
    <Row>
      <Menu trigger={(props) => <IconButton {...props} icon={<MoreIcon />} label="Instance actions" variant="ghost" />}>
        <MenuItem icon={<PlayIcon />} shortcut="⏎">
          Play
        </MenuItem>
        <MenuItem icon={<FolderIcon />} shortcut="⌘O">
          Open folder
        </MenuItem>
        <MenuItem icon={<PencilIcon />}>Rename…</MenuItem>
        <MenuItem icon={<CopyIcon />} shortcut="⌘D">
          Duplicate
        </MenuItem>
        <MenuSub label="Export" icon={<DownloadIcon />}>
          <MenuItem>Modrinth pack (.mrpack)</MenuItem>
          <MenuItem>CurseForge pack (.zip)</MenuItem>
          <MenuItem>Vesta instance</MenuItem>
        </MenuSub>
        <MenuSeparator />
        <MenuItem icon={<TrashIcon />} tone="danger" shortcut="⌫">
          Delete instance
        </MenuItem>
      </Menu>
    </Row>
  ),
};

const Plain: Story = {
  description: 'Without icons the label column starts at the item padding.',
  render: () => (
    <Menu
      trigger={(props) => (
        <Button {...props} variant="outline" iconEnd={<ChevronDownIcon />}>
          1.21.4 · Fabric
        </Button>
      )}
    >
      <MenuGroup label="Release">
        <MenuItem>1.21.4</MenuItem>
        <MenuItem>1.21.3</MenuItem>
        <MenuItem>1.20.6</MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem disabled>Snapshots (enable in settings)</MenuItem>
    </Menu>
  ),
};

const Checkable: Story = {
  render: () => {
    const [snapshots, setSnapshots] = createSignal(false);
    const [betas, setBetas] = createSignal(true);
    return (
      <Menu trigger={(props) => <Button {...props}>View options</Button>}>
        <MenuGroup label="Show">
          <MenuCheckboxItem checked={snapshots()} onChange={setSnapshots}>
            Snapshots
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={betas()} onChange={setBetas}>
            Beta loader versions
          </MenuCheckboxItem>
        </MenuGroup>
      </Menu>
    );
  },
};

export default {
  title: 'Overlays/Menu',
  description: 'Action menus. Any library control can be the trigger via the `trigger` render prop.',
  stories: { InstanceActions, Plain, Checkable },
} satisfies StoryMeta;
