import { expect, test } from 'bun:test';
import { merge, omit } from 'solid-js';
import { mergeElementProps } from '../ui/internal/props';

test('tooltip and menu forwarding preserves both the action and overlay handlers', () => {
  const calls = [];
  const action = { onClick: () => calls.push('navigate'), ref: () => {} };
  const tooltip = { onClick: () => calls.push('tooltip'), ref: [() => {}] };
  const props = mergeElementProps(action, tooltip);
  const forwarded = merge(omit(props, 'label'), { 'aria-label': 'Back' });
  forwarded.onClick();
  expect(calls).toEqual(['navigate', 'tooltip']);
  expect(forwarded.ref).toEqual([action.ref, tooltip.ref]);
});

test('combined props retain live attributes and merged classes through nested spreads', () => {
  let disabled = false;
  const props = mergeElementProps({ class: 'action', get disabled() { return disabled; } }, { class: 'trigger' });
  const forwarded = merge(props, { type: 'button' });
  expect(forwarded.class).toBe('action trigger');
  expect(forwarded.disabled).toBe(false);
  disabled = true;
  expect(forwarded.disabled).toBe(true);
});
test('prop forwarding stays quiet in Solid diagnostics', async () => {
  const { captureArtifact, expectNoDiagnostics } = await import('@solidjs/diagnostics');
  const { artifact } = await captureArtifact(() => {
    const props = mergeElementProps({ onClick: () => {}, ref: () => {} }, { onClick: () => {}, ref: [] });
    merge(omit(props, 'label'), { type: 'button' }).onClick();
  }, { scenario: 'icon-button-trigger-props' });
  expectNoDiagnostics(artifact);
});
