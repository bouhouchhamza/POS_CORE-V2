import assert from 'node:assert/strict'
import test from 'node:test'
import {reconcileDesktopCycle} from './desktopSyncCore.ts'

test('scheduled Desktop reconciliation runs Universal V1 even when realtime is unavailable or missed',async()=>{
  const calls:string[]=[]
  await reconcileDesktopCycle({
    cash:async()=>{calls.push('cash');return true},
    universalMaster:async()=>{calls.push('universal');return true},
    legacyMaster:async()=>{calls.push('legacy');return true},
    transactional:async()=>{calls.push('transactional');return true},
  })
  assert.deepEqual(calls,['cash','universal','legacy','transactional'])
})
