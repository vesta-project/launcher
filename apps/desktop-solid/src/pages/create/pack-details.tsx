import { PackContentsList } from '../browse/project/version-view';
import '../browse/project/project.css';
import { archiveResourceDetails, customModsWithoutProvider, type PackSyncDetails, type PackResourceDetails } from '../../features/servers/native-pack-sync';
import { loadProjects, peekProject } from '../../features/browse/browse-projects';
import { projectPath, type SourceId } from '../../features/browse/browse-model';
import { Button, TextField, Tooltip } from '@vesta/ui';
import { knownPackVersion, packArtwork } from "../../features/installation/pack-metadata";
import { For, Show, createSignal, createEffect, createMemo } from "solid-js";
import { Icon } from "../../components/icon";
import { formatNumber, t } from "../../localization";
import { type PackInfo, type PackSource } from "../../features/installation/install-service";
import "./pack-details.css";

/** Archive identity stays distinct from the editable instance name and icon. */
export function InstallPackDetails(props: {
  info: PackInfo;
  source?: PackSource;
  matching: boolean;
  serverDetails?: PackSyncDetails;
  resourcesOnly?: boolean;
  lockedRuntime?: boolean;
}) {
  const resources = createMemo(() => props.serverDetails?.resources ?? archiveResourceDetails(props.info.fullMetadata), { name: "installPack.inventory" });
  const unknownMods = () => customModsWithoutProvider(props.serverDetails ?? {});
  createEffect(() => props.resourcesOnly || !props.lockedRuntime ? resources() : [], items => {
    for (const platform of ['modrinth', 'curseforge'] as const) {
      const ids = items.filter(item => item.platform === platform && item.projectId).map(item => item.projectId!);
      if (ids.length) void loadProjects(platform, ids).catch(() => {});
    }
  }, { name: 'installPack.resourceNames' });
  const project = (item: PackResourceDetails) => item.projectId && ['modrinth', 'curseforge'].includes(item.platform ?? '') ? peekProject(item.platform as SourceId, item.projectId) : undefined;
  const resourceName = (item: ReturnType<typeof resources>[number]) => project(item)?.name ?? item.path.split('/').at(-1)!;
  const [failedImage, setFailedImage] = createSignal<string>();
  const artwork = () => {
    const url = packArtwork(props.info.iconUrl);
    return url && failedImage() !== url ? url : undefined;
  };
  const platform = () => {
    const value = (props.info.modpackPlatform || props.info.format).toLowerCase();
    if (value.includes("modrinth")) return { label: "Modrinth", icon: "branding/sources/modrinth" };
    if (value.includes("curse"))
      return { label: "CurseForge", icon: "branding/sources/curseforge" };
    return { label: props.info.format === "custom" ? t("install.custom-pack") : props.info.format, icon: "icons/content/file" };
  };
  const filename = () =>
    props.source?.kind === "file" ? props.source.value.split(/[\\/]/).at(-1) : undefined;
  return (
    <aside data-vesta="install-pack-details" data-resources-only={props.resourcesOnly ? "" : undefined} aria-label={t("install.pack-details")}>
      <Show when={!props.resourcesOnly}><header data-vesta="install-pack-identity">
        <div data-vesta="install-pack-art">
          <Show keyed when={artwork()} fallback={<Icon name="icons/content/cube" size={28} />}>
            {(url) => <img src={url} alt="" onError={() => setFailedImage(url)} />}
          </Show>
        </div>
        <div>
          <h2>{props.info.name}</h2>
          <Show when={props.info.author}>
            <p>{t("install.pack-author", { author: props.info.author! })}</p>
          </Show>
        </div>
      </header>
      <div data-vesta="install-pack-platform">
        <Icon name={platform().icon} size={16} />
        <span>{platform().label}</span>
        <Show when={props.source?.kind === "file"}>
          <span data-vesta="install-pack-origin">{t("install.local-file")}</span>
        </Show>
      </div>
      <dl data-vesta="install-pack-facts">
        <div>
          <dt>
            <Icon name="icons/content/cube" />
            {t("install.pack-resources")}
          </dt>
          <dd>{formatNumber(props.info.modCount)}</dd>
        </div>
        <Show when={knownPackVersion(props.info.version)}>
          <div>
            <dt>{t("install.release")}</dt>
            <dd>{props.info.version}</dd>
          </div>
        </Show>
        <Show when={props.info.downloadCount != null}>
          <div>
            <dt>
              <Icon name="icons/actions/download" />
              {t("install.pack-downloads")}
            </dt>
            <dd>
              {formatNumber(props.info.downloadCount!, {
                notation: "compact",
                maximumFractionDigits: 1,
              })}
            </dd>
          </div>
        </Show>
      </dl>
      <Show when={props.info.description?.trim()}>
        <p data-vesta="install-pack-description">{props.info.description}</p>
      </Show>
      <Show when={props.matching}>
        <p data-vesta="install-pack-matching" role="status">
          <Icon name="icons/content/search" size={14} />
          {t("install.matching-pack")}
        </p>
      </Show>
      <Show when={props.lockedRuntime}><dl data-vesta="install-pack-facts"><div><dt>Minecraft</dt><dd>{props.info.minecraftVersion}</dd></div><div><dt>{t('management.loader')}</dt><dd>{props.info.modloader} {props.info.modloaderVersion}</dd></div></dl></Show>
      </Show>
      <Show when={props.resourcesOnly || !props.lockedRuntime}>
      <Show when={unknownMods().length}>
        <p data-vesta="install-source-warning" role="note"><Icon name="icons/controls/warning" size={16} /><span>{t('install.custom-mod-warning', { count: unknownMods().length })}</span></p>
      </Show>
      <Show when={resources().length}>
        <PackContentsList ready={true} entries={resources().map(item => ({ key: item.path, name: resourceName(item), kind: project(item)?.resource_type ?? (item.path.startsWith('mods/') ? 'mod' : item.path.startsWith('resourcepacks/') ? 'resourcepack' : item.path.startsWith('shaderpacks/') ? 'shader' : 'other'), project: project(item), extra: props.info.format === 'custom' ? <Tooltip content={item.platform === 'curseforge' ? 'CurseForge' : item.platform === 'modrinth' ? 'Modrinth' : t('install.custom-resource')} trigger={triggerProps => <span {...triggerProps} tabindex="0" style={{ flex: 'none' }}><Icon name={item.platform === 'curseforge' ? 'branding/sources/curseforge' : item.platform === 'modrinth' ? 'branding/sources/modrinth' : 'icons/content/file'} size={14} /></span>} /> : undefined }))} />
      </Show>
      </Show>
      <Show when={!props.resourcesOnly && filename()}>
        <div data-vesta="install-pack-file" title={props.source?.value}>
          <Icon name="icons/content/file" size={15} />
          <span>{filename()}</span>
        </div>
      </Show>
    </aside>
  );
}
