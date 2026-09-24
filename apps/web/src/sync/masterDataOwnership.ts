export const universalV1PilotEntity=(entity:string)=>entity==='categories'||entity==='units'||entity==='customers'

export function legacyMasterOutbox<T extends {payload:{entity_type:string}}>(mutations:T[]){
  return mutations.filter(mutation=>!universalV1PilotEntity(mutation.payload.entity_type))
}

export function legacyMasterChanges<T extends {entity_type:string}>(changes:T[]){
  return changes.filter(change=>!universalV1PilotEntity(change.entity_type))
}
