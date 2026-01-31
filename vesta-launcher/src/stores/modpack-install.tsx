import { createSignal } from "solid-js";
import { ModpackInstallDialog } from "@components/pages/mini-pages/install/components/ModpackInstallDialog";

const [source, setSource] = createSignal<{ 
    type: 'zip' | 'url', 
    value: string, 
    iconUrl?: string,
    modpackId?: string,
    modpackPlatform?: string
} | null>(null);

export function openModpackInstall(path: string, modpackId?: string, modpackPlatform?: string) {
    setSource({ type: 'zip', value: path, modpackId, modpackPlatform });
}

export function openModpackInstallFromUrl(url: string, iconUrl?: string, modpackId?: string, modpackPlatform?: string) {
    setSource({ type: 'url', value: url, iconUrl, modpackId, modpackPlatform });
}

export function closeModpackInstall() {
    setSource(null);
}

export function GlobalModpackInstallDialog() {
    const s = source();
    return (
        <ModpackInstallDialog
            isOpen={s !== null}
            onClose={closeModpackInstall}
            zipPath={s?.type === 'zip' ? s.value : ""}
            url={s?.type === 'url' ? s.value : ""}
            iconUrl={s?.iconUrl}
            modpackId={s?.modpackId}
            modpackPlatform={s?.modpackPlatform}
        />
    );
}
