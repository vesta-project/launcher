import { Slider } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const column = { width: '320px' };

/** Solid component — do not put createSignal inside Story.render(); StoryView calls render() as a plain function. */
function BasicStory() {
  const [memory, setMemory] = createSignal([4096]);
  const [range, setRange] = createSignal([2048, 8192]);
  return (
    <Stack>
      <div style={column}>
        <Slider
          label="Allocated memory"
          description="This pack recommends at least 6 GB."
          value={memory()}
          onChange={setMemory}
          min={1024}
          max={16384}
          step={512}
          getValueLabel={(value) => `${(value[0]! / 1024).toFixed(1)} GB`}
        />
      </div>
      <div style={column}>
        <Slider
          label="Memory range"
          description="Recommended allocation window for this pack."
          value={range()}
          onChange={setRange}
          min={1024}
          max={16384}
          step={512}
          minStepsBetweenThumbs={1}
          getValueLabel={(value) =>
            `${(value[0]! / 1024).toFixed(1)} – ${(value[1]! / 1024).toFixed(1)} GB`
          }
          aria-label-thumbs={['Minimum memory', 'Maximum memory']}
        />
      </div>
      <div style={column}>
        <Slider label="Accent hue" defaultValue={[185]} min={0} max={360} getValueLabel={(value) => `${value[0]}°`} />
      </div>
    </Stack>
  );
}

const Basic: Story = {
  render: () => <BasicStory />,
};

const States: Story = {
  render: () => (
    <Stack>
      <div style={column}>
        <Slider
          label="Sync interval"
          defaultValue={[30]}
          min={5}
          max={120}
          error="Must be at least 5 minutes."
          getValueLabel={(v) => `${v[0]} min`}
        />
      </div>
      <div style={column}>
        <Slider label="Grain strength" defaultValue={[40]} disabled />
      </div>
      <div style={column}>
        <Slider label="Compact" size="sm" defaultValue={[50]} showValue={false} aria-label="Compact slider" />
      </div>
    </Stack>
  ),
};

export default {
  title: 'Controls/Slider',
  description: 'A labelled range control; value sits beside the label, track uses accent fill. Supports multi-thumb ranges.',
  stories: { Basic, States },
} satisfies StoryMeta;
