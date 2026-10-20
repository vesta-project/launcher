import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { startActivitySync } from '../features/activity/activity-sync';

interface ExitCheck {
  can_exit: boolean;
  blocking_tasks: string[];
}

// Hidden macOS WebViews can suspend animation frames. Keep presentation bounded.
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
      resolve();
    };

    const fallback = window.setTimeout(finish, 100);
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(finish);
    });
  });
}

/** Connect the bare main window to the existing host without starting legacy UI services. */
export function startDesktop(themeReady: Promise<void>): () => void {
  if (!isTauri()) return () => {};

  const stopActivity = startActivitySync();
  let disposed = false;
  let unlistenExit: UnlistenFn | undefined;
  let checkingExit = false;

  const requestExit = async () => {
    if (disposed || checkingExit) return;
    checkingExit = true;
    try {
      const check = await invoke<ExitCheck>('exit_check');
      if (disposed) return;
      if (check.can_exit) {
        await invoke('exit_app');
      } else {
        // A force-close prompt belongs to the later application shell.
        console.warn('Exit blocked by active tasks:', check.blocking_tasks);
      }
    } catch (error) {
      console.error('Unable to confirm safe exit; keeping the launcher open.', error);
    } finally {
      checkingExit = false;
    }
  };

  const initialize = async () => {
    const unlisten = await listen('core://exit-requested', () => {
      void requestExit();
    });
    if (disposed) {
      unlisten();
      return;
    }
    unlistenExit = unlisten;

    // The host keeps the initial window hidden. Do not reveal a built-in theme
    // while the canonical saved author theme is still being loaded/applied.
    await themeReady;
    if (disposed) return;
    await afterNextPaint();
    if (disposed) return;
    await invoke('present_window_when_ready', { label: getCurrentWindow().label });
  };

  void initialize().catch((error) => {
    console.error('Unable to initialize the desktop connection:', error);
  });

  return () => {
    disposed = true;
    unlistenExit?.();
    stopActivity();
  };
}
