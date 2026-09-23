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
function applyCashRegisterSyncIdentity(db:DatabaseSync){
  // SQLite has no portable ADD COLUMN IF NOT EXISTS. Checking the actual
  // schema also recovers safely from an interrupted historical upgrade where
  // a column was committed before user_version could advance.
  const columns=new Set((db.prepare("pragma table_info(cash_register_sessions)").all() as {name:string}[]).map(row=>row.name));
  if(!columns.has('client_id'))db.exec('ALTER TABLE cash_register_sessions ADD COLUMN client_id TEXT');
  if(!columns.has('server_id'))db.exec('ALTER TABLE cash_register_sessions ADD COLUMN server_id INTEGER');
  if(!columns.has('sync_status'))db.exec("ALTER TABLE cash_register_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local' CHECK(sync_status IN ('local','pending','synced','conflict'))");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS cash_register_client_id_unique ON cash_register_sessions(business_id,client_id) WHERE client_id IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS cash_register_server_id_unique ON cash_register_sessions(business_id,server_id) WHERE server_id IS NOT NULL; DROP INDEX IF EXISTS cash_register_one_open_idx; CREATE UNIQUE INDEX cash_register_one_open_idx ON cash_register_sessions(business_id,branch_id) WHERE status='open' AND sync_status!='conflict'; CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
}
function applyMasterDataSyncOutbox(db:DatabaseSync,migrationSql:string){
  db.exec(migrationSql.replace(/CREATE TABLE (units|master_sync_entities|master_sync_runtime)/g,'CREATE TABLE IF NOT EXISTS $1').replace('INSERT INTO master_sync_runtime','INSERT OR IGNORE INTO master_sync_runtime').replace(/CREATE TRIGGER /g,'CREATE TRIGGER IF NOT EXISTS '));
  const entities=[['settings','settings'],['categories','categories'],['units','units'],['products','products'],['product_variants','product_variants'],['product_modifiers','product_modifiers'],['customers','customers'],['suppliers','suppliers']] as const;
  const uuid="lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
  for(const [entity,table] of entities){
    const ensure=`INSERT OR IGNORE INTO master_sync_entities(entity_type,local_id,sync_id) VALUES('${entity}',NEW.id,${uuid});`;
    const queue=`INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) VALUES(coalesce(NEW.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1)),${uuid},'${entity}',NEW.id,'upsert',json_object('entity_type','${entity}','local_id',NEW.id,'sync_id',(SELECT sync_id FROM master_sync_entities WHERE entity_type='${entity}' AND local_id=NEW.id),'operation','upsert'),'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));`;
    const active=`(SELECT value FROM master_sync_runtime WHERE key='remote_apply')='0' AND coalesce(NEW.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1)) IS NOT NULL AND EXISTS(SELECT 1 FROM merchant_license_state l WHERE l.status='active' AND l.vendor_business_id=(SELECT vendor_business_id FROM businesses WHERE id=coalesce(NEW.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1))))`;
    const activeDelete=`(SELECT value FROM master_sync_runtime WHERE key='remote_apply')='0' AND coalesce(OLD.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1)) IS NOT NULL AND EXISTS(SELECT 1 FROM merchant_license_state l WHERE l.status='active' AND l.vendor_business_id=(SELECT vendor_business_id FROM businesses WHERE id=coalesce(OLD.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1))))`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS master_sync_${entity}_insert AFTER INSERT ON ${table} WHEN ${active} BEGIN ${ensure}${queue} END;
      CREATE TRIGGER IF NOT EXISTS master_sync_${entity}_update AFTER UPDATE ON ${table} WHEN ${active} BEGIN ${ensure}${queue} END;
      CREATE TRIGGER IF NOT EXISTS master_sync_${entity}_delete AFTER DELETE ON ${table} WHEN ${activeDelete} BEGIN
        UPDATE master_sync_entities SET tombstoned=1,sync_status='pending' WHERE entity_type='${entity}' AND local_id=OLD.id;
        INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) SELECT coalesce(OLD.business_id,(SELECT id FROM businesses ORDER BY id LIMIT 1)),${uuid},'${entity}',OLD.id,'delete',json_object('entity_type','${entity}','local_id',OLD.id,'sync_id',sync_id,'operation','delete'),'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM master_sync_entities WHERE entity_type='${entity}' AND local_id=OLD.id;
      END;`);
  }
}
function applyUserProfileSyncOutbox(db:DatabaseSync){
  const uuid="lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
  const active="(SELECT value FROM master_sync_runtime WHERE key='remote_apply')='0' AND NEW.business_id IS NOT NULL AND EXISTS(SELECT 1 FROM merchant_license_state l WHERE l.status='active' AND l.vendor_business_id=(SELECT vendor_business_id FROM businesses WHERE id=NEW.business_id))";
  const activeDelete="(SELECT value FROM master_sync_runtime WHERE key='remote_apply')='0' AND OLD.business_id IS NOT NULL AND EXISTS(SELECT 1 FROM merchant_license_state l WHERE l.status='active' AND l.vendor_business_id=(SELECT vendor_business_id FROM businesses WHERE id=OLD.business_id))";
  const ensure=`INSERT OR IGNORE INTO master_sync_entities(entity_type,local_id,sync_id) VALUES('users',NEW.id,${uuid});`;
  const queue=`INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) VALUES(NEW.business_id,${uuid},'users',NEW.id,'upsert',json_object('entity_type','users','local_id',NEW.id,'sync_id',(SELECT sync_id FROM master_sync_entities WHERE entity_type='users' AND local_id=NEW.id),'operation','upsert'),'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS master_sync_users_insert AFTER INSERT ON users WHEN ${active} BEGIN ${ensure}${queue} END;
    CREATE TRIGGER IF NOT EXISTS master_sync_users_update AFTER UPDATE ON users WHEN ${active} BEGIN ${ensure}${queue} END;
    CREATE TRIGGER IF NOT EXISTS master_sync_users_delete AFTER DELETE ON users WHEN ${activeDelete} BEGIN
      UPDATE master_sync_entities SET tombstoned=1,sync_status='pending' WHERE entity_type='users' AND local_id=OLD.id;
      INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) SELECT OLD.business_id,${uuid},'users',OLD.id,'delete',json_object('entity_type','users','local_id',OLD.id,'sync_id',sync_id,'operation','delete'),'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM master_sync_entities WHERE entity_type='users' AND local_id=OLD.id;
    END;`);
}
function applyPurchaseSyncIdentity(db:DatabaseSync){
  const purchaseColumns=new Set((db.prepare("pragma table_info(purchases)").all() as {name:string}[]).map(row=>row.name));
  if(!purchaseColumns.has('sync_id'))db.exec('ALTER TABLE purchases ADD COLUMN sync_id TEXT');
  if(!purchaseColumns.has('server_id'))db.exec('ALTER TABLE purchases ADD COLUMN server_id INTEGER');
  if(!purchaseColumns.has('server_updated_at'))db.exec('ALTER TABLE purchases ADD COLUMN server_updated_at TEXT');
  const itemColumns=new Set((db.prepare("pragma table_info(purchase_items)").all() as {name:string}[]).map(row=>row.name));
  if(!itemColumns.has('stock_client_id'))db.exec('ALTER TABLE purchase_items ADD COLUMN stock_client_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS purchases_business_sync_id_unique ON purchases(business_id,sync_id) WHERE sync_id IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS purchases_business_server_id_unique ON purchases(business_id,server_id) WHERE server_id IS NOT NULL;');
}
function applyIdempotentAdditiveMigration(db:DatabaseSync,migrationSql:string){
  const addColumn=/^\s*ALTER TABLE (\w+) ADD COLUMN (\w+) ([^;]+);\s*$/gm;
  for(const match of migrationSql.matchAll(addColumn)){
    const [,table,column,definition]=match;
    const columns=new Set((db.prepare(`pragma table_info(${table})`).all() as {name:string}[]).map(row=>row.name));
    if(!columns.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
  const remainder=migrationSql.replace(addColumn,'')
    .replace(/CREATE UNIQUE INDEX /g,'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/CREATE TRIGGER /g,'CREATE TRIGGER IF NOT EXISTS ');
  if(remainder.trim())db.exec(remainder);
}
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
          if(migration.name==='cash_register_sync_identity')applyCashRegisterSyncIdentity(db);
          else if(migration.name==='master_data_sync_outbox')applyMasterDataSyncOutbox(db,migration.sql);
          else if(migration.name==='user_profile_sync')applyUserProfileSyncOutbox(db);
          else if(migration.name==='purchase_sync_outbox')applyPurchaseSyncIdentity(db);
          else if(migration.name==='sales_return_sync_outbox'||migration.name==='order_restaurant_sync_outbox')applyIdempotentAdditiveMigration(db,migration.sql);
          else db.exec(migration.sql);
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
