import assert from 'node:assert/strict'
import test from 'node:test'
import {universalV1Diagnostic} from './desktopUniversalV1Diagnostics.ts'

test('Universal V1 diagnostics expose metadata without error messages or request secrets',()=>{
  const error={name:'AxiosError',code:'ERR_BAD_RESPONSE',message:'customer@example.test',config:{data:{device_proof:'secret-proof',phone:'+212600000000'}},response:{status:422,data:{certificate:'secret'}}}
  const diagnostic=universalV1Diagnostic(error,{stage:'local_apply',change_count:3,local_apply_failed:true})
  assert.deepEqual(diagnostic,{universal_sync_stage:'local_apply',http_status:422,change_count:3,error_code:'ERR_BAD_RESPONSE',error_name:'AxiosError',local_apply_failed:true})
  const serialized=JSON.stringify(diagnostic)
  for(const secret of ['customer@example.test','secret-proof','+212600000000','certificate'])assert.equal(serialized.includes(secret),false)
})
