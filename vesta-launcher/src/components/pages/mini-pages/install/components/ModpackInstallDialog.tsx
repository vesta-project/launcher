import { createSignal, createResource, Show } from "solid-js";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription 
} from "@ui/dialog/dialog";
import { InstallForm } from "./InstallForm";
import { getModpackInfo, getModpackInfoFromUrl, installModpackFromZip, installModpackFromUrl, ModpackInfo } from "@utils/modpacks";
import { showToast } from "@ui/toast/toast";
import { Instance } from "@utils/instances";

interface ModpackInstallDialogProps {
    isOpen: boolean;
    onClose: () => void;
    zipPath?: string;
    url?: string;
    iconUrl?: string;
    modpackId?: string;
    modpackPlatform?: string;
}

export function ModpackInstallDialog(props: ModpackInstallDialogProps) {
    const [isInstalling, setIsInstalling] = createSignal(false);
    const [showAdvanced, setShowAdvanced] = createSignal(false);

    const [modpackInfo] = createResource<ModpackInfo | undefined, { zipPath?: string; url?: string; manualIcon?: string; modpackId?: string; modpackPlatform?: string }>(
        () => ({ 
            zipPath: props.zipPath, 
            url: props.url, 
            manualIcon: props.iconUrl,
            modpackId: props.modpackId,
            modpackPlatform: props.modpackPlatform
        }),
        async (source) => {
            let info: ModpackInfo | undefined;
            if (source.zipPath) info = await getModpackInfo(source.zipPath, source.modpackId, source.modpackPlatform);
            else if (source.url) info = await getModpackInfoFromUrl(source.url, source.modpackId, source.modpackPlatform);
            
            if (info) {
                if (source.manualIcon) info.iconUrl = source.manualIcon;
            }
            return info;
        }
    );

    const handleInstall = async (data: Partial<Instance>) => {
        setIsInstalling(true);
        try {
            const info = modpackInfo();
            const fullMetadata = info?.fullMetadata;

            if (props.zipPath) {
                await installModpackFromZip(props.zipPath, data, fullMetadata);
            } else if (props.url) {
                await installModpackFromUrl(props.url, data, fullMetadata);
            }
            
            showToast({
                title: "Installation Started",
                description: `Installing ${data.name}... Check notifications for progress.`,
                severity: "Success"
            });
            setTimeout(props.onClose, 800);
        } catch (e) {
            console.error(e);
            showToast({
                title: "Installation Failed",
                description: String(e),
                severity: "Error"
            });
            setIsInstalling(false);
        }
    };

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent 
                style={{ 
                    width: showAdvanced() || isInstalling() ? "900px" : "440px", 
                    "max-height": "90vh", 
                    "overflow-y": "auto",
                    transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                }}
            >
                <DialogHeader>
                    <DialogTitle>Install Modpack</DialogTitle>
                    <DialogDescription>
                        Configure your new instance for this modpack.
                    </DialogDescription>
                </DialogHeader>

                <Show when={modpackInfo.loading}>
                    <div style={{ padding: "20px", "text-align": "center" }}>
                        Analyzing modpack...
                    </div>
                </Show>

                <Show when={modpackInfo()} keyed>
                    {(info) => (
                        <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
                            <InstallForm
                                compact={!showAdvanced()}
                                isModpack
                                modpackInfo={info}
                                initialName={info.name}
                                initialVersion={info.minecraftVersion}
                                initialModloader={info.modloader}
                                initialModloaderVersion={info.modloaderVersion || undefined}
                                initialIcon={info.iconUrl || undefined}
                                onInstall={handleInstall}
                                onCancel={props.onClose}
                                isInstalling={isInstalling()}
                            />
                            <div style={{ "text-align": "center" }}>
                                <button 
                                    onClick={() => setShowAdvanced(!showAdvanced())}
                                    style={{ 
                                        background: "none", 
                                        border: "none", 
                                        color: "var(--text-secondary)", 
                                        cursor: "pointer", 
                                        "font-size": "12px",
                                        "text-decoration": "underline"
                                    }}
                                >
                                    {showAdvanced() ? "Show Less" : "Advanced Settings..."}
                                </button>
                            </div>
                        </div>
                    )}
                </Show>

                <Show when={modpackInfo.error}>
                    <div style={{ color: "var(--text-error)", padding: "10px" }}>
                        Failed to load modpack info: {String(modpackInfo.error)}
                    </div>
                </Show>
            </DialogContent>
        </Dialog>
    );
}
