import type { JSX } from '@solidjs/web';

/**
 * Story files (`*.stories.tsx`, anywhere under ui/ or src/) default-export a
 * StoryMeta whose `stories` record lists the stories in display order. (Module
 * namespace keys are always sorted, so named exports cannot carry an order.)
 *
 * ```tsx
 * const Variants: Story = { render: () => <Button>Save</Button> };
 * export default { title: 'Controls/Button', stories: { Variants } } satisfies StoryMeta;
 * ```
 */
export interface StoryMeta {
  /** Sidebar path, `Group/Component`. */
  title: string;
  description?: string;
  /** Keyed by name; key order is display order. */
  stories: Record<string, Story>;
}

export interface Story {
  /** Defaults to the record key split into words ("IconOnly" → "Icon only"). */
  name?: string;
  description?: string;
  /** `padded` (default) adds canvas padding; `fullscreen` gives the story the whole canvas. */
  layout?: 'padded' | 'fullscreen';
  render: () => JSX.Element;
}
