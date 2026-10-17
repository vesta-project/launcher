import { getCurrentWindow } from '@tauri-apps/api/window';
import { BreadcrumbItem, Breadcrumbs, Button, IconButton, Menu, MenuItem, MenuSeparator } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { Icon } from '../components/icon';
import { AccountMenu } from '../features/accounts/account-menu';
import { findLauncher } from '../features/installation/launchers';
import { findInstance } from '../features/instances/catalog';
import { detectPlatform } from './platform';
import { route } from './router';
import { goBack, transitionTo } from './transition';
import { isSection, sectionLabels } from '../pages/settings/sections';
import { t } from '../localization';
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
function location(): {
  label: string;
  icon?: string;
  trail: Crumb[];
  back?: { to: string; label: string };
} {
  const current = route();
  switch (current.page) {
    case 'library': {
      const instance = findInstance(current.section)?.instance;
      return instance
        ? {
            label: instance.name,
            trail: [{ label: t('nav.library'), href: '#/library' }, { label: instance.name }],
            back: { to: '/library', label: t('nav.back-to-library') },
          }
        : {
            label: t('nav.library'),
            icon: 'icons/rail/library',
            trail: [{ label: t('nav.library') }],
          };
    }
    case 'browse':
      return {
        label: t('nav.browse'),
        icon: 'icons/rail/browse',
        trail: [{ label: t('nav.browse') }],
      };
    case 'create': {
      const launcher = current.section === 'import' ? findLauncher(current.detail) : undefined;
      if (launcher) return {
        label: launcher.label,
        trail: [{ label: t('nav.library'), href: '#/library' }, { label: t('settings.new-instance-title'), href: '#/create' }, { label: t('install.import-action'), href: `#/create/import/${launcher.value}` }, { label: launcher.label }],
        back: { to: '/create', label: t('common.back') },
      };
      return {
        label: t('settings.new-instance-title'),
        trail: [{ label: t('nav.library'), href: '#/library' }, { label: t('settings.new-instance-title') }],
        back: { to: '/library', label: t('nav.back-to-library') },
      };
    }
    default: {
      const sectionId = isSection(current.section) ? sectionLabels[current.section] : undefined;
      const section = sectionId ? t(sectionId) : undefined;
      return {
        label: t('nav.settings'),
        icon: 'icons/rail/settings',
        trail: section ? [{ label: t('nav.settings'), href: '#/settings' }, { label: section }] : [{ label: t('nav.settings') }],
      };
    }
  }
}

/** macOS keeps its native traffic lights (overlay titlebar); other platforms draw their own. */
function WindowControls() {
  const win = () => getCurrentWindow();
  return (
    <div data-vesta="window-controls">
      <IconButton
        variant="ghost"
        size="sm"
        label={t('nav.minimize')}
        tooltip={false}
        icon={<Icon name="icons/controls/minus" size={14} />}
        onClick={() => win().minimize()}
      />
      <IconButton
        variant="ghost"
        size="sm"
        label={t('nav.maximize')}
        tooltip={false}
        icon={
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.5" />
          </svg>
        }
        onClick={() => win().toggleMaximize()}
      />
      <IconButton
        variant="ghost"
        size="sm"
        tone="danger"
        label={t('nav.close')}
        tooltip={false}
        icon={<Icon name="icons/actions/close" size={14} />}
        onClick={() => win().close()}
      />
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
            <IconButton
              variant="ghost"
              size="sm"
            label={t('common.back')}
              icon={<Icon name="icons/navigation/arrow-back" size={14} />}
              onClick={() => goBack(back().to, findInstance(route().section)?.instance.id)}
            />
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
          <MenuItem icon={<Icon name="icons/rail/library" size={14} />} onSelect={() => transitionTo('/library')}>
            {t('nav.library')}
          </MenuItem>
          <MenuItem icon={<Icon name="icons/rail/browse" size={14} />} onSelect={() => transitionTo('/browse')}>
            {t('nav.browse')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Icon name="icons/rail/settings" size={14} />} onSelect={() => transitionTo('/settings')}>
            {t('nav.settings')}
          </MenuItem>
        </Menu>
      </div>

      <div
        data-vesta="titlebar-center"
        data-tauri-drag-region
        onClick={(event) => {
          // Breadcrumb links are plain hash links; route them through the same transition as the rail.
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#/"]');
          if (!link) return;
          event.preventDefault();
          transitionTo(link.getAttribute('href')!.slice(1), findInstance(route().section)?.instance.id);
        }}
      >
        <Breadcrumbs aria-label={t('nav.location')} class="titlebar-breadcrumb">
          <For each={location().trail} keyed={(crumb) => crumb.href ?? crumb.label}>
            {(crumb) => <BreadcrumbItem href={crumb().href}>{crumb().label}</BreadcrumbItem>}
          </For>
        </Breadcrumbs>
      </div>

      <div data-vesta="titlebar-end" data-tauri-drag-region>
        <div data-vesta="titlebar-compact">
          <IconButton
            variant="ghost"
            size="sm"
            label={t('nav.create')}
            icon={<Icon name="icons/actions/add" size={14} />}
            onClick={() => transitionTo('/create')}
          />
          <AccountMenu placement="bottom-end" onManage={() => transitionTo('/settings/account')} />
        </div>
        <Show when={platform === 'windows' || platform === 'linux'}>
          <WindowControls />
        </Show>
      </div>
    </header>
  );
}
