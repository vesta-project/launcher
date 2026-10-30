import { expect, test } from 'bun:test';
import { deferAction } from '../ui/components/toast/deferred-action';
const wait = () => new Promise(resolve => setTimeout(resolve, 25));
test('Undo cancels the permanent request and restores exactly once', async () => {
 let commits=0, restores=0;
 const cancel=deferAction({delay:10,commit:async()=>{commits++;},rollback:()=>restores++,onCommit:()=>{},onError:()=>{}});
 cancel();cancel();await wait();expect(commits).toBe(0);expect(restores).toBe(1);
});
test('expiry commits once; a later Undo cannot restore an applied action', async () => {
 let commits=0,restores=0;
 const cancel=deferAction({delay:10,commit:async()=>{commits++;},rollback:()=>restores++,onCommit:()=>{},onError:()=>{}});
 await wait();cancel();expect(commits).toBe(1);expect(restores).toBe(0);
});
test('failed permanent requests restore the optimistic state and report failure', async () => {
 let restores=0,error;
 deferAction({delay:1,commit:async()=>{throw 'offline';},rollback:()=>restores++,onCommit:()=>{},onError:reason=>error=reason});
 await wait();expect(restores).toBe(1);expect(error).toBe('offline');
});
