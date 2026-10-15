import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
} from '@vesta/ui';
import { CopyIcon, DownloadIcon, FolderIcon, PencilIcon, PlayIcon, TrashIcon } from '@workbench/icons';
import { Row } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const surface = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  width: '280px',
  height: '120px',
  border: '1px dashed var(--vesta-color-border-strong)',
  'border-radius': 'var(--vesta-radius-container)',
  color: 'var(--vesta-color-text-muted)',
  'font-size': 'var(--vesta-text-sm)',
} as const;

const InstanceCard: Story = {
  description: 'Right-click (or long-press) the surface. Same item anatomy as Menu.',
  render: () => (
    <Row>
      <ContextMenu
        trigger={(props) => (
          <div {...props} style={surface} tabindex="0">
            Right-click instance card
          </div>
        )}
      >
        <ContextMenuItem icon={<PlayIcon />} shortcut="⏎">
          Play
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderIcon />} shortcut="⌘O">
          Open folder
        </ContextMenuItem>
        <ContextMenuItem icon={<PencilIcon />}>Rename…</ContextMenuItem>
        <ContextMenuItem icon={<CopyIcon />} shortcut="⌘D">
          Duplicate
        </ContextMenuItem>
        <ContextMenuSub label="Export" icon={<DownloadIcon />}>
          <ContextMenuItem>Modrinth pack (.mrpack)</ContextMenuItem>
          <ContextMenuItem>CurseForge pack (.zip)</ContextMenuItem>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<TrashIcon />} tone="danger" shortcut="⌫">
          Delete instance
        </ContextMenuItem>
      </ContextMenu>
    </Row>
  ),
};

const CheckableAndRadio: Story = {
  render: () => {
    const [grid, setGrid] = createSignal(true);
    const [sort, setSort] = createSignal('name');
    return (
      <Row>
        <ContextMenu
          trigger={(props) => (
            <div {...props} style={surface} tabindex="0">
              Right-click for view options
            </div>
          )}
        >
          <ContextMenuGroup label="Show">
            <ContextMenuCheckboxItem checked={grid()} onChange={setGrid}>
              Grid view
            </ContextMenuCheckboxItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup label="Sort by">
            <ContextMenuRadioGroup value={sort()} onChange={setSort}>
              <ContextMenuRadioItem value="name">Name</ContextMenuRadioItem>
              <ContextMenuRadioItem value="played">Last played</ContextMenuRadioItem>
              <ContextMenuRadioItem value="created">Date created</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuGroup>
        </ContextMenu>
      </Row>
    );
  },
};

export default {
  title: 'Overlays/Context menu',
  description: 'Right-click menus. Same surface and item hooks as Menu; open from a trigger surface.',
  stories: { InstanceCard, CheckableAndRadio },
} satisfies StoryMeta;
