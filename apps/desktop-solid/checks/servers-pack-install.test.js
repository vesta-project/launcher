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
 const req={planId:p.planId,confirmationToken:p.confirmationToken,choices:[],acknowledgeWarnings:true,setAsModpack:false};
 await expect(a.packInstallApply('s',req,'missing-choice')).rejects.toMatchObject({code:'invalid_input'});
 const chosen={...req,choices:[{path:p.files[0].path,choice:'keep'}]};
 const result=await a.packInstallApply('s',chosen,'apply');
 expect(result.pendingIds).toHaveLength(0);expect(result.state).toBe('staged_until_restart');
 expect(await a.packInstallApply('s',chosen,'apply')).toEqual(result);
 await expect(a.packInstallApply('s',{...chosen,acknowledgeWarnings:true,setAsModpack:true},'apply')).rejects.toBeDefined();
});

import { installCanProceedWithoutReview } from '../src/features/servers/modpack-area-model.ts';
test('early install consent pauses for runtime changes, warnings and destructive changes', () => {
 const p=seedPackInstallPlan('provider');
 const safe={...p,softwareSwitchRequired:false,valid:true,expiresAtMs:Date.now()+60000,warnings:[],removed:[],files:[{path:'mods/a.jar',sha256:'a'.repeat(64),expectedSha256:null,conflict:null,operation:'added'}]};
 expect(installCanProceedWithoutReview(safe,Date.now())).toBe(true);
 for(const patch of [{softwareSwitchRequired:true},{valid:false},{warnings:['missing_required_dependency:api']},{removed:[['mods/old.jar','a']]},{files:[{...safe.files[0],operation:'updated'}]},{expiresAtMs:0}]) expect(installCanProceedWithoutReview({...safe,...patch},Date.now())).toBe(false);
});

import { backupProfileFor, planSoftwareSwitch, reviewApplyRequest, reviewBlocker, reviewCounts, reviewEmpty, runtimeLabel } from '../src/features/servers/pack-install-review.ts';
test('a software switch is part of the install and needs one acknowledgement', () => {
 const p=seedPackInstallPlan('software_switch');
 const current={software:'paper',minecraftVersion:'1.21.4',loaderVersion:null};
 expect(planSoftwareSwitch(p,current)).toEqual({from:current,to:{software:'fabric',minecraftVersion:'1.21.5',loaderVersion:'0.16.10'}});
 expect(planSoftwareSwitch({...p,softwareSwitch:{from:current,to:{software:'forge',minecraftVersion:'1.20.1',loaderVersion:'47'}}})?.to.software).toBe('forge');
 expect(runtimeLabel(planSoftwareSwitch(p).to)).toBe('Fabric 1.21.5');
 const picks=Object.fromEntries(p.files.filter(f=>f.conflict).map(f=>[f.path,'keep']));
 expect(reviewBlocker(p,false)).toBe('server-pack.review-switch-needs-ack');
 expect(reviewApplyRequest(p,picks,false)).toBeNull();
 expect(reviewBlocker(p,true)).toBeNull();
 expect(reviewApplyRequest(p,picks,true)).toMatchObject({planId:p.planId,acknowledgeSoftwareSwitch:true});
 const plain=seedPackInstallPlan('provider');
 const plainPicks=Object.fromEntries(plain.files.filter(f=>f.conflict).map(f=>[f.path,'keep']));
 expect(planSoftwareSwitch(plain)).toBeNull();
 expect(reviewApplyRequest(plain,plainPicks,false)).not.toHaveProperty('acknowledgeSoftwareSwitch');
 expect(reviewBlocker({...plain,valid:false},true)).toBe('server-pack.install-invalid');
});
test('review counts list non-empty groups in order and skip unchanged files', () => {
 const base=seedPackInstallPlan('provider');
 const file=(path,operation,conflict=null)=>({path,operation,conflict,sha256:'a'.repeat(64),expectedSha256:null});
 const plan={...base,files:[file('mods/a.jar','added'),file('mods/b.jar','updated'),file('mods/c.jar','unchanged'),file('config/x.json','added'),file('mods/d.jar','added','same_filename')],removed:[['mods/old.jar','h']],skipped:['mods/client.jar']};
 expect(reviewCounts(plan).map(g=>[g.key,g.paths.length])).toEqual([['added',2],['updated',1],['removed',1],['overrides',1],['skipped',1]]);
 expect(reviewEmpty(plan)).toBe(false);
 expect(reviewEmpty({...plan,files:[file('mods/c.jar','unchanged')],removed:[]})).toBe(true);
 expect(reviewEmpty({...plan,files:[file('mods/c.jar','unchanged','project_version')],removed:[],skipped:[]})).toBe(false);
});
test('back up first picks a profile that can run now', () => {
 const profiles=[{name:'nightly',mode:'stopped'},{name:'live',mode:'online'}];
 expect(backupProfileFor(profiles,true)).toBe('live');
 expect(backupProfileFor(profiles,false)).toBe('nightly');
 expect(backupProfileFor([{name:'nightly',mode:'stopped'}],true)).toBeNull();
 expect(backupProfileFor([],false)).toBeNull();
});

test('combined install binds acknowledgement to the reviewed software target', async () => {
 let software='paper', minecraft='1.20.1', switches=0;
 const a=createPackFixtures({server:()=>({snapshot}),software:()=>software,minecraftVersion:()=>minecraft,wait:async()=>{},switchSoftware:(_id,target)=>{software=target.software;minecraft=target.minecraftVersion;switches++;}});
 const p=await a.packInstallPlan('s',{source:{source:'provider',provider:'modrinth',projectId:'pack',versionId:'v1'}});
 expect(p.softwareSwitch.from.software).toBe('paper');
 expect(p.softwareSwitch.to.software).toBe('fabric');
 const req={planId:p.planId,confirmationToken:p.confirmationToken,choices:[],acknowledgeWarnings:true,setAsModpack:false};
 await expect(a.packInstallApply('s',req,'unacknowledged')).rejects.toMatchObject({code:'stale_target'});
 expect(switches).toBe(0);
 await expect(a.packInstallApply('s',{...req,acknowledgeSoftwareSwitch:true,confirmationToken:'wrong'},'wrong')).rejects.toBeDefined();
 expect(switches).toBe(0);
 const acknowledged={...req,acknowledgeSoftwareSwitch:true};
 const result=await a.packInstallApply('s',acknowledged,'combined');
 expect(result.state).toBe('staged_until_restart');expect(software).toBe('fabric');
 expect(await a.packInstallApply('s',acknowledged,'combined')).toEqual(result);expect(switches).toBe(1);
});

test('warnings require explicit acknowledgement', async () => {
 const a=api(), p=await a.packInstallPlan('s',{source:{source:'draft',revision:'3'}});
 await expect(a.packInstallApply('s',{planId:p.planId,confirmationToken:p.confirmationToken,choices:[],setAsModpack:false},'no-ack')).rejects.toMatchObject({code:'invalid_input'});
});

import { installWarning } from '../src/features/servers/modpack-area-model.ts';
import { serverErrorDetails } from '../src/features/servers/errors.ts';
test('structured review warnings and hard refusals name the rule and item', () => {
 const message = installWarning({code:'unusual_content_directory',rule:'unusual_content_directory',item:'licenses/license.pdf',detail:'unusual_content_directory:licenses/license.pdf'}, id => id);
 expect(message).toContain('licenses/license.pdf');
 expect(message).toContain('Unusual content destination');
 expect(serverErrorDetails({code:'invalid_input',reason:'pack_path_invalid',issue:{code:'pack_path_invalid',rule:'safe_relative_path',item:'../escape.jar'}})).toContain('safe_relative_path: ../escape.jar');
});

import { reviewWarnings, reviewNeedsWarningConsent } from '../src/features/servers/pack-install-review.ts';
test('ordinary sizes and obsolete buffer thresholds do not require an override', () => {
 const plan={...seedPackInstallPlan('provider'),warnings:[
  {code:'archive_limit_warning',rule:'legacy_member_bytes',item:'mods/large.jar',detail:'138801550 > 16777216'},
  {code:'pack_size_warning',rule:'pack_size_warning',item:'590583000',detail:'pack_size_warning:590583000'},
 ]};
 expect(reviewWarnings(plan)).toHaveLength(1);
 expect(reviewNeedsWarningConsent(plan)).toBe(false);
 expect(reviewApplyRequest(plan,{},false)?.acknowledgeWarnings).toBe(true);
 const packaged={...plan,warnings:[...plan.warnings,'missing_required_dependency:mods/a.jar (curseforge/410295)']};
 expect(reviewWarnings(packaged)).toHaveLength(1);
 expect(reviewNeedsWarningConsent(packaged)).toBe(false);
 const risk={...plan,warnings:[...plan.warnings,'unknown_server_side:mods/a.jar']};
 expect(reviewNeedsWarningConsent(risk)).toBe(true);
 expect(reviewApplyRequest(risk,{},false)?.acknowledgeWarnings).toBe(false);
 expect(reviewApplyRequest(risk,{},false,true)?.acknowledgeWarnings).toBe(true);
 const checksum={...plan,warnings:['software_legacy_checksum_review']};
 expect(reviewNeedsWarningConsent(checksum)).toBe(true);
});
