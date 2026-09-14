import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LOCAL_SCHEMA_VERSION,localMigrations } from "./migrations.js";
import { ensureLocalPaths,type LocalPaths } from "./paths.js";

const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
export function sha256File(file:string){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
function copyMigrationUploads(source:string,destination:string):string[]{
  if(!fs.existsSync(source))return [];
  const copied:string[]=[];
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(destination,entry.name);
    if(entry.isDirectory()){fs.mkdirSync(to,{recursive:true});copied.push(...copyMigrationUploads(from,to));}
    else if(entry.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);copied.push(to);}
  }
  return copied;
}
export function verifiedDatabaseSnapshot(db:DatabaseSync,paths:LocalPaths,label="pre-migration"){
  const stamp=new Date().toISOString().replace(/[-:.]/g,"").replace("Z","Z");
  const directory=path.join(paths.backups,`${stamp}-${label}`);fs.mkdirSync(directory,{recursive:false});
  const target=path.join(directory,"bimik-cafe.sqlite");
  db.exec(`VACUUM INTO ${quote(target)}`);
  const validation=new DatabaseSync(target,{readOnly:true});
  const integrity=String(validation.prepare("PRAGMA integrity_check").get()?.integrity_check??"");validation.close();
  if(integrity!=="ok"){fs.rmSync(directory,{recursive:true,force:true});throw new Error("La sauvegarde SQLite avant migration est invalide.");}
  const sha256=sha256File(target);
  const uploadsDirectory=path.join(directory,"uploads");fs.mkdirSync(uploadsDirectory,{recursive:true});
  const uploadFiles=copyMigrationUploads(paths.uploads,uploadsDirectory).map(file=>({
    file:path.relative(directory,file).split(path.sep).join("/"),bytes:fs.statSync(file).size,sha256:sha256File(file),
  }));
  fs.writeFileSync(path.join(directory,"manifest.json"),JSON.stringify({version:1,kind:label,created_at:new Date().toISOString(),
    schema_version:Number(db.prepare("PRAGMA user_version").get()?.user_version??0),database:{file:"bimik-cafe.sqlite",bytes:fs.statSync(target).size,sha256},uploads:uploadFiles,integrity_check:"ok"},null,2),{flag:"wx"});
  return directory;
}
function existingUserTables(db:DatabaseSync){return Number(db.prepare("select count(*) count from sqlite_master where type='table' and name not like 'sqlite_%'").get()?.count??0)}
export function openLocalDatabase(paths:LocalPaths){
  ensureLocalPaths(paths);const existed=fs.existsSync(paths.database);const db=new DatabaseSync(paths.database);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  const version=Number(db.prepare("PRAGMA user_version").get()?.user_version??0);
  if(version>LOCAL_SCHEMA_VERSION){db.close();throw new Error(`Base locale version ${version} plus récente que l’application (${LOCAL_SCHEMA_VERSION}). Downgrade refusé.`);}
  if(existed&&version===0&&existingUserTables(db)>0){db.close();throw new Error("Base SQLite existante non reconnue. Utilisez l’outil d’import contrôlé; aucun écrasement n’a été effectué.");}
  if(version<LOCAL_SCHEMA_VERSION){
    if(existed&&fs.statSync(paths.database).size>0)verifiedDatabaseSnapshot(db,paths);
    for(const migration of localMigrations.filter(item=>item.version>version)){
      const requiresForeignKeysOff=migration.name==="expand_user_roles";
      if(requiresForeignKeysOff)db.exec("PRAGMA foreign_keys=OFF");
      try{
        db.exec("BEGIN IMMEDIATE");
        try{
          db.exec(migration.sql);
          if(requiresForeignKeysOff){
            const violations=db.prepare("PRAGMA foreign_key_check").all();
            if(violations.length)throw new Error("La migration des r?les utilisateurs a cr?? des r?f?rences SQLite invalides.");
          }
          db.exec(`PRAGMA user_version=${migration.version}`);
          db.exec("COMMIT");
        }catch(error){
          db.exec("ROLLBACK");
          throw error;
        }
      }catch(error){
        if(requiresForeignKeysOff)db.exec("PRAGMA foreign_keys=ON");
        db.close();
        throw error;
      }
      if(requiresForeignKeysOff)db.exec("PRAGMA foreign_keys=ON");
    }
  }
  return db;
}
export function immediate<T>(db:DatabaseSync,operation:()=>T){
  db.exec("BEGIN IMMEDIATE");try{const result=operation();db.exec("COMMIT");return result}catch(error){db.exec("ROLLBACK");throw error}
}
