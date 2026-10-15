import { Pagination } from '@vesta/ui';
import { Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

function BasicStory() {
  const [page, setPage] = createSignal(3);
  return (
    <Stack>
      <Pagination count={12} page={page()} onPageChange={setPage} />
      <div style={{ color: 'var(--vesta-color-text-muted)', 'font-size': 'var(--vesta-text-sm)' }}>
        Page {page()} of 12
      </div>
      <Pagination count={5} defaultPage={1} />
      <Pagination count={8} defaultPage={4} disabled />
    </Stack>
  );
}

const Basic: Story = {
  render: () => <BasicStory />,
};

export default {
  title: 'Navigation/Pagination',
  description: 'Previous/next and page numbers for long lists.',
  stories: { Basic },
} satisfies StoryMeta;
