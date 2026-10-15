import { getCurrentWindow } from '@tauri-apps/api/window';
import { BreadcrumbItem, Breadcrumbs, Button, IconButton, Menu, MenuItem, MenuSeparator } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Icon } from '../components/icon';
import { AccountMenu } from '../features/accounts/account-menu';
import { findInstance } from '../features/instances/fixtures';
import { detectPlatform } from './platform';
import { navigate, route } from './router';
import { sectionLabels } from '../pages/settings/sections';
import './titlebar.css';

const platform = detectPlatform();

interface Crumb {
  label: string;
  /** Hash target; the last crumb (where you are) has none. */
  href?: string;
}

/**
 * Where the user is: the breadcrumb trail (wide windows), the destination label
 * (narrow windows), and what the back button returns to.
 */
function location(): { label: string; icon?: string; trail: Crumb[]; back?: { to: string; label: string } } {
  const current = route();
  switch (current.page) {
    case 'library': {
      const instance = findInstance(current.section)?.instance;
      return instance
        ? {
            label: instance.name,
            trail: [{ label: 'Library', href: '#/library' }, { label: instance.name }],
            back: { to: '/library', label: 'Back to Library' },
          }
        : { label: 'Library', icon: 'icons/rail/library', trail: [{ label: 'Library' }] };
    }
    case 'browse':
      return { label: 'Browse', icon: 'icons/rail/browse', trail: [{ label: 'Browse' }] };
    case 'create':
      return {
        label: 'New instance',
        trail: [{ label: 'Library', href: '#/library' }, { label: 'New instance' }],
        back: { to: '/library', label: 'Back to Library' },
      };
    default: {
      const section = current.section ? sectionLabels[current.section] : undefined;
      return {
        label: 'Settings',
        icon: 'icons/rail/settings',
        trail: section ? [{ label: 'Settings', href: '#/settings' }, { label: section }] : [{ label: 'Settings' }],
      };
    }
  }
}

/** macOS keeps its native traffic lights (overlay titlebar); other platforms draw their own. */
function WindowControls() {
  const win = () => getCurrentWindow();
  return (
    <div data-vesta="window-controls">
      <IconButton variant="ghost" size="sm" label="Minimize" tooltip={false} icon={<Icon name="icons/controls/minus" size={14} />} onClick={() => win().minimize()} />
      <IconButton
        variant="ghost"
        size="sm"
        label="Maximize"
        tooltip={false}
        icon={
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.5" />
          </svg>
        }
        onClick={() => win().toggleMaximize()}
      />
      <IconButton variant="ghost" size="sm" tone="danger" label="Close" tooltip={false} icon={<Icon name="icons/actions/close" size={14} />} onClick={() => win().close()} />
    </div>
  );
}

/**
 * Compact titlebar: back (on sub-pages) and a breadcrumb of where you are. In narrow
 * windows, where the rail is hidden, the breadcrumb becomes a destination menu and the
 * add and account buttons appear.
 */
export function Titlebar() {
  return (
    <header data-vesta="titlebar" data-platform={platform} data-tauri-drag-region>
      <div data-vesta="titlebar-start">
        <Show when={location().back}>
          {(back) => (
            <IconButton variant="ghost" size="sm" label={back().label} icon={<Icon name="icons/navigation/arrow-back" size={14} />} onClick={() => navigate(back().to)} />
          )}
        </Show>
        <Menu
          placement="bottom-start"
          trigger={(menuProps) => (
            <Button
              {...menuProps}
              class="titlebar-destination"
              size="sm"
              variant="outline"
              icon={location().icon ? <Icon name={location().icon as string} size={14} /> : undefined}
              iconEnd={<Icon name="icons/controls/chevron-down" size={14} />}
            >
              {location().label}
            </Button>
          )}
        >
          <MenuItem icon={<Icon name="icons/rail/library" size={14} />} onSelect={() => navigate('/library')}>
            Library
          </MenuItem>
          <MenuItem icon={<Icon name="icons/rail/browse" size={14} />} onSelect={() => navigate('/browse')}>
            Browse
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Icon name="icons/rail/settings" size={14} />} onSelect={() => navigate('/settings')}>
            Settings
          </MenuItem>
        </Menu>
      </div>

      <div data-vesta="titlebar-center" data-tauri-drag-region>
        <Breadcrumbs aria-label="Location" class="titlebar-breadcrumb">
          <For each={location().trail}>{(crumb) => <BreadcrumbItem href={crumb.href}>{crumb.label}</BreadcrumbItem>}</For>
        </Breadcrumbs>
      </div>

      <div data-vesta="titlebar-end" data-tauri-drag-region>
        <div data-vesta="titlebar-compact">
          <IconButton variant="ghost" size="sm" label="Add instance" icon={<Icon name="icons/actions/add" size={14} />} onClick={() => navigate('/create')} />
          <AccountMenu placement="bottom-end" onManage={() => navigate('/settings/account')} />
        </div>
        <Show when={platform === 'windows' || platform === 'linux'}>
          <WindowControls />
        </Show>
      </div>
    </header>
  );
}
