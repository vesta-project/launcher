import {expect,test} from 'bun:test';
import {createPackFixtures,seedArchiveInspection,seedRedesignWorkspace} from '../src/features/servers/fixtures-pack.ts';
import {uploadPackBytes} from '../src/features/servers/native-pack.ts';
const host=()=>({snapshot:{connection:{role:'owner'},capabilities:{granted:['pack.edit','pack.build','pack.publish']},pack:{hostedRevision:'14',minimumRevision:'12',status:'published'}}});
test('override write/read, subtree rename, trash, revision and exact retries',async()=>{
 const api=createPackFixtures({server:host,software:()=> 'fabric',wait:async()=>{}});
 const request={expectedRevision:'3',change:{operation:'write',root:'overrides',path:'config/a.txt',contentBase64:btoa('hello')}};
 const first=await api.packFileMutate('s',request,'write');
 expect(first.revision).toBe('4'); expect(await api.packFileMutate('s',request,'write')).toEqual(first);
 expect(atob((await api.packFileRead('s',{root:'overrides',path:'config/a.txt',expectedRevision:'4'})).contentBase64)).toBe('hello');
 await expect(api.packFileMutate('s',request,'stale')).rejects.toMatchObject({code:'stale_target'});
 await api.packFileMutate('s',{expectedRevision:'4',change:{operation:'rename',root:'overrides',path:'config',destination:'defaultconfigs'}},'rename');
 const draft=await api.packFileMutate('s',{expectedRevision:'5',change:{operation:'trash',root:'overrides',path:'defaultconfigs'}},'trash');
 expect(draft.manifest.overrideFiles[0].trashed).toBe(true);
 await expect(api.packFileRead('s',{root:'overrides',path:'defaultconfigs/a.txt',expectedRevision:'6'})).rejects.toMatchObject({code:'not_found'});
});
test('archive fixtures distinguish entry provider IDs from pack identity for every format',()=>{
 for(const format of ['mrpack','curseforge','zip']) {
 const result=seedArchiveInspection(format); expect(result.format).toBe(format); expect(result.providerPack).toBeNull();
 expect(result.entryCount).toBe(result.manifest.entries.length); expect(result.overrides.length).toBeGreaterThan(0);
 }
});
test('archive inspection uses completed owned archive uploads without changing revision',async()=>{
 const api=createPackFixtures({server:host,software:()=> 'fabric',wait:async()=>{}});
 await expect(api.packArchiveInspect('s','missing')).rejects.toMatchObject({code:'not_found'});
 const upload=await uploadPackBytes(api,'s',new TextEncoder().encode('fixture'),true,'archive');
 const before=await api.packDraft('s'); expect((await api.packArchiveInspect('s',upload.uploadId)).format).toBe('mrpack');
 expect(await api.packDraft('s')).toEqual(before);
});

test('provider pointer publication preserves custom draft and exposes provider and override fixtures',async()=>{
 const target=host(); const api=createPackFixtures({server:()=>target,software:()=> 'fabric',wait:async()=>{}});
 const before=await api.packDraft('s');
 const request={expectedRevision:'14',draftRevision:'3',provider:'modrinth',projectId:'pack',versionId:'v1',requiredUpdate:false,acknowledgeLowerVersion:false};
 expect(await api.packProviderPublish('s',request,'pointer')).toEqual({hostedRevision:'15',minimumRevision:'12'});
 expect((await api.packDraft('s')).draft).toEqual(before.draft);
 expect((await api.packDraft('s')).providerPack.versionId).toBe('v1');
 expect(seedRedesignWorkspace('provider').providerPack.provider).toBe('modrinth');
 expect(seedRedesignWorkspace('overrides').draft.manifest.overrideFiles).toHaveLength(5);
});
