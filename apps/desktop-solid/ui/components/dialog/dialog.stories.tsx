import { Button, Dialog, TextField } from '@vesta/ui';
import { TrashIcon } from '@workbench/icons';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';

const Confirm: Story = {
  description: 'Destructive confirmation; the primary action is last.',
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        size="sm"
        title="Delete “Survival”?"
        description="The instance folder, worlds and screenshots will be moved to the trash."
        trigger={(props) => (
          <Button {...props} tone="danger" variant="outline" icon={<TrashIcon />}>
            Delete instance
          </Button>
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button tone="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </>
        }
      />
    );
  },
};

const Form: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        title="New instance"
        trigger={(props) => (
          <Button {...props} tone="accent">
            New instance
          </Button>
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button tone="accent" onClick={() => setOpen(false)}>
              Create
            </Button>
          </>
        }
      >
        <Stack gap={12}>
          <TextField label="Name" placeholder="My instance" />
          <TextField label="Game version" defaultValue="1.21.4" description="Pick a loader on the next step." />
        </Stack>
      </Dialog>
    );
  },
};

const LongContent: Story = {
  description: 'The dialog stays inside the window; header and footer stay put and the body scrolls, with a divider at an edge only while content continues past it.',
  render: () => {
    const [open, setOpen] = createSignal(false);
    return (
    <Row>
      <Dialog
        size="lg"
        title="Changelog"
        open={open()}
        onOpenChange={setOpen}
        trigger={(props) => <Button {...props}>Show changelog</Button>}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        <div style={{ 'white-space': 'pre-line' }}>
          {Array.from({ length: 40 }, (_, index) => `• Fixed issue #${1000 + index} affecting instance imports.`).join('\n')}
        </div>
      </Dialog>
    </Row>
    );
  },
};

export default {
  title: 'Overlays/Dialog',
  stories: { Confirm, Form, LongContent },
} satisfies StoryMeta;
