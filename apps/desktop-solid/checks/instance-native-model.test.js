import { byRecency } from '../src/features/installation/launchers';
import { describe, expect, test } from 'bun:test';
import { instanceSlug, instanceState, newNativeInstance, preferencesFromNative, preferencesPatch } from '../src/features/instances/native-model';

describe('native instance contracts', () => {
  test('numeric database identity stays independent of the launcher process slug', () => {
    expect(instanceSlug('  Hello__World!! ')).toBe('hello__world');
    expect(instanceSlug('../weird/name\\')).toBe('weird-name');
    expect(instanceSlug('世界')).toBe('instance');
    expect(instanceSlug('a'.repeat(80))).toHaveLength(64);
    const instance = newNativeInstance('First name','1.21.4');
    instance.id = 42;
    const renamed = { ...instance, name: 'Second name' };
    expect(renamed.id).toBe(instance.id);
    expect(instanceSlug(renamed.name)).not.toBe(instanceSlug(instance.name));
  });

  test('native lifecycle states override stored crash flags and preserve install reasons', () => {
    const instance = {...newNativeInstance('Test','1.21.4'), crashed:true, installationStatus:'installed', crashDetails:JSON.stringify({message:'Out of memory'})};
    expect(instanceState(instance,'running')).toEqual({kind:'running'});
    expect(instanceState(instance,'warming')).toEqual({kind:'warming'});
    expect(instanceState(instance)).toEqual({kind:'crashed',summary:'Out of memory'});
    expect(instanceState({...instance,installationStatus:'failed:Connection reset'})).toEqual({kind:'failed',reason:'Connection reset'});
    expect(instanceState({...instance,installationStatus:'interrupted',lastOperation:'update'})).toMatchObject({kind:'interrupted',recovery:true});
    expect(instanceState(newNativeInstance('New','1.21.4')).kind).toBe('interrupted');
  });

  test('settings round trip uses native values and preserves fields outside the form', () => {
    const instance = {...newNativeInstance('Test','1.21.4'),id:9,minMemory:3072,maxMemory:8192,
      useGlobalJavaPath:false,javaPath:'/custom/java',useGlobalSandbox:false,sandboxPreset:'paranoid',
      sandboxWrapperNesting:'wrapper-outside',sandboxExtraPaths:'["/allowed"]',
      modpackId:'linked-pack',modpackVersionId:'release',importSourceGameDirectory:'/import/source',
      launcherActionOnLaunch:'hide-to-tray',useGlobalLauncherAction:false};
    const values = preferencesFromNative(instance);
    expect(values).toMatchObject({java:'custom',javaPath:'/custom/java',inheritMemory:false,maxMemory:8192,sandboxPreset:'paranoid',sandboxWrapper:false,launcherAction:'hide'});
    const updated = preferencesPatch(instance,{...values,maxMemory:10240});
    expect(updated.maxMemory).toBe(10240);
    expect(updated).toMatchObject({id:9,modpackId:'linked-pack',modpackVersionId:'release',sandboxExtraPaths:'["/allowed"]',importSourceGameDirectory:'/import/source',launcherActionOnLaunch:'hide-to-tray'});
    expect(updated.javaPath).toBe('/custom/java');
    expect(updated.sandboxWrapperNesting).toBe('wrapper-outside');
    expect(preferencesPatch(instance,{...values,sandboxWrapper:true}).sandboxWrapperNesting).toBe('sandbox-outside');
  });

  test('new records inherit launcher settings, validate a loader and use backend defaults', () => {
    const instance = newNativeInstance('  Vanilla  ','1.21.4');
    expect(instance).toMatchObject({name:'Vanilla',modloader:null,modloaderVersion:null,gameDirectory:null,useGlobalJavaPath:true,useGlobalSandbox:true,installationStatus:null});
    expect(newNativeInstance('Modded','1.21.4','fabric','0.16.10')).toMatchObject({modloader:'fabric',modloaderVersion:'0.16.10'});
    expect(()=>newNativeInstance('','1.21.4')).toThrow();
    expect(()=>newNativeInstance('Bad','1.21.4','forge','')).toThrow();
    expect(()=>preferencesPatch(instance,{...preferencesFromNative(instance),minMemory:8192,maxMemory:1024})).toThrow('memory');
    expect(()=>preferencesPatch(instance,{...preferencesFromNative(instance),inheritSandbox:false,sandboxPreset:'off'})).toThrow('sandbox');
  });
});


test('launcher imports sort recent sessions first without mutating native results', () => {
  const candidates = [
    {name:'Unknown',lastPlayedAtUnixMs:null},
    {name:'Older',lastPlayedAtUnixMs:100},
    {name:'Beta',lastPlayedAtUnixMs:200},
    {name:'Alpha',lastPlayedAtUnixMs:200},
    {name:'Invalid',lastPlayedAtUnixMs:NaN},
  ];
  expect(byRecency(candidates).map(item=>item.name)).toEqual(['Alpha','Beta','Older','Invalid','Unknown']);
  expect(candidates[0].name).toBe('Unknown');
});
