export type UniversalV1Stage='preflight'|'device_proof'|'hosted_push'|'hosted_pull'|'local_apply'
export type UniversalV1DiagnosticContext={
  stage:UniversalV1Stage
  http_status?:number
  entity_type?:string
  change_count?:number
  local_apply_failed?:boolean
}

function safeCode(value:unknown){
  return typeof value==='string'&&/^[A-Z0-9_.-]{1,80}$/i.test(value)?value:undefined
}

export function universalV1Diagnostic(error:unknown,context:UniversalV1DiagnosticContext){
  const candidate=error&&typeof error==='object'?error as {name?:unknown;code?:unknown;response?:{status?:unknown}}:{}
  const responseStatus=Number(candidate.response?.status)
  return{
    universal_sync_stage:context.stage,
    ...(Number.isInteger(context.http_status)?{http_status:context.http_status}:Number.isInteger(responseStatus)?{http_status:responseStatus}:{}),
    ...(context.entity_type?{entity_type:context.entity_type}:{}),
    ...(Number.isInteger(context.change_count)?{change_count:context.change_count}:{}),
    ...(safeCode(candidate.code)?{error_code:safeCode(candidate.code)}:{}),
    ...(safeCode(candidate.name)?{error_name:safeCode(candidate.name)}:{}),
    local_apply_failed:Boolean(context.local_apply_failed),
  }
}

export function logUniversalV1Failure(error:unknown,context:UniversalV1DiagnosticContext){
  // Never log the error itself: request errors can retain proofs, credentials,
  // certificates, or sensitive customer payloads.
  console.error('Universal V1 reconciliation failed',universalV1Diagnostic(error,context))
}
