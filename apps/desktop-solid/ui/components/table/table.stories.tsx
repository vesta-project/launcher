import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { For } from 'solid-js';

const rows = [
  { name: 'Sodium', loader: 'Fabric', version: '0.6.13', size: '1.2 MB' },
  { name: 'Lithium', loader: 'Fabric', version: '0.15.0', size: '640 KB' },
  { name: 'Iris', loader: 'Fabric', version: '1.8.8', size: '3.4 MB' },
  { name: 'Mod Menu', loader: 'Fabric', version: '13.0.3', size: '420 KB' },
];

const Basic: Story = {
  render: () => (
    <Stack>
      <div style={{ width: '520px' }}>
        <Table>
          <TableCaption>Installed mods</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Loader</TableHead>
              <TableHead>Version</TableHead>
              <TableHead numeric>Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={rows}>
              {(row) => (
                <TableRow>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Badge size="sm">{row.loader}</Badge>
                  </TableCell>
                  <TableCell>{row.version}</TableCell>
                  <TableCell numeric>{row.size}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
      </div>
    </Stack>
  ),
};

export default {
  title: 'Display/Table',
  description: 'Scrollable data table with header, body, caption and numeric columns.',
  stories: { Basic },
} satisfies StoryMeta;
