import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';
import { MAX_SERVER_ICON_BYTES } from '../src/features/servers/native-branding';

describe('server branding fixtures', () => {
  test('patches preserve omitted fields, enforce revision and validate input', async () => {
    const api = createFixtureServers({ latencyMs: 0 });
    const initial = await api.branding('fixture-survival');
    const saved = await api.updateBranding('fixture-survival', { description: 'A friendly server' }, initial.revision, 'b1');
    expect(saved).toEqual({ name: initial.name, description: 'A friendly server', revision: '1' });
    await expect(api.updateBranding('fixture-survival', { name: 'New' }, '0', 'b2')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(api.updateBranding('fixture-survival', { name: '' }, '1', 'b3')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(api.updateBranding('fixture-survival', {}, '1', 'b4')).rejects.toMatchObject({ code: 'invalid_input' });
    const cleared = await api.updateBranding('fixture-survival', { description: '' }, '1', 'b5');
    expect(cleared.description).toBe('');
    await expect(api.updateBranding('fixture-creative', { name: 'New' }, '0', 'b6')).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('icon create, replacement, clear and bounded base64 validation', async () => {
    const api = createFixtureServers({ latencyMs: 0 });
    const png = btoa('\x89PNG\r\n\x1a\nfixture');
    expect(await api.icon('fixture-survival')).toBeNull();
    await api.setIcon('fixture-survival', png, 'i1');
    expect(await api.icon('fixture-survival')).toBe(png);
    const replacement = btoa('\x89PNG\r\n\x1a\nreplacement');
    await api.setIcon('fixture-survival', replacement, 'i2');
    expect(await api.icon('fixture-survival')).toBe(replacement);
    await expect(api.setIcon('fixture-survival', btoa('bad'), 'i3')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(api.setIcon('fixture-survival', btoa('\x89PNG\r\n\x1a\n' + 'x'.repeat(MAX_SERVER_ICON_BYTES)), 'i4')).rejects.toMatchObject({ code: 'invalid_input' });
    await api.clearIcon('fixture-survival', 'i5');
    await api.clearIcon('fixture-survival', 'i6');
    expect(await api.icon('fixture-survival')).toBeNull();
  });
  test('rename applies to shared device list and enforces ownership', async () => {
    const api = createFixtureServers({ latencyMs: 0 });
    expect(await api.renameDevice('fixture-survival', 'd-laptop', 'Holiday PC', 'd1')).toEqual({ id: 'd-laptop', name: 'Holiday PC' });
    expect((await api.devices('fixture-survival')).find((d) => d.id === 'd-laptop').name).toBe('Holiday PC');
    await expect(api.renameDevice('fixture-survival', 'd-rae', 'Other', 'd2')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.renameDevice('fixture-survival', 'd-self', 'x'.repeat(65), 'd3')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
