type TauriWindow = Window &
    typeof globalThis & {
        __TAURI_IPC__?: unknown;
        __TAURI_INTERNALS__?: { invoke?: unknown };
        __TAURI__?: { invoke?: unknown };
    };

export function hasTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const tauriWindow = window as TauriWindow;

    const hasIPC = !!tauriWindow.__TAURI_IPC__;
    const hasInternalInvoke =
        typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
    const hasPublicInvoke = typeof tauriWindow.__TAURI__?.invoke === "function";

    return hasIPC || hasInternalInvoke || hasPublicInvoke;
}
