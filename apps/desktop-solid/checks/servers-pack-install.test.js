import {expect,test} from 'bun:test';
import {createPackFixtures,seedPackInstallPlan} from '../src/features/servers/fixtures-pack.ts';
const snapshot={connection:{role:'owner'},capabilities:{granted:['pack.edit','content.install']},pack:null};
const api=()=>createPackFixtures({server:()=>({snapshot}),software:()=> 'fabric',wait:async()=>{}});
test('install review fixtures expose provider, archive, conflicts and software switch',()=>{
 expect(seedPackInstallPlan('provider').skipped).toContain('mods/client-only.jar');
 expect(seedPackInstallPlan('archive').files.some(f=>f.path.startsWith('config/'))).toBe(true);
 expect(seedPackInstallPlan('conflicts').files[0].conflict).toBe('project_version');
 expect(seedPackInstallPlan('software_switch').softwareSwitchRequired).toBe(true);
});
test('install apply requires reviewed token and every choice; replays exact outcome',async()=>{
 const a=api();const p=await a.packInstallPlan('s',{source:{source:'draft',revision:'3'}});
 const req={planId:p.planId,confirmationToken:p.confirmationToken,choices:[],setAsModpack:false};
 await expect(a.packInstallApply('s',req,'missing-choice')).rejects.toMatchObject({code:'invalid_input'});
 const chosen={...req,choices:[{path:p.files[0].path,choice:'keep'}]};
 const result=await a.packInstallApply('s',chosen,'apply');
 expect(result.pendingIds).toHaveLength(0);expect(result.state).toBe('staged_until_restart');
 expect(await a.packInstallApply('s',chosen,'apply')).toEqual(result);
 await expect(a.packInstallApply('s',{...chosen,setAsModpack:true},'apply')).rejects.toBeDefined();
});

import { installCanProceedWithoutReview } from '../src/features/servers/modpack-area-model.ts';
test('early install consent pauses for runtime changes, warnings and destructive changes', () => {
 const p=seedPackInstallPlan('provider');
 const safe={...p,softwareSwitchRequired:false,valid:true,expiresAtMs:Date.now()+60000,warnings:[],removed:[],files:[{path:'mods/a.jar',sha256:'a'.repeat(64),expectedSha256:null,conflict:null,operation:'added'}]};
 expect(installCanProceedWithoutReview(safe,Date.now())).toBe(true);
 for(const patch of [{softwareSwitchRequired:true},{valid:false},{warnings:['missing_required_dependency:api']},{removed:[['mods/old.jar','a']]},{files:[{...safe.files[0],operation:'updated'}]},{expiresAtMs:0}]) expect(installCanProceedWithoutReview({...safe,...patch},Date.now())).toBe(false);
});


test('combined install binds acknowledgement to the reviewed software target', async () => {
 let software='paper', minecraft='1.20.1', switches=0;
 const a=createPackFixtures({server:()=>({snapshot}),software:()=>software,minecraftVersion:()=>minecraft,wait:async()=>{},switchSoftware:(_id,target)=>{software=target.software;minecraft=target.minecraftVersion;switches++;}});
 const p=await a.packInstallPlan('s',{source:{source:'provider',provider:'modrinth',projectId:'pack',versionId:'v1'}});
 expect(p.softwareSwitch.from.software).toBe('paper');
 expect(p.softwareSwitch.to.software).toBe('fabric');
 const req={planId:p.planId,confirmationToken:p.confirmationToken,choices:[],setAsModpack:false};
 await expect(a.packInstallApply('s',req,'unacknowledged')).rejects.toMatchObject({code:'stale_target'});
 expect(switches).toBe(0);
 await expect(a.packInstallApply('s',{...req,acknowledgeSoftwareSwitch:true,confirmationToken:'wrong'},'wrong')).rejects.toBeDefined();
 expect(switches).toBe(0);
 const acknowledged={...req,acknowledgeSoftwareSwitch:true};
 const result=await a.packInstallApply('s',acknowledged,'combined');
 expect(result.state).toBe('staged_until_restart');expect(software).toBe('fabric');
 expect(await a.packInstallApply('s',acknowledged,'combined')).toEqual(result);expect(switches).toBe(1);
});
