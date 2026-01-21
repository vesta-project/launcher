import { createSignal } from "solid-js";
import { ModpackInstallDialog } from "@components/pages/mini-pages/install/components/ModpackInstallDialog";

const [source, setSource] = createSignal<{ type: 'zip' | 'url', value: string, iconUrl?: string } | null>(null);

export function openModpackInstall(path: string) {
    setSource({ type: 'zip', value: path });
}

export function openModpackInstallFromUrl(url: string, iconUrl?: string) {
    setSource({ type: 'url', value: url, iconUrl });
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
        />
    );
}
