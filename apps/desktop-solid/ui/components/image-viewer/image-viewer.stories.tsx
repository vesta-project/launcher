import { Button, ImageViewer } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const images = [
  {
    src: 'https://picsum.photos/seed/vesta-a/1280/720',
    title: 'Spawn vista',
    date: '15 Oct 2026',
  },
  {
    src: 'https://picsum.photos/seed/vesta-b/1280/720',
    title: 'Nether hub',
    date: '12 Oct 2026',
  },
  {
    src: 'https://picsum.photos/seed/vesta-c/1280/720',
    title: 'Build progress',
    date: '8 Oct 2026',
  },
];

function BasicStory() {
  const [open, setOpen] = createSignal(false);
  const [index, setIndex] = createSignal(0);
  const [log, setLog] = createSignal('');
  return (
    <Stack>
      <Button
        tone="accent"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        Open gallery
      </Button>
      <ShowLog text={log()} />
      <ImageViewer
        open={open()}
        onOpenChange={setOpen}
        images={images}
        index={index()}
        onIndexChange={setIndex}
        onCopy={(src) => setLog(`Copy ${src}`)}
        onDownload={(src) => setLog(`Download ${src}`)}
        onOpenFolder={(src) => setLog(`Open folder ${src}`)}
        onDelete={(src) => setLog(`Delete ${src}`)}
      />
    </Stack>
  );
}

function ShowLog(props: { text: string }) {
  return (
    <div style={{ color: 'var(--vesta-color-text-muted)', 'font-size': 'var(--vesta-text-sm)' }}>
      {props.text || 'Actions log here (copy / download / folder / delete).'}
    </div>
  );
}

const Basic: Story = {
  render: () => <BasicStory />,
};

export default {
  title: 'Display/Image viewer',
  description:
    'Fullscreen lightbox with gallery nav, click-to-zoom + pan, idle chrome, and action callbacks.',
  stories: { Basic },
} satisfies StoryMeta;
