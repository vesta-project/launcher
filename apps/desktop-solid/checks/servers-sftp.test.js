import { describe, expect, test } from 'bun:test';
import { SFTP_DEFAULT_PORT, sftpLink, sftpUrlHost, sftpUrlPath } from '../src/features/servers/hosting-model';

describe('[sftp] links for the folder being browsed', () => {
  test('root link with a custom port', () => {
    expect(sftpLink({ host: 'mc.example.com', port: 2222, username: 'u1', path: '' })).toBe('sftp://u1@mc.example.com:2222/');
  });

  test('default port is left out', () => {
    expect(SFTP_DEFAULT_PORT).toBe(22);
    expect(sftpLink({ host: 'mc.example.com', port: 22, username: 'u1' })).toBe('sftp://u1@mc.example.com/');
  });

  test('folders are percent-encoded per segment and end with a slash', () => {
    expect(sftpUrlPath('world/datapacks')).toBe('/world/datapacks/');
    expect(sftpUrlPath('/my world/50%#?/')).toBe('/my%20world/50%25%23%3F/');
    expect(sftpUrlPath('plugins\\Essentials')).toBe('/plugins/Essentials/');
    expect(sftpUrlPath('./config//')).toBe('/config/');
    expect(sftpLink({ host: 'h', port: 2022, username: 'u', path: 'world/ä b' })).toBe('sftp://u@h:2022/world/%C3%A4%20b/');
  });

  test('IPv6 hosts are bracketed once', () => {
    expect(sftpUrlHost('2001:db8::1')).toBe('[2001:db8::1]');
    expect(sftpUrlHost('[2001:db8::1]')).toBe('[2001:db8::1]');
    expect(sftpUrlHost('192.168.1.4')).toBe('192.168.1.4');
    expect(sftpLink({ host: '::1', port: 2222, username: 'u', path: 'logs' })).toBe('sftp://u@[::1]:2222/logs/');
  });

  test('usernames with URL characters are encoded', () => {
    expect(sftpLink({ host: 'h', port: 22, username: 'user@id:x' })).toBe('sftp://user%40id%3Ax@h/');
  });
});
