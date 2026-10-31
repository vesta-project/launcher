import { mergePlayers, filterPlayers, filterCounts } from '../apps/desktop-solid/src/features/servers/player-manager';
import { ConsoleBuffer } from '../apps/desktop-solid/src/features/servers/console-model';
import { toLogEntries } from '../apps/desktop-solid/src/features/servers/console-view';
const count = Number(process.env.PLAYERS ?? 12000);
const names = Array.from({length: count}, (_, i) => `Player${String(i).padStart(5, '0')}`);
const timings: number[] = [];
const cpu = process.cpuUsage(); const start = performance.now();
let rows = 0;
for (let i=0;i<12;i++) {
 const at=performance.now();
 const players=mergePlayers({roster:{known:true,names,playerCount:count,generation:'1'} as any});
 filterCounts(players); rows=filterPlayers(players,'all').length;
 timings.push(performance.now()-at);
}
const buffer=new ConsoleBuffer(); const cache=new WeakMap();
for(let batch=0;batch<100;batch++) {
 buffer.append(Array.from({length:200},(_,i)=>({cursor:String(batch*200+i+1),text:`[INFO] Player${i} joined the game`,stream:'stdout',truncated:false,observedAtMs:0})) as any);
 toLogEntries(buffer.entries,{label:'Gap'},cache);
}
const elapsed=performance.now()-start;
console.log(JSON.stringify({players:count,rosterRows:rows,mergeP50Ms:timings.sort((a,b)=>a-b)[6],mergeP95Ms:timings.at(-1),elapsedMs:elapsed,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssBytes:process.memoryUsage().rss,heapBytes:process.memoryUsage().heapUsed,rosterPayloadBytes:JSON.stringify({items:names.map(name=>({name}))}).length,consoleLines:20000,consoleRetained:buffer.entries.length,eventsPerSecond:20000/(elapsed/1000)},null,2));
