import { Badge } from '@vesta/ui/components/badge';
import type { BadgeVariant } from '@vesta/ui/components/badge';
import type { Tone } from '@vesta/ui';
import { AlertIcon, CheckIcon, InfoIcon } from '@workbench/icons';
import { Matrix, Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';

const tones: Tone[] = ['neutral', 'accent', 'danger', 'warning', 'success'];
const variants: BadgeVariant[] = ['soft', 'solid', 'outline'];

const Variants: Story = {
  description: 'Every tone in every variant. Soft neutral is the default badge.',
  render: () => (
    <Matrix rows={tones} cols={variants} render={(tone, variant) => <Badge tone={tone} variant={variant}>Badge</Badge>} />
  ),
};

const Sizes: Story = {
  render: () => (
    <Stack>
      <Row label="md">
        <Badge>Fabric</Badge>
        <Badge tone="accent" variant="solid">
          128
        </Badge>
        <Badge tone="success" variant="outline">
          Installed
        </Badge>
      </Row>
      <Row label="sm">
        <Badge size="sm">Fabric</Badge>
        <Badge size="sm" tone="accent" variant="solid">
          128
        </Badge>
        <Badge size="sm" tone="success" variant="outline">
          Installed
        </Badge>
      </Row>
    </Stack>
  ),
};

const WithIcons: Story = {
  render: () => (
    <Stack>
      <Row label="md">
        <Badge tone="success" icon={<CheckIcon />}>
          Installed
        </Badge>
        <Badge tone="warning" icon={<AlertIcon />}>
          Outdated
        </Badge>
        <Badge tone="accent" variant="outline" icon={<InfoIcon />}>
          New
        </Badge>
      </Row>
      <Row label="sm">
        <Badge size="sm" tone="success" icon={<CheckIcon />}>
          Installed
        </Badge>
        <Badge size="sm" tone="warning" icon={<AlertIcon />}>
          Outdated
        </Badge>
        <Badge size="sm" tone="accent" variant="outline" icon={<InfoIcon />}>
          New
        </Badge>
      </Row>
    </Stack>
  ),
};

const InContext: Story = {
  description: 'A mod list row: name and version text with status badges.',
  render: () => (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        width: '480px',
        padding: '8px 12px',
        border: '1px solid var(--vesta-color-border)',
        'border-radius': 'var(--vesta-radius-container)',
        background: 'var(--vesta-color-surface)',
      }}
    >
      <span style={{ 'font-weight': 'var(--vesta-weight-medium)' }}>Sodium</span>
      <span style={{ color: 'var(--vesta-color-text-muted)', 'font-size': 'var(--vesta-text-sm)' }}>0.6.13</span>
      <div style={{ display: 'flex', gap: '4px', 'margin-inline-start': 'auto' }}>
        <Badge>Fabric</Badge>
        <Badge tone="accent">Update available</Badge>
        <Badge tone="danger">Incompatible</Badge>
      </div>
    </div>
  ),
};

export default {
  title: 'Display/Badge',
  description: 'Small static label for a status, loader or count. Badges are not interactive.',
  stories: { Variants, Sizes, WithIcons, InContext },
} satisfies StoryMeta;
