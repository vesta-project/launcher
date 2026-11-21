import { render } from '@solidjs/web';
import { toast, ToastRegion } from '../ui/components/toast/toast';

/** Exercises Kobalte's timer and close button in a fixture browser. */
export async function runToastDismiss() {
  const host = document.createElement('div');
  document.body.append(host);
  const region = 'dismiss-check';
  const dispose = render(() => <ToastRegion regionId={region} />, host);
  const check = async (close: (id: number) => void, duration?: number) => {
    let calls = 0;
    const id = toast.show({
      title: 'Dismiss test',
      persistent: duration === undefined,
      duration,
      onDismiss: () => { calls++; },
    }, { region });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    close(id);
    const deadline = performance.now() + 2000;
    while (!calls && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (calls !== 1) throw new Error(`Expected dismissal callback, got ${calls}`);
    toast.dismiss(id);
    await Promise.resolve();
    if (calls !== 1) throw new Error('Dismissal callback ran twice');
  };
  try {
    await check(() => host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click());
    await check(() => {}, 80);
    await check((id) => toast.dismiss(id));
  } finally {
    dispose();
    host.remove();
  }
}
