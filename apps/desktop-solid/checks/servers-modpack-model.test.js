import {expect,test} from 'bun:test';
import {seedServerModpackModel,createPackFixtures} from '../src/features/servers/fixtures-pack.ts';
import {seedPackSync} from '../src/features/servers/fixtures-pack-sync.ts';
test('server installation link and client offering are independent',()=>{
 for(const [scenario,linked,mode] of [['none',false,'none'],['linked-follow',true,'server-modpack'],['linked-custom',true,'custom'],['unlinked-custom',false,'custom']]){
  const view=seedServerModpackModel(scenario);expect(!!view.serverModpack).toBe(linked);expect(view.clientPack.mode).toBe(mode);
 }
});
test('server-sourced instance update retains required launch policy',()=>{
 expect(seedPackSync('optional_update').check).toMatchObject({status:'update_available',canLaunch:true});
 expect(seedPackSync('required_update').check).toMatchObject({status:'update_required',canLaunch:false});
});
test('install links server without changing the client publication, unlink preserves custom',async()=>{
 const snapshot={connection:{role:'owner'},capabilities:{granted:['pack.edit','pack.publish','content.install']},pack:null};
 const api=createPackFixtures({server:()=>({snapshot}),software:()=> 'fabric',wait:async()=>{}});
 const before=await api.packDraft('s');
 const plan=await api.packInstallPlan('s',{source:{source:'provider',provider:'modrinth',projectId:'pack',versionId:'v1'}});
 await api.packInstallApply('s',{planId:plan.planId,confirmationToken:plan.confirmationToken,choices:plan.files.filter(f=>f.conflict).map(f=>({path:f.path,choice:'replace'})),setAsModpack:true},'link');
 const after=await api.packDraft('s');expect(after.serverModpack.source.versionId).toBe('v1');expect(after.publishedRevision).toBe(before.publishedRevision);expect(snapshot.pack).toBeNull();
 await api.clientPackMode('s',{mode:'custom',requireUpdate:false},'custom');
 await expect(api.serverModpackUnlink('s',false,'pending-unlink')).rejects.toMatchObject({code:'conflict'});
 api.fixtureRestartServerModpack('s');
 await api.serverModpackUnlink('s',false,'unlink');
 const unlinked=await api.packDraft('s');expect(unlinked.serverModpack).toBeNull();expect(unlinked.clientPack.mode).toBe('custom');
});

test('provider discovery follows confirmed identity across staged updates and restart',async()=>{
 const snapshot={connection:{role:'owner'},capabilities:{granted:['pack.edit','content.install']},pack:null};
 const api=createPackFixtures({server:()=>({snapshot}),software:()=> 'fabric',wait:async()=>{}});
 const install=async(versionId,intent)=>{const p=await api.packInstallPlan('s',{source:{source:'provider',provider:'modrinth',projectId:'pack',versionId}});return api.packInstallApply('s',{planId:p.planId,confirmationToken:p.confirmationToken,choices:p.files.filter(f=>f.conflict).map(f=>({path:f.path,choice:'replace'})),setAsModpack:false},intent);};
 await install('v1','install');
 expect(await api.serverModpackUpdate('s')).toMatchObject({installed:null,pending:{source:{versionId:'v1'}},available:null});
 api.fixtureRestartServerModpack('s');
 expect(await api.serverModpackUpdate('s')).toMatchObject({installed:{source:{versionId:'v1'}},pending:null,available:{versionId:'v1-next'}});
 await install('v2','update');
 expect(await api.serverModpackUpdate('s')).toMatchObject({installed:{source:{versionId:'v1'}},pending:{source:{versionId:'v2'}},available:null});
 await expect(install('v3','race')).rejects.toMatchObject({code:'conflict'});
 api.fixtureRestartServerModpack('s');
 expect(await api.serverModpackUpdate('s')).toMatchObject({installed:{source:{versionId:'v2'}},pending:null});
});
