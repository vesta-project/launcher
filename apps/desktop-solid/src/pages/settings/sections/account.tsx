import { Badge, Button, Dialog, IconButton, SegmentedControl } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SkinViewer } from '../../../components/skin-viewer';
import {
  accounts,
  activeAccount,
  addAccount,
  removeAccount,
  switchAccount,
  usePlayerHead,
  type Account,
} from '../../../features/accounts/accounts';
import {
  canManageSkin,
  createSkinController,
  drawCape,
  type LibrarySkin,
  type Preset,
  type PresetPack,
  type SaveStatus as SaveState,
  type SkinVariant,
} from '../../../features/accounts/skins';
import { cachedSkinThumb, skinThumb } from '../../../features/accounts/skin-thumbs';
import { t } from '../../../localization';
import { Card } from '../parts';
import './account.css';

function Head(props: { uuid: string; size: number }) {
  const url = usePlayerHead(() => props.uuid);
  return (
    <span
      data-vesta="prefs-head"
      style={
        {
          '--head-size': `${props.size}px`,
          'background-image': url() ? `url(${url()})` : 'none',
        } as never
      }
      aria-hidden="true"
    />
  );
}

/** Lazily rendered, cached front view of a skin. */
function SkinThumb(props: { skin: string; variant: SkinVariant }) {
  let host: HTMLSpanElement | undefined;
  const [visible, setVisible] = createSignal(false);
  const [url, setUrl] = createSignal<string | undefined>();
  onSettled(() => {
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') return void setVisible(true);
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true));
    observer.observe(host);
    return () => observer.disconnect();
  });
  createEffect(
    () => ({ skin: props.skin, variant: props.variant, visible: visible() }),
    ({ skin, variant, visible: shown }) => {
      if (!skin) {
        setUrl(undefined);
        return;
      }
      const hit = cachedSkinThumb(skin, variant);
      if (hit) {
        setUrl(hit);
        return;
      }
      setUrl(undefined);
      if (!shown) return;
      let stale = false;
      void skinThumb(skin, variant).then((next) => !stale && setUrl(next || undefined));
      return () => {
        stale = true;
      };
    },
  );
  return (
    <span ref={(el) => (host = el)} data-vesta="skin-thumb" aria-hidden="true">
      <Show when={url()}>{(src) => <img src={src()} alt="" draggable="false" />}</Show>
    </span>
  );
}

function CapeFace(props: { url: string }) {
  let canvas: HTMLCanvasElement | undefined;
  createEffect(
    () => props.url,
    (url) => {
      if (canvas) void drawCape(canvas, url, 2);
    },
  );
  return <canvas ref={(el) => (canvas = el)} data-vesta="cape-face" aria-hidden="true" width={20} height={32} />;
}

/** A small dot in the header: quiet unless something is happening. */
function SaveIndicator(props: { status: SaveState }) {
  const label = () => {
    switch (props.status) {
      case 'pending':
        return t('skins.status-pending');
      case 'saving':
        return t('skins.status-saving');
      case 'saved':
        return t('skins.status-saved');
      default:
        return '';
    }
  };
  return (
    <span data-vesta="skin-status" data-state={props.status} role="status" aria-live="polite" title={label()}>
      <span data-vesta="skin-status-dot" aria-hidden="true" />
      <Show when={props.status === 'saved'}>
        <span data-vesta="skin-status-text">{label()}</span>
      </Show>
    </span>
  );
}

function SkinPanel(props: { account: Account }) {
  const skins = createSkinController(() => props.account);
  const [shelf, setShelf] = createSignal<'library' | 'presets'>('library');
  const [hover, setHover] = createSignal<{ skin: string; variant: SkinVariant }>();
  const supported = () => canManageSkin(props.account);
  const profile = () => skins.profile();
  const view = () => skins.view();
  const variant = () => view()?.variant ?? 'classic';
  const locked = () => !supported() || !profile();
  const owned = () => profile()?.capes ?? [];
  const currentSkin = () => view()?.skin;
  const presetImage = (preset: Preset) =>
    (variant() === 'slim' ? (preset.slim ?? preset.classic) : (preset.classic ?? preset.slim)) ?? '';
  const presetVariant = (preset: Preset): SkinVariant =>
    variant() === 'slim' ? (preset.slim ? 'slim' : 'classic') : preset.classic ? 'classic' : 'slim';
  const preview = (skin: string, skinVariant: SkinVariant) => ({
    onPointerEnter: () => setHover({ skin, variant: skinVariant }),
    onPointerLeave: () => setHover(undefined),
    onFocus: () => setHover({ skin, variant: skinVariant }),
    onBlur: () => setHover(undefined),
  });
  createEffect(
    () => shelf(),
    (value) => {
      if (value === 'presets') skins.loadPresets();
    },
  );
  return (
    <Card
      title={t('skins.title')}
      description={t('skins.description')}
      action={
        <div data-vesta="skin-actions">
          <SaveIndicator status={skins.status()} />
          <Button
            size="sm"
            variant="ghost"
            disabled={locked() || !!skins.busy()}
            title={t('skins.reset-confirm')}
            onClick={() => void skins.reset()}
          >
            {t('skins.reset')}
          </Button>
        </div>
      }
    >
      <div data-vesta="skin-panel" id="skin-panel" data-disabled={supported() ? undefined : ''}>
        <Show when={!supported()}>
          <p data-vesta="skin-note" role="note">
            {t('skins.unsupported')}
          </p>
        </Show>
        <Show when={skins.error()}>
          {(message) => (
            <p data-vesta="skin-note" data-tone="danger" role="alert">
              {t('skins.failed', { message: message() })}
            </p>
          )}
        </Show>
        <div data-vesta="skin-layout">
          <div data-vesta="skin-stage">
            <div data-vesta="skin-stage-view">
              <SkinViewer
                skin={hover()?.skin ?? currentSkin()}
                model={hover()?.variant ?? variant()}
                cape={view()?.capeId ? view()?.cape : undefined}
                label={t('skins.current')}
              />
              <Show when={supported() && !profile() && !skins.error()}>
                <span data-vesta="skin-stage-status">{t('skins.loading')}</span>
              </Show>
            </div>
            <SegmentedControl
              aria-label={t('skins.model')}
              value={variant()}
              disabled={locked()}
              onChange={(value) => skins.setVariant(value as SkinVariant)}
              options={[
                { value: 'classic', label: t('skins.model-classic') },
                { value: 'slim', label: t('skins.model-slim') },
              ]}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={locked()}
              icon={<Icon name="icons/actions/upload" size={14} />}
              onClick={() => void skins.upload()}
            >
              {t('skins.add')}
            </Button>
          </div>
          <div data-vesta="skin-side">
            <section data-vesta="skin-group">
              <SegmentedControl
                aria-label={t('skins.shelf')}
                value={shelf()}
                onChange={(value) => setShelf(value as 'library' | 'presets')}
                options={[
                  { value: 'library', label: t('skins.library') },
                  { value: 'presets', label: t('skins.presets') },
                ]}
              />
              <Show when={shelf() === 'library'}>
                <Show
                  when={profile()?.library.length}
                  fallback={supported() ? <p data-vesta="skin-hint">{t('skins.library-empty')}</p> : undefined}
                >
                  <ul data-vesta="skin-library">
                    <For each={profile()?.library}>
                      {(skin: LibrarySkin) => (
                        <li data-vesta="skin-tile">
                          <button
                            type="button"
                            data-vesta="skin-tile-apply"
                            aria-label={t('skins.apply', { name: skin.name })}
                            title={skin.name}
                            aria-pressed={skin.image === currentSkin() ? 'true' : 'false'}
                            disabled={locked()}
                            onClick={() => skins.selectLibrary(skin)}
                            {...preview(skin.image, skin.variant)}
                          >
                            <SkinThumb skin={skin.image} variant={skin.variant} />
                          </button>
                          <IconButton
                            variant="ghost"
                            tone="danger"
                            size="sm"
                            label={t('skins.delete', { name: skin.name })}
                            icon={<Icon name="icons/actions/delete" size={12} />}
                            disabled={locked() || !!skins.busy()}
                            onClick={() => void skins.removeLibrary(skin)}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
              <Show when={shelf() === 'presets'}>
                <Show
                  when={skins.presets()}
                  fallback={
                    <p data-vesta="skin-hint">{skins.error() ? t('skins.presets-empty') : t('skins.loading')}</p>
                  }
                >
                  {(packs) => (
                    <div data-vesta="skin-packs">
                      <For each={packs()}>
                        {(pack: PresetPack) => (
                          <div data-vesta="skin-pack">
                            <h5>{pack.name}</h5>
                            <ul data-vesta="skin-library">
                              <For each={pack.skins}>
                                {(preset: Preset) => (
                                  <li data-vesta="skin-tile">
                                    <button
                                      type="button"
                                      data-vesta="skin-tile-apply"
                                      aria-label={t('skins.apply', { name: preset.name })}
                                      title={preset.name}
                                      aria-pressed={presetImage(preset) === currentSkin() ? 'true' : 'false'}
                                      disabled={locked()}
                                      onClick={() => skins.selectPreset(preset)}
                                      {...preview(presetImage(preset), presetVariant(preset))}
                                    >
                                      <SkinThumb skin={presetImage(preset)} variant={presetVariant(preset)} />
                                    </button>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              </Show>
            </section>
            <section data-vesta="skin-group">
              <h4>{t('skins.cape')}</h4>
              <div data-vesta="cape-grid" role="radiogroup" aria-label={t('skins.cape')}>
                <button
                  type="button"
                  role="radio"
                  data-vesta="cape-option"
                  aria-checked={view()?.capeId ? 'false' : 'true'}
                  aria-label={t('skins.cape-none')}
                  title={t('skins.cape-none')}
                  disabled={locked()}
                  onClick={() => skins.setCape(undefined)}
                >
                  <span data-vesta="cape-none" aria-hidden="true">
                    <Icon name="icons/actions/close" size={14} />
                  </span>
                </button>
                <For each={owned()}>
                  {(cape) => (
                    <button
                      type="button"
                      role="radio"
                      data-vesta="cape-option"
                      aria-checked={view()?.capeId === cape.id ? 'true' : 'false'}
                      aria-label={cape.name}
                      title={cape.name}
                      disabled={locked()}
                      onClick={() => skins.setCape(cape.id)}
                    >
                      <CapeFace url={cape.url} />
                    </button>
                  )}
                </For>
              </div>
              <Show when={supported() && profile() && !owned().length}>
                <p data-vesta="skin-hint">{t('skins.capes-empty')}</p>
              </Show>
            </section>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AccountSettings() {
  const [removing, setRemoving] = createSignal<Account>();
  const current = () => activeAccount();
  const others = () => accounts().filter((account) => account.uuid !== current()?.uuid);
  return (
    <>
      <Show when={current()}>
        {(account) => (
          <section data-vesta="prefs-profile">
            <Head uuid={account().uuid} size={72} />
            <div data-vesta="prefs-profile-copy">
              <h3>{account().username}</h3>
              <p>
                <Badge size="sm">{account().account_type}</Badge>
                <Show when={account().is_expired}>
                  <Badge size="sm" tone="danger">
                    {t('prefs.account.expired')}
                  </Badge>
                </Show>
              </p>
            </div>
          </section>
        )}
      </Show>

      <Show when={current()}>{(account) => <SkinPanel account={account()} />}</Show>

      <Card
        title={t('prefs.account.accounts')}
        description={t('prefs.account.accounts-description')}
        action={
          <Button
            size="sm"
            tone="accent"
            icon={<Icon name="icons/actions/add" size={14} />}
            onClick={() => void addAccount()}
          >
            {t('prefs.account.add')}
          </Button>
        }
      >
        <Show when={others().length} fallback={<p data-vesta="prefs-empty-line">{t('prefs.account.only-one')}</p>}>
          <ul data-vesta="prefs-accounts">
            <For each={others()}>
              {(account) => (
                <li>
                  <Head uuid={account.uuid} size={32} />
                  <div>
                    <strong>{account.username}</strong>
                    <span>
                      {account.account_type}
                      <Show when={account.is_expired}> · {t('prefs.account.expired')}</Show>
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void switchAccount(account.uuid)}>
                    {t('prefs.account.make-active')}
                  </Button>
                  <Button size="sm" variant="ghost" tone="danger" onClick={() => setRemoving(account)}>
                    {t('common.remove')}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Card>

      <Dialog
        size="sm"
        open={!!removing()}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title={t('prefs.account.remove-title', {
          name: removing()?.username ?? '',
        })}
        description={t('prefs.account.remove-description')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                const target = removing();
                setRemoving(undefined);
                if (target) void removeAccount(target.uuid);
              }}
            >
              {t('common.remove')}
            </Button>
          </>
        }
      />
    </>
  );
}
