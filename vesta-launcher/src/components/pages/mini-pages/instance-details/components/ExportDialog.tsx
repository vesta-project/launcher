import { createSignal, createResource, For, Show } from "solid-js";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription 
} from "@ui/dialog/dialog";
import LauncherButton from "@ui/button/button";
import { Checkbox } from "@ui/checkbox/checkbox";
import { getInstanceExportFiles, exportInstanceToModpack, ExportCandidate } from "@utils/modpacks";
import { showToast } from "@ui/toast/toast";
import { 
    TextFieldRoot, 
    TextFieldLabel, 
    TextFieldInput 
} from "@ui/text-field/text-field";
import { 
    Select, 
    SelectTrigger, 
    SelectValue, 
    SelectContent, 
    SelectItem 
} from "@ui/select/select";

interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    instanceId: number;
    instanceName: string;
}

export function ExportDialog(props: ExportDialogProps) {
    const [selections, setSelections] = createSignal<Set<string>>(new Set());
    const [exportFormat, setExportFormat] = createSignal("modrinth");
    const [isExporting, setIsExporting] = createSignal(false);
    const [outputPath, setOutputPath] = createSignal("");

    const [candidates] = createResource(
        () => props.instanceId,
        async (id) => {
            const files = await getInstanceExportFiles(id);
            // Default select all mods
            const initial = new Set<string>();
            for (const f of files) {
                if (f.isMod) initial.add(f.path);
            }
            setSelections(initial);
            return files;
        }
    );

    const toggleSelection = (path: string) => {
        const next = new Set(selections());
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelections(next);
    };

    const handleExport = async () => {
        if (!outputPath()) {
            showToast({ title: "Output path required", severity: "Error" });
            return;
        }

        setIsExporting(true);
        try {
            const selectedCandidates = (candidates() || []).filter(c => selections().has(c.path));
            await exportInstanceToModpack(
                props.instanceId,
                outputPath(),
                exportFormat(),
                selectedCandidates
            );
            showToast({
                title: "Export Successful",
                description: `Modpack saved to ${outputPath()}`,
                severity: "Success"
            });
            props.onClose();
        } catch (e) {
            showToast({
                title: "Export Failed",
                description: String(e),
                severity: "Error"
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent style={{ width: "500px", "max-height": "80vh", display: "flex", "flex-direction": "column" }}>
                <DialogHeader>
                    <DialogTitle>Export Instance: {props.instanceName}</DialogTitle>
                    <DialogDescription>
                        Select the files you want to include in the modpack.
                    </DialogDescription>
                </DialogHeader>

                <div style={{ flex: 1, overflow: "auto", padding: "10px 0", display: "flex", "flex-direction": "column", gap: "8px" }}>
                    <Show when={candidates.loading}>
                        <div style={{ "text-align": "center", padding: "20px" }}>Scanning instance...</div>
                    </Show>

                    <For each={candidates()}>
                        {(c) => (
                            <div style={{ display: "flex", "align-items": "center", gap: "10px", padding: "4px 8px", background: "rgba(255,255,255,0.03)", "border-radius": "4px" }}>
                                <Checkbox 
                                    checked={selections().has(c.path)} 
                                    onChange={() => toggleSelection(c.path)}
                                />
                                <div style={{ flex: 1 }}>
                                    <div style={{ "font-size": "14px" }}>{c.path}</div>
                                    <Show when={c.isMod}>
                                        <div style={{ "font-size": "11px", opacity: 0.6 }}>
                                            Linked Mod ({c.platform})
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        )}
                    </For>
                </div>

                <div style={{ "border-top": "1px solid rgba(255,255,255,0.1)", "padding-top": "16px", display: "flex", "flex-direction": "column", gap: "12px" }}>
                    <div style={{ display: "flex", gap: "12px" }}>
                        <TextFieldRoot style={{ flex: 1 }}>
                            <TextFieldLabel>Format</TextFieldLabel>
                            <Select
                                options={["modrinth", "curseforge"]}
                                value={exportFormat()}
                                onChange={setExportFormat}
                            >
                                <SelectTrigger>
                                    <SelectValue<any>>{(s) => s.selectedOption()}</SelectValue>
                                </SelectTrigger>
                                <SelectContent />
                            </Select>
                        </TextFieldRoot>
                    </div>

                    <TextFieldRoot>
                        <TextFieldLabel>Output Path (.zip / .mrpack)</TextFieldLabel>
                        <TextFieldInput 
                            value={outputPath()} 
                            onChange={setOutputPath} 
                            placeholder="C:\Users\...\Desktop\my_pack.mrpack"
                        />
                    </TextFieldRoot>

                    <div style={{ display: "flex", "justify-content": "flex-end", gap: "10px", "margin-top": "10px" }}>
                        <LauncherButton variant="ghost" onClick={props.onClose}>Cancel</LauncherButton>
                        <LauncherButton 
                            color="primary" 
                            onClick={handleExport} 
                            disabled={selections().size === 0 || !outputPath() || isExporting()}
                        >
                            {isExporting() ? "Exporting..." : "Export"}
                        </LauncherButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
