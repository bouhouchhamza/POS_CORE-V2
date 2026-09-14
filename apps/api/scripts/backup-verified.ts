import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
function run(command:string,args:string[],env?:NodeJS.ProcessEnv){return new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} a échoué (${code}).`)))})}
function dockerDump(database:string,dump:string){return new Promise<void>((resolve,reject)=>{const output=createWriteStream(dump,{flags:'wx'}),child=spawn('docker',['compose','-f','deploy/docker-compose.dev.yml','exec','-T','postgres','pg_dump','--format=custom','--compress=9','--no-owner','--no-acl','--username','bimik','--dbname',database],{cwd:root,stdio:['ignore','pipe','inherit']});child.stdout.pipe(output);child.on('error',reject);child.on('exit',code=>{output.end();code===0?resolve():reject(new Error(`pg_dump Docker a échoué (${code}).`))})})}
async function validateDump(dump:string){try{await run('pg_restore',['--list',dump])}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await run('docker',['run','--rm','--mount',`type=bind,source=${path.dirname(dump)},target=/backups`,'postgres:18-alpine','pg_restore','--list',`/backups/${path.basename(dump)}`])}}
async function sha256(file:string){return createHash('sha256').update(await readFile(file)).digest('hex')}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const url=new URL(config.DATABASE_URL), database=decodeURIComponent(url.pathname.slice(1));
if(!database||['postgres','template0','template1'].includes(database))throw new Error('Base cible absente ou base système refusée.');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),directory=path.join(root,'backups');await mkdir(directory,{recursive:true});
const dump=path.join(directory,`${database}-${stamp}.dump`),sqliteSource=path.join(root,'backend/database/database.sqlite'),sqliteCopy=path.join(directory,`legacy-database-${stamp}.sqlite`);
const pgEnv={...process.env,PGPASSWORD:decodeURIComponent(url.password)};
try{await run('pg_dump',['--format=custom','--compress=9','--no-owner','--no-acl','--host',url.hostname,'--port',url.port||'5432','--username',decodeURIComponent(url.username),'--dbname',database,'--file',dump],pgEnv)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await rm(dump,{force:true});await dockerDump(database,dump)}
await validateDump(dump);await copyFile(sqliteSource,sqliteCopy);
const manifest={version:1,created_at:new Date().toISOString(),host:url.hostname,port:url.port||'5432',database,dump_path:dump,dump_sha256:await sha256(dump),pg_restore_list_valid:true,sqlite_source:sqliteSource,sqlite_copy_path:sqliteCopy,sqlite_sha256:await sha256(sqliteCopy)};
const manifestPath=`${dump}.verified.json`;await writeFile(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});await writeFile(`${dump}.sha256`,`${manifest.dump_sha256}  ${path.basename(dump)}\n`,{flag:'wx'});console.log(JSON.stringify({...manifest,manifest_path:manifestPath},null,2));
