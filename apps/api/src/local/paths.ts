import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LocalPaths={root:string;database:string;uploads:string;logs:string;backups:string;config:string};
export function resolveLocalPaths(env=process.env):LocalPaths {
  // These environment variables and paths are persistent compatibility
  // identifiers. Renaming them would split existing local installations.
  const explicitDatabase=env.BIMIK_DATABASE_PATH?.trim();
  if(explicitDatabase&&!path.isAbsolute(explicitDatabase))throw new Error("Le chemin de base de données local doit être absolu.");
  const database=explicitDatabase?path.normalize(explicitDatabase):undefined;
  const explicitRoot=env.BIMIK_APP_DATA_DIR?.trim()||env.BIMIK_DATA_DIR?.trim();
  const root=path.resolve(explicitRoot||(database?path.dirname(path.dirname(database)):path.join(env.LOCALAPPDATA||env.APPDATA||process.cwd(),"Bimik Cafe")));
  const intendedDatabase=path.join(root,"data","bimik-cafe.sqlite");
  if(database&&path.resolve(database)!==path.resolve(intendedDatabase))throw new Error("Le chemin de base de données ne correspond pas au dossier de données local transmis.");
  return {root,database:database??intendedDatabase,uploads:path.join(root,"uploads"),
    logs:path.join(root,"logs"),backups:path.join(root,"backups"),config:path.join(root,"config","local.json")};
}
export function ensureLocalPaths(paths:LocalPaths){
  for(const directory of [paths.root,path.dirname(paths.database),paths.uploads,paths.logs,paths.backups,path.dirname(paths.config)])
    fs.mkdirSync(directory,{recursive:true});
  return paths;
}
export function localSecret(paths:LocalPaths){
  ensureLocalPaths(paths);
  if(fs.existsSync(paths.config)){
    const parsed=JSON.parse(fs.readFileSync(paths.config,"utf8")) as {jwt_secret?:string};
    if(typeof parsed.jwt_secret==="string"&&parsed.jwt_secret.length>=32)return parsed.jwt_secret;
    throw new Error("La configuration locale existe mais ne contient pas de secret valide.");
  }
  const value={version:1,jwt_secret:crypto.randomBytes(48).toString("base64url"),created_at:new Date().toISOString()};
  fs.writeFileSync(paths.config,JSON.stringify(value,null,2),{flag:"wx",mode:0o600});
  return value.jwt_secret;
}
