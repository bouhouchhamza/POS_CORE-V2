import assert from 'node:assert/strict'
import test from 'node:test'
import {legacyMasterChanges,legacyMasterOutbox,universalV1PilotEntity} from './masterDataOwnership.ts'

test('Universal V1 owns only categories, units, and customers on a V1-capable Desktop',()=>{
  for(const entity of ['categories','units','customers'])assert.equal(universalV1PilotEntity(entity),true)
  for(const entity of ['branches','settings','products','product_variants','product_modifiers','suppliers','users'])assert.equal(universalV1PilotEntity(entity),false)
})

test('legacy master push and pull exclude pilot entities while preserving old-client entities',()=>{
  const outbound=legacyMasterOutbox([
    {payload:{entity_type:'categories'}},{payload:{entity_type:'units'}},{payload:{entity_type:'customers'}},{payload:{entity_type:'products'}},{payload:{entity_type:'suppliers'}},
  ])
  assert.deepEqual(outbound.map(mutation=>mutation.payload.entity_type),['products','suppliers'])
  const inbound=legacyMasterChanges([{entity_type:'categories'},{entity_type:'units'},{entity_type:'customers'},{entity_type:'branches'},{entity_type:'products'}])
  assert.deepEqual(inbound.map(change=>change.entity_type),['branches','products'])
})
