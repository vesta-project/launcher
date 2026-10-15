import { Button, toast, ToastRegion, type ToastPlacement } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal, createUniqueId, For } from 'solid-js';

const placements: { value: ToastPlacement; label: string }[] = [
  { value: 'bottom-end', label: 'Bottom right' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-start', label: 'Bottom left' },
  { value: 'top-end', label: 'Top right' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-start', label: 'Top left' },
];

/**
 * Mock app window. `contain: layout paint` keeps `position: fixed` regions
 * inside this box and clips paint so Both-scheme columns cannot spill.
 */
const screenStyle = {
  position: 'relative',
  contain: 'layout paint',
  overflow: 'hidden',
  width: '100%',
  'max-width': '100%',
  'min-width': '0',
  height: '360px',
  border: '1px dashed var(--vesta-color-border-strong)',
  'border-radius': 'var(--vesta-radius-container)',
  padding: '12px',
  // Tighter margins so the region fits a half-width Both column.
  '--toast-margin': '12px',
  '--toast-width': 'min(300px, calc(100% - 24px))',
} as const;

function PlaygroundStory() {
  // Own component scope so Both-scheme remounts get fresh signals/region ids.
  const region = `toast-demo-${createUniqueId()}`;
  const [placement, setPlacement] = createSignal<ToastPlacement>('bottom-end');

  const show = (options: Parameters<typeof toast.show>[0]) => toast.show(options, { region });

  const download = () => {
    let done = 0;
    const total = 12;
    const id = show({
      title: 'Installing Fabulously Optimized',
      description: 'Downloading mods',
      progress: 0,
      progressLabel: `0 of ${total}`,
    });
    const timer = setInterval(() => {
      done += 1;
      if (done < total) {
        toast.update(id, { progress: (done / total) * 100, progressLabel: `${done} of ${total}` });
        return;
      }
      clearInterval(timer);
      toast.update(id, {
        tone: 'success',
        title: 'Fabulously Optimized installed',
        description: '12 mods ready to play.',
        progress: undefined,
        persistent: false,
        actions: [{ label: 'Play', onClick: () => {} }],
      });
    }, 450);
  };

  return (
    <div style={screenStyle}>
      <Stack gap={10}>
        <div
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '6px',
          }}
          role="group"
          aria-label="Placement"
        >
          <For each={placements}>
            {(option) => (
              <Button
                size="sm"
                variant={placement() === option.value ? 'solid' : 'ghost'}
                tone={placement() === option.value ? 'accent' : 'neutral'}
                onClick={() => setPlacement(option.value)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
          <Button size="sm" onClick={() => show({ title: 'Settings saved' })}>
            Neutral
          </Button>
          <Button
            size="sm"
            onClick={() =>
              show({
                tone: 'accent',
                title: 'Update available',
                description: 'Vesta 0.2.1 is ready to install.',
                actions: [
                  { label: 'Restart', onClick: () => {} },
                  { label: 'Later', onClick: () => {} },
                ],
              })
            }
          >
            Info + actions
          </Button>
          <Button
            size="sm"
            onClick={() =>
              show({
                tone: 'success',
                title: 'Instance exported',
                description: 'Saved to Downloads/survival.mrpack',
              })
            }
          >
            Success
          </Button>
          <Button
            size="sm"
            onClick={() =>
              show({
                tone: 'warning',
                title: 'Low memory',
                description: 'Allocated 2 GB; this pack recommends 6 GB.',
                actions: [{ label: 'Adjust', onClick: () => {} }],
              })
            }
          >
            Warning
          </Button>
          <Button
            size="sm"
            onClick={() =>
              show({
                tone: 'danger',
                urgent: true,
                persistent: true,
                title: 'Game crashed',
                description: 'Exit code 1 after 12 seconds.',
                actions: [{ label: 'View log', onClick: () => {} }],
              })
            }
          >
            Error
          </Button>
          <Button size="sm" tone="accent" onClick={download}>
            Progress
          </Button>
          <Button size="sm" onClick={() => show({ title: 'Checking for updates…', progress: null })}>
            Indeterminate
          </Button>
        </div>
      </Stack>
      <ToastRegion regionId={region} placement={placement()} />
    </div>
  );
}

const Playground: Story = {
  description:
    'Pick a corner, then fire toasts into that region. Hover pauses the timer; swipe toward the edge dismisses. Works in Both scheme — each column has its own contained region.',
  render: () => <PlaygroundStory />,
};

export default {
  title: 'Feedback/Toast',
  description:
    'Imperative `toast.show / update / dismiss` with a placeable `<ToastRegion>`; status is an icon, not a tinted card.',
  stories: { Playground },
} satisfies StoryMeta;
