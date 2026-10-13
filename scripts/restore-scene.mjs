// Restore baked terrain and structures while retaining the checkout's components.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const archive=process.argv[2];
if(!archive){console.error('Usage: node scripts/restore-scene.mjs /path/to/scene.tar.zst');process.exit(1);}
const run=args=>{const r=spawnSync('tar',args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw Error(r.stderr||'Archive operation failed');return r.stdout;};
const paths=run(['--zstd','-tf',resolve(archive)]).split('\n').filter(p=>/^trips\/honeymoon\/(?:world|(?:parks|detours)\/[^/]+\/world)\//.test(p));
if(!paths.length||paths.some(p=>p.split('/').includes('..')))throw Error('No valid world assets in scene archive');
const temporary=mkdtempSync(join(tmpdir(),'roadtrip-restore-'));
try{const list=join(temporary,'files');writeFileSync(list,paths.join('\0')+'\0');run(['--zstd','-xf',resolve(archive),'--null','--no-recursion','-T',list]);console.log(`Restored ${paths.length} world entries`);}
finally{rmSync(temporary,{recursive:true,force:true});}
