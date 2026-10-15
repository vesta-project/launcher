import { For } from 'solid-js';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';


const steps = Array.from({ length: 12 }, (_, index) => index + 1);

function Scale(props: { name: string }) {
  return (
    <Row label={props.name} gap={2}>
      <For each={steps}>{(step) => (
        <div
          title={`--vesta-${props.name}-${step}`}
          style={{
            width: '40px',
            height: '32px',
            background: `var(--vesta-${props.name}-${step}, transparent)`,
            display: 'grid',
            'place-items': 'center',
            'font-size': 'var(--vesta-text-xs)',
            color: step < 9 ? 'var(--vesta-color-text-muted)' : 'white',
          }}
        >
          {step}
        </div>
      )}</For>
    </Row>
  );
}

const Scales: Story = {
  render: () => (
    <Stack gap={8}>
      <Scale name="neutral" />
      <Scale name="accent" />
    </Stack>
  ),
};

export default {
  title: 'Launcher/Palettes',
  description: 'Generated from --vesta-accent-hue / -chroma. Select the “Vesta launcher” theme; UI defaults have no palettes.',
  stories: { Scales },
} satisfies StoryMeta;
