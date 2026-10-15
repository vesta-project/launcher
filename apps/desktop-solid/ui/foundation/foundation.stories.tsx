import { For } from 'solid-js';
import { Row, Section, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';


function Swatch(props: { name: string; text?: string }) {
  return (
    <div style={{ display: 'grid', gap: '4px', width: '112px', 'font-size': 'var(--vesta-text-xs)' }}>
      <div
        style={{
          height: '40px',
          'border-radius': 'var(--vesta-radius-md)',
          border: '1px solid var(--vesta-color-border)',
          background: `var(--vesta-color-${props.name})`,
          color: props.text ? `var(--vesta-color-${props.text})` : undefined,
          display: 'grid',
          'place-items': 'center',
          'font-weight': 600,
        }}
      >
        {props.text ? 'Aa' : ''}
      </div>
      <code style={{ color: 'var(--vesta-color-text-muted)' }}>{props.name}</code>
    </div>
  );
}

const Colors: Story = {
  render: () => (
    <Stack gap={8}>
      <Section title="Surfaces">
        <Row>
          <For each={['canvas', 'surface', 'surface-raised', 'surface-sunken', 'fill', 'fill-hover', 'fill-active']}>{(name) => (
            <Swatch name={name} text="text" />
          )}</For>
        </Row>
      </Section>
      <Section title="Text and lines">
        <Row>
          <For each={['text', 'text-muted', 'text-subtle', 'border', 'border-strong', 'focus']}>{(name) => (
            <Swatch name={name} />
          )}</For>
        </Row>
      </Section>
      <Section title="Tones (solid · on-solid · text)">
        <Stack gap={8}>
          <For each={['accent', 'danger', 'warning', 'success']}>{(tone) => (
            <Row>
              <Swatch name={tone} text={`on-${tone}`} />
              <Swatch name={`${tone}-hover`} text={`on-${tone}`} />
              <Swatch name={`${tone}-active`} text={`on-${tone}`} />
              <Swatch name={`${tone}-text`} />
              <Swatch name={`${tone}-border`} />
            </Row>
          )}</For>
        </Stack>
      </Section>
    </Stack>
  ),
};

const Scales: Story = {
  render: () => (
    <Stack gap={8}>
      <Section title="Space">
        <Stack gap={4}>
          <For each={['0-5', '1', '1-5', '2', '3', '4', '5', '6', '8', '10', '12']}>{(step) => (
            <Row label={`space-${step}`}>
              <div style={{ width: `var(--vesta-space-${step})`, height: '12px', background: 'var(--vesta-color-accent)' }} />
            </Row>
          )}</For>
        </Stack>
      </Section>
      <Section title="Radii">
        <Row>
          <For each={['sm', 'md', 'lg', 'xl', 'full']}>{(radius) => (
            <div
              style={{
                width: '64px',
                height: '40px',
                'border-radius': `var(--vesta-radius-${radius})`,
                background: 'var(--vesta-color-fill)',
                border: '1px solid var(--vesta-color-border-strong)',
                display: 'grid',
                'place-items': 'center',
                'font-size': 'var(--vesta-text-xs)',
              }}
            >
              {radius}
            </div>
          )}</For>
        </Row>
      </Section>
      <Section title="Type">
        <Stack gap={8}>
          <For each={['xs', 'sm', 'md', 'lg', 'xl', '2xl']}>{(size) => (
            <Row label={`text-${size}`}>
              <span style={{ 'font-size': `var(--vesta-text-${size})` }}>Launch your instance</span>
            </Row>
          )}</For>
        </Stack>
      </Section>
      <Section title="Shadows">
        <Row gap={24}>
          <For each={['sm', 'md', 'lg']}>{(shadow) => (
            <div
              style={{
                width: '96px',
                height: '56px',
                'border-radius': 'var(--vesta-radius-container)',
                background: 'var(--vesta-color-surface-raised)',
                'box-shadow': `var(--vesta-shadow-${shadow})`,
                display: 'grid',
                'place-items': 'center',
                'font-size': 'var(--vesta-text-xs)',
              }}
            >
              {shadow}
            </div>
          )}</For>
        </Row>
      </Section>
    </Stack>
  ),
};

export default {
  title: 'Foundations/Tokens',
  description: 'The --vesta-* tokens components consume. The launcher overrides these names; it does not add parallel ones.',
  stories: { Colors, Scales },
} satisfies StoryMeta;
