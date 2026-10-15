import {
  Carousel,
  CarouselControls,
  CarouselSlide,
  CarouselViewport,
} from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { For } from 'solid-js';

const slides = [
  { title: 'Screenshots', body: 'Browse captured game shots.' },
  { title: 'Resource packs', body: 'Preview textures before enabling.' },
  { title: 'Mods', body: 'Page through gallery cards.' },
];

const slideStyle = {
  padding: 'var(--vesta-space-4)',
  'border-radius': 'var(--vesta-radius-container)',
  background: 'var(--vesta-color-surface-raised)',
  border: 'var(--vesta-border-width) solid var(--vesta-color-border)',
  'min-block-size': '140px',
};

const Basic: Story = {
  render: () => (
    <Stack>
      <div style={{ width: '420px' }}>
        <Carousel aria-label="Featured content">
          <CarouselViewport>
            <For each={slides}>
              {(slide) => (
                <CarouselSlide>
                  <div style={slideStyle}>
                    <div style={{ 'font-weight': 'var(--vesta-weight-medium)' }}>{slide.title}</div>
                    <div style={{ color: 'var(--vesta-color-text-muted)', 'margin-block-start': '8px' }}>
                      {slide.body}
                    </div>
                  </div>
                </CarouselSlide>
              )}
            </For>
          </CarouselViewport>
          <CarouselControls />
        </Carousel>
      </div>
    </Stack>
  ),
};

export default {
  title: 'Display/Carousel',
  description: 'Scroll-snap slides with previous/next controls; no Embla dependency.',
  stories: { Basic },
} satisfies StoryMeta;
