import { expect, test } from 'bun:test';
import { mergePlayers, playerPage, PLAYER_PAGE_SIZE } from '../src/features/servers/player-manager';
import { ConsoleBuffer } from '../src/features/servers/console-model';

test('12K-player roster has accessible bounded pages without losing players', () => {
  const names = Array.from({length: 12000}, (_, i) => `Player${String(i).padStart(5, '0')}`);
  const players = mergePlayers({roster:{known:true, names, playerCount:12000}});
  const visited = new Set();
  for (let page = 0; page < 120; page++) {
    const rows = playerPage(players, page);
    expect(rows.length).toBe(PLAYER_PAGE_SIZE);
    for (const row of rows) visited.add(row.name);
  }
  expect(visited.size).toBe(12000);
  expect(playerPage(players, 999)).toEqual(playerPage(players, 119));
});

test('console flood stays bounded and duplicate cursors are ignored', () => {
  const buffer = new ConsoleBuffer();
  for(let i=0;i<20000;i++) buffer.append([{cursor:String(i),text:'join',stream:'stdout',truncated:false}]);
  expect(buffer.entries.length).toBe(5000);
  expect(buffer.append([{cursor:'19999',text:'duplicate',stream:'stdout',truncated:false}])).toBe(0);
});
