import { knownPackVersion, packArtwork } from "../../features/installation/pack-metadata";
import { Show, createSignal } from "solid-js";
import { Icon } from "../../components/icon";
import { formatNumber, t } from "../../localization";
import { type PackInfo, type PackSource } from "../../features/installation/install-service";
import "./pack-details.css";

/** Archive identity stays distinct from the editable instance name and icon. */
export function InstallPackDetails(props: {
  info: PackInfo;
  source?: PackSource;
  matching: boolean;
}) {
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
    return { label: props.info.format, icon: "icons/content/file" };
  };
  const filename = () =>
    props.source?.kind === "file" ? props.source.value.split(/[\\/]/).at(-1) : undefined;
  return (
    <aside data-vesta="install-pack-details" aria-label={t("install.pack-details")}>
      <header data-vesta="install-pack-identity">
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
      <Show when={filename()}>
        <div data-vesta="install-pack-file" title={props.source?.value}>
          <Icon name="icons/content/file" size={15} />
          <span>{filename()}</span>
        </div>
      </Show>
    </aside>
  );
}
