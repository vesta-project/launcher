import { BreadcrumbItem, Breadcrumbs } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const Basic: Story = {
  render: () => (
    <Stack>
      <Breadcrumbs>
        <BreadcrumbItem href="#/">Home</BreadcrumbItem>
        <BreadcrumbItem href="#/instances">Instances</BreadcrumbItem>
        <BreadcrumbItem current>Survival</BreadcrumbItem>
      </Breadcrumbs>
      <Breadcrumbs>
        <BreadcrumbItem href="#/">Library</BreadcrumbItem>
        <BreadcrumbItem href="#/mods">Mods</BreadcrumbItem>
        <BreadcrumbItem href="#/mods/fabric">Fabric</BreadcrumbItem>
        <BreadcrumbItem current>Sodium</BreadcrumbItem>
      </Breadcrumbs>
    </Stack>
  ),
};

export default {
  title: 'Navigation/Breadcrumb',
  description: 'Hierarchy trail for the current location; the last item is the page.',
  stories: { Basic },
} satisfies StoryMeta;
