import { Badge } from '@vesta/ui/components/badge';
import { Tab, TabList, TabPanel, Tabs } from '@vesta/ui/components/tabs';
import { BoxIcon, FileTextIcon, FolderIcon, GlobeIcon, ImageIcon, PaletteIcon, SettingsIcon, UserIcon } from '@workbench/icons';
import type { Story, StoryMeta } from '@workbench/story';
import { For } from 'solid-js';

const Horizontal: Story = {
  description: 'Instance page tabs. The underline slides between tabs; arrow keys move and select, Home/End jump.',
  render: () => (
    <div style={{ 'max-width': '640px' }}>
      <Tabs defaultValue="overview">
        <TabList aria-label="Instance sections">
          <Tab value="overview">Overview</Tab>
          <Tab value="mods" badge={<Badge size="sm">128</Badge>}>
            Mods
          </Tab>
          <Tab value="resource-packs">Resource packs</Tab>
          <Tab value="worlds">Worlds</Tab>
          <Tab value="screenshots">Screenshots</Tab>
          <Tab value="logs">Logs</Tab>
        </TabList>
        <TabPanel value="overview">Overview of the instance: version, loader, play time and recent activity.</TabPanel>
        <TabPanel value="mods">128 installed mods, 3 with updates available.</TabPanel>
        <TabPanel value="resource-packs">Resource packs applied to this instance, in load order.</TabPanel>
        <TabPanel value="worlds">Saved worlds and their last played date.</TabPanel>
        <TabPanel value="screenshots">Screenshots taken in this instance.</TabPanel>
        <TabPanel value="logs">Latest game output and crash reports.</TabPanel>
      </Tabs>
    </div>
  ),
};

const WithIcons: Story = {
  render: () => (
    <div style={{ 'max-width': '560px' }}>
      <Tabs defaultValue="mods">
        <TabList aria-label="Instance sections">
          <Tab value="overview" icon={<FolderIcon />}>
            Overview
          </Tab>
          <Tab value="mods" icon={<BoxIcon />} badge={<Badge size="sm" tone="accent">3</Badge>}>
            Mods
          </Tab>
          <Tab value="screenshots" icon={<ImageIcon />}>
            Screenshots
          </Tab>
          <Tab value="logs" icon={<FileTextIcon />} disabled>
            Logs
          </Tab>
        </TabList>
        <TabPanel value="overview">Overview of the instance.</TabPanel>
        <TabPanel value="mods">Installed mods.</TabPanel>
        <TabPanel value="screenshots">Screenshots taken in this instance.</TabPanel>
        <TabPanel value="logs">Logs are unavailable until the instance has been launched.</TabPanel>
      </Tabs>
    </div>
  ),
};

const Small: Story = {
  description: 'Compact tabs for dense panels; heights follow --vesta-size-control-sm.',
  render: () => (
    <div style={{ 'max-width': '480px' }}>
      <Tabs size="sm" defaultValue="overview">
        <TabList aria-label="Instance sections">
          <Tab value="overview">Overview</Tab>
          <Tab value="mods" badge={<Badge size="sm">128</Badge>}>
            Mods
          </Tab>
          <Tab value="worlds">Worlds</Tab>
          <Tab value="logs">Logs</Tab>
        </TabList>
        <TabPanel value="overview">Overview of the instance.</TabPanel>
        <TabPanel value="mods">128 installed mods.</TabPanel>
        <TabPanel value="worlds">Saved worlds.</TabPanel>
        <TabPanel value="logs">Game output.</TabPanel>
      </Tabs>
    </div>
  ),
};

const Vertical: Story = {
  description: 'Settings-style navigation: the list sits on the left and the indicator runs along its edge.',
  render: () => (
    <div style={{ height: '420px', 'max-width': '560px' }}>
      <Tabs orientation="vertical" defaultValue="general" style={{ height: '100%' }}>
        <TabList aria-label="Settings" style={{ 'min-width': '160px' }}>
          <Tab value="general" icon={<SettingsIcon />}>
            General
          </Tab>
          <Tab value="appearance" icon={<PaletteIcon />}>
            Appearance
          </Tab>
          <Tab value="java" icon={<BoxIcon />}>
            Java
          </Tab>
          <Tab value="accounts" icon={<UserIcon />}>
            Accounts
          </Tab>
          <Tab value="advanced" icon={<GlobeIcon />}>
            Advanced
          </Tab>
        </TabList>
        <TabPanel value="general">Launcher language, startup behaviour and update channel.</TabPanel>
        <TabPanel value="appearance">Theme, accent colour and interface density.</TabPanel>
        <TabPanel value="java">Java installations and default memory allocation.</TabPanel>
        <TabPanel value="accounts">Signed-in Microsoft accounts and offline profiles.</TabPanel>
        <TabPanel value="advanced">Network, cache and diagnostic options.</TabPanel>
      </Tabs>
    </div>
  ),
};

const overflowTabs = Array.from({ length: 12 }, (_, i) => `Section ${i + 1}`);

const Overflow: Story = {
  description: 'When tabs do not fit, the list scrolls horizontally without a scrollbar.',
  render: () => (
    <div style={{ width: '360px' }}>
      <Tabs defaultValue="section-1">
        <TabList aria-label="Sections">
          <For each={overflowTabs}>
            {(label, i) => <Tab value={`section-${i() + 1}`}>{label}</Tab>}
          </For>
        </TabList>
        <For each={overflowTabs}>
          {(label, i) => <TabPanel value={`section-${i() + 1}`}>Content of {label}.</TabPanel>}
        </For>
      </Tabs>
    </div>
  ),
};

export default {
  title: 'Navigation/Tabs',
  description: 'Switches between panels of related content. Use a segmented control to choose a value instead.',
  stories: { Horizontal, WithIcons, Small, Vertical, Overflow },
} satisfies StoryMeta;
