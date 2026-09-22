import crypto from'node:crypto'
import type{FastifyInstance,FastifyReply,FastifyRequest}from'fastify'
import type pg from'pg'
import argon2 from'argon2'
import bcrypt from'bcryptjs'
import{z}from'zod'
import{offlineRequestSchema,businessSetupSchema}from'@corepos/validation'
import{offlineProofPayload,businessTypes,featureKeys}from'@corepos/shared-types'
import{fingerprint,licenseKeyHash,signCertificate,type LicenseCertificate}from'./crypto.js'
import{activationRequestIsFresh}from'./policy.js'
import{config}from'../config.js'
import{provisionTenantDatabase,tenantIdentifiers}from'../saas/tenant-provisioning.js'
import{provisionVendorBusiness,readVendorBusinessLifecycle}from'../saas/vendor-business-provisioning.js'
import{commercialLifecycle}from'./lifecycle.js'
import{currentTenant}from'../saas/tenant-context.js'
import{assertDeviceSlotAvailable}from'./device-quota.js'
import{clearSessionDeviceCookie,sessionChannelForRequest,setSessionDeviceCookie,touchSessionDevice}from'./session-devices.js'
import{effectiveLicenseStatus,readCommercialLicenseState,resolveRuntimeBusinessIdentity}from'./control-plane.js'
import{issueActivationCode,lockActivationCode,validateActivationCode}from'./activation-codes.js'
import{setActivatedDeviceCookie}from'./device-tenant-context.js'
import{
 clearProvisioningActivationGrantCookie,
 issueProvisioningActivationGrant,
 lockProvisioningActivationGrant,
 readProvisioningActivationGrantCookie,
 setProvisioningActivationGrantCookie,
 validateProvisioningActivationGrant
}from'./provisioning-activation-grants.js'

type User={
 id:number
 businessId:number
 branchId:number|null
 role:string
}

type Deps={
 pool:pg.Pool
 operationalPool:pg.Pool
 authenticate:(
  request:FastifyRequest,
  reply:FastifyReply
 )=>Promise<unknown>
 resolveUser:(request:FastifyRequest)=>Promise<User|null>
}
const features = z.array(z.enum(featureKeys)).max(featureKeys.length);
const businessType = z.enum(businessTypes);
const activationWindowMs = () => {
    const configured = Number(process.env.LICENSE_ACTIVATION_WINDOW_SECONDS ?? 600);
    return Number.isFinite(configured) && configured >= 60 ? configured * 1000 : 600_000;
};
const offlineActivationWindowMs = () => {
    const configured = Number(process.env.LICENSE_OFFLINE_ACTIVATION_WINDOW_SECONDS ?? 86400);
    return Number.isFinite(configured) && configured >= 600 ? configured * 1000 : 86_400_000;
};
const replayError=(error:any)=>{
    const value = error;
    return value?.code === '23505' && value.constraint === 'license_activations_license_nonce_unique';
};
const publicLicense=(row:any)=>{
    if(!row)return row;
    const {key_hash:_keyHash,...safe}=row;
    return safe;
};
const verifyOfflineDeviceProof=(publicKey:string,payload:string,signature:string)=>{
    try {
        const key = crypto.createPublicKey({ key: JSON.parse(publicKey), format: 'jwk' });
        return crypto.verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64url'));
    }
    catch {
        return false;
    }
};
const onlineDeviceProofPayload=(input:any)=>[
    'device-activate-v1',
    input.license_key.trim(),
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.nonce,
    input.requested_at
].join('\n');
const deviceValidationProofPayload=(input:any)=>[
    'device-validate-v1',
    input.license_id,
    input.certificate_id,
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.nonce,
    input.requested_at
].join('\n');
export async function registerLicenseRoutes(app:FastifyInstance,{pool,operationalPool,authenticate,resolveUser}:Deps){
    const merchant=async(request:FastifyRequest,reply:FastifyReply)=> { await authenticate(request, reply); if (reply.sent)
        return; const user = await resolveUser(request); if (!user)
        return reply.code(401).send({ message: 'Unauthenticated.' }); (request as any).merchant=user; };
    // COREPOS_VENDOR_PASSWORD_AUTH_V1
    const vendorSessionCookie='bimik_vendor_session';
    const vendorSessionTtlSeconds=()=>{
        const hours=Number(process.env.VENDOR_SESSION_TTL_HOURS??12);
        return Number.isFinite(hours)&&hours>=1&&hours<=168?Math.floor(hours*3600):12*3600;
    };
    const vendorSessionSecret=()=>String(process.env.VENDOR_SESSION_SECRET??process.env.JWT_SECRET??'');
    const vendorSessionSignature=(username:string,expiresAt:number)=>crypto.createHmac('sha256',vendorSessionSecret()).update(`${username}\n${expiresAt}`).digest('base64url');
    
    const getVendorPasswordTarget=()=>{
        const hash=String(process.env.VENDOR_ADMIN_PASSWORD_HASH??'').trim();
        // Vendor authentication is a production control-plane boundary. A
        // reversible password in environment configuration is never an
        // acceptable fallback; provision an Argon2id or bcrypt hash instead.
        return hash;
    };

    const verifyVendorPassword=async(target:string,inputPassword:string):Promise<boolean>=>{
        if(!target||!inputPassword)return false;
        try{
            if(target.startsWith('$argon2')){
                return await argon2.verify(target,inputPassword);
            }
            if(target.startsWith('$2a$')||target.startsWith('$2b$')||target.startsWith('$2y$')){
                return await bcrypt.compare(inputPassword,target);
            }
            return false;
        }catch{
            return false;
        }
    };

    const readVendorSession=(request:FastifyRequest)=>{
        const raw=request.cookies?.[vendorSessionCookie];
        if(!raw)return null;
        try{
            const parsed=JSON.parse(Buffer.from(raw,'base64url').toString('utf8')) as {u?:unknown;e?:unknown;s?:unknown};
            const username=typeof parsed.u==='string'?parsed.u:'';
            const expiresAt=typeof parsed.e==='number'?parsed.e:0;
            const supplied=typeof parsed.s==='string'?parsed.s:'';
            if(!username||!Number.isFinite(expiresAt)||expiresAt<=Date.now()||!supplied)return null;
            const expected=vendorSessionSignature(username,expiresAt);
            if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return null;
            return{username,expiresAt};
        }catch{return null;}
    };
    const vendorTokenMatches=(request:FastifyRequest)=>{
        const configured=process.env.VENDOR_ADMIN_TOKEN;
        if(!configured||process.env.NODE_ENV==='production'&&configured.length<32)return false;
        const supplied=String(request.headers.authorization??'').replace(/^Bearer\s+/i,'');
        return supplied.length===configured.length&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(configured));
    };
    const vendor=async(request:FastifyRequest,reply:FastifyReply)=>{
        const session=readVendorSession(request);
        if(session){(request as any).vendorAdmin={username:session.username,auth:'password'};return;}
        if(vendorTokenMatches(request)){(request as any).vendorAdmin={username:'bootstrap-token',auth:'token'};return;}
        const passwordConfigured=Boolean(getVendorPasswordTarget()&&vendorSessionSecret());
        const tokenConfigured=Boolean(process.env.VENDOR_ADMIN_TOKEN&&!(process.env.NODE_ENV==='production'&&String(process.env.VENDOR_ADMIN_TOKEN).length<32));
        if(!passwordConfigured&&!tokenConfigured)return reply.code(503).send({message:'Vendor administration is not configured.',code:'VENDOR_AUTH_NOT_CONFIGURED'});
        return reply.code(401).send({message:'Vendor authentication required.'});
    };
    // Provisioning credentials are an operator-only compatibility tool. A
    // normal Vendor Console session can manage businesses and activation
    // codes, but cannot expose or mint a customer bootstrap credential.
    const vendorInternalRecovery=async(request:FastifyRequest,reply:FastifyReply)=>{
        await vendor(request,reply);
        if(reply.sent)return;
        const admin=(request as FastifyRequest & {vendorAdmin?:{auth?:unknown}}).vendorAdmin;
        if(admin?.auth!=='token'){
            return reply.code(403).send({
                message:'This recovery operation requires an internal operator credential.',
                code:'INTERNAL_RECOVERY_REQUIRED'
            });
        }
    };
    app.post('/api/vendor/auth/login',{config:{rateLimit:{max:process.env.NODE_ENV==='test'?1000:5,timeWindow:'1 minute'}}},async(request,reply)=>{
        const input=z.object({username:z.string().trim().min(1).max(120),password:z.string().min(1).max(512)}).parse(request.body);
        const configuredUsernames=[
            String(process.env.VENDOR_ADMIN_USERNAME??'admin').trim().toLowerCase(),
            String(process.env.VENDOR_ADMIN_EMAIL??'').trim().toLowerCase()
        ].filter(Boolean);
        const passwordTarget=getVendorPasswordTarget();
        const secret=vendorSessionSecret();
        if(!passwordTarget||!secret)return reply.code(503).send({message:'Vendor password login is not configured.',code:'VENDOR_PASSWORD_AUTH_NOT_CONFIGURED'});
        const usernameMatches=configuredUsernames.includes(input.username.toLowerCase());
        const passwordMatches=usernameMatches?await verifyVendorPassword(passwordTarget,input.password):false;
        if(!passwordMatches)return reply.code(401).send({message:'Identifiant ou mot de passe incorrect.',code:'VENDOR_CREDENTIALS_INVALID'});
        const activeUsername=String(process.env.VENDOR_ADMIN_USERNAME??input.username).trim();
        const expiresAt=Date.now()+vendorSessionTtlSeconds()*1000;
        const signature=vendorSessionSignature(activeUsername,expiresAt);
        const cookieValue=Buffer.from(JSON.stringify({u:activeUsername,e:expiresAt,s:signature}),'utf8').toString('base64url');
        reply.setCookie(vendorSessionCookie,cookieValue,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:vendorSessionTtlSeconds()});
        return{data:{authenticated:true,username:activeUsername,expires_at:new Date(expiresAt).toISOString()}};
    });
    app.get('/api/vendor/auth/session',{preHandler:vendor},async(request)=>({data:{authenticated:true,username:(request as any).vendorAdmin?.username??'vendor'}}));
    app.post('/api/vendor/auth/logout',async(_request,reply)=>{
        reply.clearCookie(vendorSessionCookie,{path:'/'});
        return{data:{authenticated:false}};
    });
    const issue=async(
     license:any,
     device:any,
     businessId:number|null
    ):Promise<{
     certificate:LicenseCertificate
     signature:string
    }>=>{
     const privateKey=
      process.env.LICENSE_SIGNING_PRIVATE_KEY
       ?.replaceAll('\\n','\n')

     if(!privateKey)
      throw Object.assign(
       new Error('Vendor signing key is not configured.'),
       {statusCode:503}
      )

     if(
      !license.vendor_business_id ||
      !license.customer_id ||
      !license.business_type
     )
      throw Object.assign(
       new Error('License commercial identity is incomplete.'),
       {
        statusCode:500,
        code:'LICENSE_VENDOR_IDENTITY_MISSING'
       }
      )

     if(license.vendor_business_status!=='active')
      throw Object.assign(
       new Error('Vendor Business is not active.'),
       {
        statusCode:403,
        code:'VENDOR_BUSINESS_INACTIVE'
       }
      )

     const certificate:LicenseCertificate={
      version:2,
      certificate_id:crypto.randomUUID(),
      license_id:license.id,
      customer_id:license.customer_id,
      vendor_business_id:license.vendor_business_id,
      business_id:businessId,
      business_type:license.business_type,
      plan:license.plan_code,
      features:license.allowed_features,
      installation_id:device.installation_id,
      device_fingerprint:fingerprint(
       device.device_public_key
      ),
      issued_at:new Date().toISOString(),
      expires_at:license.expires_at
       ?new Date(license.expires_at).toISOString()
       :null,
      offline_validity_days:
       license.offline_validity_days
     }

     return{
      certificate,
      signature:signCertificate(
       certificate,
       privateKey
      )
     }
    }

    /**
     * Read the complete commercial state from the control plane while the
     * caller holds its licence/business lock.  Activation eligibility must
     * never be reconstructed from just a licence row: legacy businesses may
     * have no provisioning recipe, while newly-created businesses need a
     * usable runtime/tenant as well as an active licence.
     */
    const lifecycleForLicense=async(client:pg.PoolClient,licenseId:string)=>{
      const row=(await client.query(`
        select vb.id vendor_business_id,vb.status vendor_business_status,
          l.id license_id,l.status license_status,l.expires_at license_expires_at,
          l.max_devices,l.max_desktop_devices,l.max_web_devices,l.max_mobile_devices,
          t.status tenant_status,recipe.last_error_code provisioning_error_code,
          (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id
        from licenses l
        join vendor_businesses vb on vb.id=l.vendor_business_id
        left join saas_tenants t on t.vendor_business_id=vb.id
        left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id
        where l.id=$1
        for share of l,vb
      `,[licenseId])).rows[0]
      return commercialLifecycle(row,config.SAAS_TENANCY_MODE)
    }
    const requireActivationReady=async(client:pg.PoolClient,licenseId:string)=>{
      const lifecycle=await lifecycleForLicense(client,licenseId)
      if(lifecycle.state==='READY_FOR_ACTIVATION')return lifecycle
      const isCommercialBlock=lifecycle.state==='BLOCKED'
      throw Object.assign(new Error('This business is not available for device activation.'),{
        statusCode:isCommercialBlock?403:409,
        code:lifecycle.reason??'BUSINESS_NOT_READY_FOR_ACTIVATION'
      })
    }
    app.get(
     '/api/license/status',
     {preHandler:merchant},
     async request=>{
      const user=(request as any).merchant as User

      if(
       process.env.LICENSE_MODE==='development' &&
       process.env.NODE_ENV!=='production'
      )
       return{
        data:{
         status:'development',
         features:'all',
         development:true
        }
       }

      const identity=await resolveRuntimeBusinessIdentity(
       operationalPool,
       user.businessId
      )
      const state=identity
       ?await readCommercialLicenseState(pool,identity.vendorBusinessId)
       :null

      return{
       data:state
        ?{
          status:effectiveLicenseStatus(state),
          expires_at:state.expires_at,
          features:state.allowed_features??[],
          plan:state.plan_code??null,
          max_devices:state.max_devices,
          max_desktop_devices:state.max_desktop_devices,
          max_web_devices:state.max_web_devices,
          max_mobile_devices:state.max_mobile_devices
         }
        :{
          status:'activation_required',
          features:[]
         }
      }
     }
    )

    // Compatibility-only merchant maintenance route. New hosted and browser
    // activation has exactly one public endpoint: /api/license/device-activate.
    // The desktop sidecar retains its own local /api/license/activate relay.
    app.post(
     '/api/internal/license/activate-legacy',
     {preHandler:merchant},
     async(request,reply)=>{
      const user=(request as any).merchant as User

      if(!['owner','patron','admin'].includes(user.role))
       return reply.code(403).send({
        message:'Only the Patron can activate a license.'
       })

      const input=z.object({
       license_key:z.string().min(20),
       installation_id:z.string().uuid(),
       device_public_key:z.string().min(16).max(5000),
       device_name:z.string().max(200).optional(),
       app_version:z.string().max(50),
       platform:z.string().max(80).optional()
      }).parse(request.body)

      const identity=await resolveRuntimeBusinessIdentity(
       operationalPool,
       user.businessId
      )
      if(!identity)
       return reply.code(409).send({
        message:'This runtime business is not provisioned by the Vendor control plane.',
        code:'BUSINESS_VENDOR_IDENTITY_REQUIRED'
       })

      const controlBusinessId=
       config.SAAS_TENANCY_MODE==='database_per_tenant'
        ?currentTenant()?.controlBusinessId??null
        :user.businessId

      if(!controlBusinessId)
       return reply.code(409).send({
        message:'Workspace control-plane binding is incomplete.',
        code:'TENANT_CONTROL_BUSINESS_REQUIRED'
       })

      const client=await pool.connect()

      try{
       await client.query('begin')

       const license=(await client.query(
        `select
          l.*,
          p.code plan_code,
          vb.status vendor_business_status,
          (
           select business_id
           from business_licenses
           where license_id=l.id
           limit 1
          ) bound_business_id
         from licenses l
         join vendor_businesses vb
          on vb.id=l.vendor_business_id
         left join license_plans p
          on p.id=l.plan_id
         where l.key_hash=$1
         for update of l,vb`,
        [licenseKeyHash(input.license_key)]
       )).rows[0]

       if(!license)
        throw Object.assign(
         new Error('License key is invalid.'),
         {statusCode:422,code:'LICENSE_INVALID'}
        )

       if(license.vendor_business_status!=='active')
        throw Object.assign(
         new Error('Vendor Business is not active.'),
         {statusCode:403,code:'VENDOR_BUSINESS_INACTIVE'}
        )

       if(license.status!=='active')
        throw Object.assign(
         new Error('License is not active.'),
         {statusCode:403,code:license.status==='revoked'?'LICENSE_REVOKED':'LICENSE_INACTIVE'}
        )

       if(license.expires_at&&Date.parse(license.expires_at)<=Date.now())
        throw Object.assign(
         new Error('License has expired.'),
         {statusCode:403,code:'LICENSE_EXPIRED'}
        )

       if(license.vendor_business_id!==identity.vendorBusinessId)
        throw Object.assign(
         new Error('This license belongs to another Vendor Business.'),
         {statusCode:409,code:'LICENSE_VENDOR_BUSINESS_MISMATCH'}
        )

       if(license.business_type!==identity.businessType)
        throw Object.assign(
         new Error('This license is not compatible with the configured business type.'),
         {statusCode:422,code:'LICENSE_BUSINESS_TYPE_MISMATCH'}
        )

       if(
        license.bound_business_id&&
        Number(license.bound_business_id)!==controlBusinessId
       )
        throw Object.assign(
         new Error('This license is already assigned to another business.'),
         {statusCode:409,code:'LICENSE_ALREADY_BOUND'}
        )

       const requestedFingerprint=fingerprint(input.device_public_key)
       let device=(await client.query(
        `select *
         from license_devices
         where license_id=$1
          and installation_id=$2
         for update`,
        [license.id,input.installation_id]
       )).rows[0]

       if(device&&device.status!=='active')
        throw Object.assign(
         new Error('This device has been revoked.'),
         {statusCode:403,code:'DEVICE_REVOKED'}
        )

       if(device&&device.channel!=='web')
        throw Object.assign(
         new Error('This installation identifier is already used by another device channel.'),
         {statusCode:409,code:'DEVICE_CHANNEL_MISMATCH'}
        )

       if(device&&device.device_fingerprint!==requestedFingerprint)
        throw Object.assign(
         new Error('Device identity mismatch.'),
         {statusCode:403,code:'DEVICE_IDENTITY_MISMATCH'}
        )

       if(!device){
        await assertDeviceSlotAvailable(client,license,'web')
        device=(await client.query(
         `insert into license_devices(
           license_id,installation_id,device_public_key,device_fingerprint,
           device_name,app_version,channel,platform,last_validated_at,last_seen_at
          ) values($1,$2,$3,$4,$5,$6,'web',$7,now(),now())
          returning *`,
         [
          license.id,input.installation_id,input.device_public_key,
          requestedFingerprint,input.device_name??null,input.app_version,
          input.platform??null
         ]
        )).rows[0]
       }else{
        device=(await client.query(
         `update license_devices
          set device_name=$1,app_version=$2,platform=$3,
              last_validated_at=now(),last_seen_at=now()
          where id=$4
          returning *`,
         [input.device_name??null,input.app_version,input.platform??null,device.id]
        )).rows[0]
       }

       const signed=await issue(license,device,controlBusinessId)

       await client.query(
        `insert into business_licenses(
          business_id,license_id,certificate_json,certificate_signature,status
         ) values($1,$2,$3,$4,'active')
         on conflict(business_id)
         do update set
          license_id=excluded.license_id,
          certificate_json=excluded.certificate_json,
          certificate_signature=excluded.certificate_signature,
          status='active',
          updated_at=now()`,
        [
         controlBusinessId,license.id,
         JSON.stringify(signed.certificate),signed.signature
        ]
       )

       await client.query(
        `insert into license_activations(
          license_id,device_id,certificate_id,kind,status
         ) values($1,$2,$3,'web_online','approved')`,
        [license.id,device.id,signed.certificate.certificate_id]
       )

       await client.query('commit')
       return{data:signed}
      }
      catch(error){
       await client.query('rollback')
       throw error
      }
      finally{
       client.release()
      }
     }
    )

    // Compatibility heartbeat. Web/PWA devices are allocated by /api/login
    // using a server-signed HttpOnly device cookie; native mobile devices are
    // allocated by /api/auth/mobile/login using an Ed25519 proof. Never trust
    // a browser-supplied installation id to allocate commercial slots.
    app.post(
     '/api/license/session-device',
     {preHandler:merchant,config:{rateLimit:{max:30,timeWindow:'1 minute'}}},
     async(request)=>{
      const user=(request as any).merchant as User
      const device=await touchSessionDevice({
       controlPool:pool,
       operationalPool,
       merchant:user,
       request
      })
      return{data:device}
     }
    )

    app.post('/api/provision/activate-device', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        z.object({ intent: z.literal('activate-provisioned-device') }).strict().parse(request.body);
        const plaintext = readProvisioningActivationGrantCookie(request);
        if (!plaintext) {
            return reply.code(401).send({
                message: 'No provisioning activation grant is available.',
                code: 'PROVISIONING_ACTIVATION_GRANT_REQUIRED'
            });
        }

        const client = await pool.connect();
        try {
            await client.query('begin');
            const grant = await lockProvisioningActivationGrant(client, plaintext);
            validateProvisioningActivationGrant(grant);

            const channel = sessionChannelForRequest(request);
            const installationId = crypto.randomUUID();
            const publicIdentity = `${channel}-cookie-v1:${installationId}`;
            const deviceName = String(request.headers['user-agent'] ?? 'CorePOS browser').slice(0, 200);
            const appVersion = String(request.headers['x-bimik-app-version'] ?? (channel === 'mobile' ? 'pwa' : 'web')).slice(0, 100);
            const platform = channel === 'mobile' ? 'mobile-web' : 'web';

            await assertDeviceSlotAvailable(client, grant, channel);
            const device = (await client.query(
                `insert into license_devices(
                   license_id,installation_id,device_public_key,device_fingerprint,
                   device_name,app_version,channel,platform,last_validated_at,last_seen_at
                 ) values($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
                 returning *`,
                [
                    grant.grant_license_id,
                    installationId,
                    publicIdentity,
                    fingerprint(publicIdentity),
                    deviceName,
                    appVersion,
                    channel,
                    platform
                ]
            )).rows[0];

            const consumed = (await client.query(
                `update provisioning_activation_grants
                 set consumed_at=now(),consumed_device_id=$2,updated_at=now()
                 where id=$1 and consumed_at is null and revoked_at is null and expires_at>now()
                 returning id`,
                [grant.grant_id, device.id]
            )).rows[0];
            if (!consumed) {
                throw Object.assign(
                    new Error('The provisioning activation grant was consumed concurrently.'),
                    { statusCode: 409, code: 'PROVISIONING_ACTIVATION_GRANT_REPLAY' }
                );
            }

            await client.query(
                `insert into license_activations(
                   license_id,device_id,kind,status,request_nonce
                 ) values($1,$2,'provisioning_grant','approved',$3)`,
                [grant.grant_license_id, device.id, grant.grant_id]
            );
            await client.query(
                `insert into license_audit_logs(actor,action,entity_type,entity_id,description)
                 values('system','provisioning_activation.consume','device',$1,$2)`,
                [device.id, `Provisioning activation grant consumed for tenant ${grant.grant_tenant_id}`]
            );
            await client.query('commit');

            setActivatedDeviceCookie(reply, device.id);
            setSessionDeviceCookie(reply, installationId, channel);
            clearProvisioningActivationGrantCookie(reply);
            return reply.code(201).send({ data: { activated: true } });
        } catch (error) {
            await client.query('rollback');
            if (Number((error as any)?.statusCode) < 500) {
                clearProvisioningActivationGrantCookie(reply);
            }
            throw error;
        } finally {
            client.release();
        }
    });

    app.post('/api/license/device-activate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        // Compatibility note: the field is still named `license_key` because
        // shipped Desktop clients already send it. Its value is now a
        // short-lived one-time activation credential (CP-XXXX-XXXX-XXXX-XXXX
        // or a legacy act_ token), never the reusable commercial licence secret.
        const input = z.object({
            license_key: z.string().min(18).max(200),
            installation_id: z.string().uuid(),
            device_public_key: z.string().min(40).max(5000),
            device_name: z.string().min(1).max(200),
            app_version: z.string().min(1).max(100),
            nonce: z.string().min(16).max(200),
            requested_at: z.string().datetime(),
            device_proof: z.string().min(40).max(500)
        }).parse(request.body);
        if (!activationRequestIsFresh(input.requested_at, activationWindowMs()))
            return reply.code(422).send({ message: 'Activation request timestamp is outside the allowed window.', code: 'ACTIVATION_REQUEST_STALE' });
        if (!verifyOfflineDeviceProof(input.device_public_key, onlineDeviceProofPayload(input), input.device_proof)) {
            return reply.code(403).send({
                message: 'Device activation proof is invalid.',
                code: 'DEVICE_PROOF_INVALID'
            });
        }
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = await lockActivationCode(client, input.license_key, 'desktop');
            validateActivationCode(license, input.installation_id);
            await requireActivationReady(client, license.id);
            const replay = (await client.query('select 1 from license_activations where license_id=$1 and request_nonce=$2 limit 1', [license.id, input.nonce])).rows[0];
            if (replay)
                throw Object.assign(new Error('This activation request was already used.'), { statusCode: 409, code: 'ACTIVATION_REPLAY' });
            const requestedFingerprint = fingerprint(input.device_public_key);
            let device = (await client.query('select * from license_devices where license_id=$1 and installation_id=$2 for update', [license.id, input.installation_id])).rows[0];
            if (device && device.status !== 'active')
                throw Object.assign(new Error('This device has been revoked.'), { statusCode: 403, code: 'DEVICE_REVOKED' });
            if (device && device.device_fingerprint !== requestedFingerprint)
                throw Object.assign(new Error('Device identity mismatch.'), { statusCode: 403, code: 'DEVICE_IDENTITY_MISMATCH' });
            if (device && device.channel !== 'desktop')
                throw Object.assign(new Error('Device channel mismatch.'), { statusCode: 409, code: 'DEVICE_CHANNEL_MISMATCH' });
            if (!device) {
                await assertDeviceSlotAvailable(client, license, 'desktop');
                device = (await client.query('insert into license_devices(license_id,installation_id,device_public_key,device_fingerprint,device_name,app_version,channel,platform,last_validated_at,last_seen_at) values($1,$2,$3,$4,$5,$6,\'desktop\',\'windows\',now(),now()) returning *', [
                    license.id,
                    input.installation_id,
                    input.device_public_key,
                    requestedFingerprint,
                    input.device_name,
                    input.app_version
                ])).rows[0];
            }
            else {
                device = (await client.query('update license_devices set device_name=$1,app_version=$2,last_validated_at=now(),last_seen_at=now() where id=$3 returning *', [
                    input.device_name,
                    input.app_version,
                    device.id
                ])).rows[0];
            }
            const signed = await issue(license, device, null);
            const consumed = (await client.query(
                `update license_activation_codes
                 set consumed_at=now(),consumed_device_id=$2,updated_at=now()
                 where id=$1 and consumed_at is null and revoked_at is null and expires_at>now()
                 returning id`,
                [license.activation_code_id, device.id]
            )).rows[0];
            if (!consumed)
                throw Object.assign(new Error('Activation code was consumed concurrently.'), { statusCode: 409, code: 'ACTIVATION_CODE_REPLAY' });
            await client.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'desktop_activation_code','approved',$4)", [
                license.id,
                device.id,
                signed.certificate.certificate_id,
                input.nonce
            ]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('device','activation_code.consume','activation_code',$1,$2)", [
                license.activation_code_id,
                `One-time Desktop activation code consumed by device ${device.id}`
            ]);
            await client.query('commit');
            clearSessionDeviceCookie(reply);
            setActivatedDeviceCookie(reply, device.id);
            return reply.code(201).send({ data: signed });
        }
        catch (error) {
            await client.query('rollback');
            const failureCode = typeof (error as any)?.code === 'string'
                ? (error as any).code
                : 'ACTIVATION_CODE_INVALID';
            await pool.query(
                "insert into license_audit_logs(actor,action,entity_type,description) values('device','activation_code.reject','activation_code',$1)",
                [`Rejected Desktop activation attempt: ${failureCode}`]
            ).catch(() => undefined);
            if (replayError(error))
                return reply.code(409).send({ message: 'This activation request was already used.', code: 'ACTIVATION_REPLAY' });
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/api/license/device-validate', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
        const input = z.object({
            license_id: z.string().uuid(),
            certificate_id: z.string().uuid(),
            installation_id: z.string().uuid(),
            device_public_key: z.string().min(40).max(5000),
            device_name: z.string().min(1).max(200),
            app_version: z.string().min(1).max(100),
            nonce: z.string().min(16).max(200),
            requested_at: z.string().datetime(),
            device_proof: z.string().min(40).max(500)
        }).strict().parse(request.body);
        if (!activationRequestIsFresh(input.requested_at, activationWindowMs()))
            return reply.code(422).send({ message: 'Validation request timestamp is outside the allowed window.', code: 'ACTIVATION_REQUEST_STALE' });
        if (!verifyOfflineDeviceProof(input.device_public_key, deviceValidationProofPayload(input), input.device_proof))
            return reply.code(403).send({ message: 'Device validation proof is invalid.', code: 'DEVICE_PROOF_INVALID' });

        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query(
                'select l.*,p.code plan_code,vb.status vendor_business_status from licenses l join vendor_businesses vb on vb.id=l.vendor_business_id left join license_plans p on p.id=l.plan_id where l.id=$1 for update of l,vb',
                [input.license_id]
            )).rows[0];
            if (!license) {
                await client.query('rollback');
                return reply.code(404).send({ message: 'License not found.', code: 'LICENSE_NOT_FOUND' });
            }
            if (license.vendor_business_status !== 'active') {
                await client.query('rollback');
                return reply.code(403).send({ message: 'Vendor Business is not active.', code: 'VENDOR_BUSINESS_INACTIVE' });
            }
            if (license.status !== 'active') {
                await client.query('rollback');
                return reply.code(403).send({ message: 'License is not active.', code: license.status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INACTIVE' });
            }
            if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) {
                await client.query('rollback');
                return reply.code(403).send({ message: 'License has expired.', code: 'LICENSE_EXPIRED' });
            }
            const device = (await client.query(
                'select * from license_devices where license_id=$1 and installation_id=$2 for update',
                [license.id, input.installation_id]
            )).rows[0];
            if (!device || device.status !== 'active') {
                await client.query('rollback');
                return reply.code(403).send({ message: 'Device is revoked or unknown.', code: 'DEVICE_REVOKED' });
            }
            if (device.channel !== 'desktop') {
                await client.query('rollback');
                return reply.code(409).send({ message: 'Device channel mismatch.', code: 'DEVICE_CHANNEL_MISMATCH' });
            }
            if (device.device_fingerprint !== fingerprint(input.device_public_key) || device.device_public_key !== input.device_public_key) {
                await client.query('rollback');
                return reply.code(403).send({ message: 'Device identity mismatch.', code: 'DEVICE_IDENTITY_MISMATCH' });
            }
            const priorCertificate = (await client.query(
                'select 1 from license_activations where license_id=$1 and device_id=$2 and certificate_id=$3 and status=\'approved\' limit 1',
                [license.id, device.id, input.certificate_id]
            )).rows[0];
            if (!priorCertificate) {
                await client.query('rollback');
                return reply.code(403).send({ message: 'Certificate is not bound to this device.', code: 'DEVICE_IDENTITY_MISMATCH' });
            }
            const signed = await issue(license, device, null);
            await client.query('update license_devices set device_name=$1,app_version=$2,last_validated_at=now(),last_seen_at=now() where id=$3', [input.device_name, input.app_version, device.id]);
            await client.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'desktop_validation','approved',$4)", [license.id, device.id, signed.certificate.certificate_id, input.nonce]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('device','desktop_validation.approve','device',$1,'Desktop certificate revalidated')", [device.id]);
            await client.query('commit');
            setActivatedDeviceCookie(reply, device.id);
            return { data: signed };
        } catch (error) {
            await client.query('rollback');
            if (replayError(error)) return reply.code(409).send({ message: 'This validation request was already used.', code: 'ACTIVATION_REPLAY' });
            throw error;
        } finally {
            client.release();
        }
    });
    app.get('/api/vendor/plans',{preHandler:vendor},async()=>({
     data:(await pool.query('select * from license_plans order by name')).rows
    }))
    app.post('/api/vendor/plans',{preHandler:vendor},async(request,reply)=>{
     const input=z.object({
      code:z.string().regex(/^[a-z0-9_-]+$/),
      name:z.string().min(1),
      features,
      default_device_limit:z.number().int().positive(),
      default_desktop_device_limit:z.number().int().min(0).nullable().optional(),
      default_web_device_limit:z.number().int().min(0).nullable().optional(),
      default_mobile_device_limit:z.number().int().min(0).nullable().optional(),
      offline_validity_days:z.number().int().positive().nullable().optional()
     }).parse(request.body)
     const row=(await pool.query(
      `insert into license_plans(
        code,name,features,default_device_limit,
        default_desktop_device_limit,default_web_device_limit,default_mobile_device_limit,
        offline_validity_days
       ) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
       input.code,input.name,JSON.stringify(input.features),input.default_device_limit,
       input.default_desktop_device_limit??null,input.default_web_device_limit??null,
       input.default_mobile_device_limit??null,input.offline_validity_days??null
      ]
     )).rows[0]
     await pool.query(
      "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','plan.create','plan',$1,$2)",
      [row.id,`Plan ${row.code} created`]
     )
     return reply.code(201).send({data:row})
    })
    app.put('/api/vendor/plans/:id',{preHandler:vendor},async(request,reply)=>{
     const planId=z.string().uuid().parse((request.params as any).id)
     const input=z.object({
      name:z.string().min(1),
      features,
      default_device_limit:z.number().int().positive(),
      default_desktop_device_limit:z.number().int().min(0).nullable().optional(),
      default_web_device_limit:z.number().int().min(0).nullable().optional(),
      default_mobile_device_limit:z.number().int().min(0).nullable().optional(),
      offline_validity_days:z.number().int().positive().nullable().optional(),
      active:z.boolean().optional()
     }).parse(request.body)
     const row=(await pool.query(
      `update license_plans set
        name=$2,features=$3,default_device_limit=$4,
        default_desktop_device_limit=$5,default_web_device_limit=$6,default_mobile_device_limit=$7,
        offline_validity_days=$8,active=$9,updated_at=now()
       where id=$1 returning *`,
      [
       planId,input.name,JSON.stringify(input.features),input.default_device_limit,
       input.default_desktop_device_limit??null,input.default_web_device_limit??null,
       input.default_mobile_device_limit??null,input.offline_validity_days??null,input.active??true
      ]
     )).rows[0]
     if(!row)return reply.code(404).send({message:'Plan not found.'})
     await pool.query(
      "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','plan.update','plan',$1,$2)",
      [row.id,`Plan ${row.code} updated`]
     )
     return{data:row}
    })
    app.get('/api/vendor/customers', { preHandler: vendor }, async () => ({ data: (await pool.query('select * from license_customers order by created_at desc')).rows }));
    app.post('/api/vendor/customers', { preHandler: vendor }, async (request, reply) => { const input = z.object({ name: z.string().min(1), email: z.string().email().nullable().optional(), phone: z.string().max(80).nullable().optional(), notes: z.string().max(1000).nullable().optional() }).parse(request.body), row = (await pool.query('insert into license_customers(name,email,phone,notes) values($1,$2,$3,$4) returning *', [input.name, input.email ?? null, input.phone ?? null, input.notes ?? null])).rows[0]; await pool.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','customer.create','customer',$1,$2)", [row.id, `Customer ${row.name} created`]); return reply.code(201).send({ data: row }); });
    app.get('/api/vendor/businesses',{preHandler:vendor},async()=>{
        const rows=(await pool.query(
            `select vb.id,vb.name,vb.business_type,vb.status,vb.status vendor_business_status,vb.notes,vb.created_at,vb.updated_at,
              c.name customer_name,c.email customer_email,c.phone customer_phone,
              l.id license_id,l.status license_status,l.expires_at license_expires_at,
              l.max_devices,l.max_desktop_devices,l.max_web_devices,l.max_mobile_devices,
              p.name plan_name,p.code plan_code,
              (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active') active_devices,
              (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id,
              t.status tenant_status,
              recipe.last_error_code provisioning_error_code,
              recipe.attempts provisioning_attempts
             from vendor_businesses vb
             join license_customers c on c.id=vb.customer_id
             left join lateral (
               select * from licenses where vendor_business_id=vb.id
               order by issued_at desc,created_at desc limit 1
             ) l on true
             left join license_plans p on p.id=l.plan_id
             left join saas_tenants t on t.vendor_business_id=vb.id
             left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id
             order by vb.created_at desc`
        )).rows;
        return {data:rows.map(row=>{
            const lifecycle=commercialLifecycle(row,config.SAAS_TENANCY_MODE);
            return {...row,lifecycle_state:lifecycle.state,readiness_reason:lifecycle.reason};
        })};
    });

    app.post('/api/vendor/businesses',{preHandler:vendor},async(_request,reply)=>{
        return reply.code(409).send({
            message:'Create businesses through the commercial business workflow so CorePOS can provision them internally.',
            code:'BUSINESS_CREATION_REQUIRES_COMMERCIAL_DETAILS'
        });
    });

    app.put('/api/vendor/businesses/:id',{preHandler:vendor},async(request,reply)=>{
        const businessId=z.string().uuid().parse(
            (request.params as any).id
        );

        const input=z.object({
            name:z.string().min(1).max(255),
            business_type:businessType,
            status:z.enum(['active','suspended','closed']),
            notes:z.string().max(1000).nullable().optional()
        }).parse(request.body);

        const client=await pool.connect();

        try{
            await client.query('begin');

            const current=(await client.query(
                'select * from vendor_businesses where id=$1 for update',
                [businessId]
            )).rows[0];

            if(!current){
                await client.query('rollback');

                return reply.code(404).send({
                    message:'Vendor Business not found.'
                });
            }

            if(
                input.business_type!==
                current.business_type
            ){
                const linked=Number(
                    (await client.query(
                        'select (select count(*) from licenses where vendor_business_id=$1)+(select count(*) from businesses where vendor_business_id=$1) count',
                        [businessId]
                    )).rows[0].count
                );

                if(linked>0)
                    throw Object.assign(
                        new Error(
                            'Business type cannot be changed after a licence or runtime business is linked.'
                        ),
                        {
                            statusCode:409,
                            code:'VENDOR_BUSINESS_TYPE_LOCKED'
                        }
                    );
            }

            const row=(await client.query(
                'update vendor_businesses set name=$2,business_type=$3,status=$4,notes=$5,updated_at=now() where id=$1 returning *',
                [
                    businessId,
                    input.name,
                    input.business_type,
                    input.status,
                    input.notes??null
                ]
            )).rows[0];

            await client.query(
                "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','business.update','vendor_business',$1,$2)",
                [
                    row.id,
                    'Vendor Business '+row.name+' updated'
                ]
            );

            await client.query('commit');

            return{data:row};
        }
        catch(error){
            await client.query('rollback');
            throw error;
        }
        finally{
            client.release();
        }
    });

  app.post('/api/provision/resolve',{
   config:{
    rateLimit:{
     max:5,
     timeWindow:'1 minute'
    }
   }
  },async(request,reply)=>{
   const input=z.object({
    provisioning_key:
     z.string().min(20).max(200)
   }).strict().parse(request.body)

   const credential=(
    await pool.query(
     `select
       k.channel,
       k.expires_at provisioning_expires_at,
       k.consumed_at,
       k.revoked_at,

       l.status license_status,
       l.expires_at license_expires_at,
       l.business_type,
       l.allowed_features,

       vb.name vendor_business_name,
       vb.status vendor_business_status,

       p.code plan_code,

       (
        select b.id
        from businesses b
        where b.vendor_business_id=
         l.vendor_business_id
        limit 1
       ) runtime_business_id

      from license_provisioning_keys k
      join licenses l
       on l.id=k.license_id
      join vendor_businesses vb
       on vb.id=l.vendor_business_id
      left join license_plans p
       on p.id=l.plan_id
      where k.key_hash=$1
      limit 1`,
     [
      licenseKeyHash(
       input.provisioning_key
      )
     ]
    )
   ).rows[0]

   if(!credential){
    return reply.code(422).send({
     message:
      'Provisioning credential is invalid.',
     code:
      'PROVISIONING_KEY_INVALID'
    })
   }

   if(
    credential.channel!=='cloud'
   ){
    return reply.code(422).send({
     message:
      'This provisioning credential is not valid for cloud provisioning.',
     code:
      'PROVISIONING_CHANNEL_MISMATCH'
    })
   }

   if(credential.consumed_at){
    return reply.code(409).send({
     message:
      'This provisioning credential has already been used.',
     code:
      'PROVISIONING_KEY_ALREADY_CONSUMED'
    })
   }

   if(credential.revoked_at){
    return reply.code(410).send({
     message:
      'This provisioning credential has been revoked.',
     code:
      'PROVISIONING_KEY_REVOKED'
    })
   }

   if(
    credential.provisioning_expires_at &&
    new Date(
     credential.provisioning_expires_at
    ).getTime()<=Date.now()
   ){
    return reply.code(410).send({
     message:
      'This provisioning credential has expired.',
     code:
      'PROVISIONING_KEY_EXPIRED'
    })
   }

   if(
    credential.vendor_business_status!==
     'active'
   ){
    return reply.code(403).send({
     message:
      'Vendor Business is not active.',
     code:
      'VENDOR_BUSINESS_INACTIVE'
    })
   }

   if(
    credential.license_status!==
     'active'
   ){
    return reply.code(403).send({
     message:
      'License is not active.',
     code:
      credential.license_status==='revoked'
       ?'LICENSE_REVOKED'
       :'LICENSE_INACTIVE'
    })
   }

   if(
    credential.license_expires_at &&
    new Date(
     credential.license_expires_at
    ).getTime()<=Date.now()
   ){
    return reply.code(410).send({
     message:
      'License has expired.',
     code:
      'LICENSE_EXPIRED'
    })
   }

   if(credential.runtime_business_id){
    return reply.code(409).send({
     message:
      'This Vendor Business has already been provisioned.',
     code:
      'VENDOR_BUSINESS_ALREADY_PROVISIONED'
    })
   }

   const allowedFeatures=
    Array.isArray(
     credential.allowed_features
    )
     ?credential.allowed_features
     :[]

   return {
    data:{
     vendor_business_name:
      credential.vendor_business_name,

     business_type:
      credential.business_type,

     plan:
      credential.plan_code??null,

     allowed_features:
      allowedFeatures,

     provisioning_expires_at:
      credential.provisioning_expires_at
       ?new Date(
        credential.provisioning_expires_at
       ).toISOString()
       :null,

     license_expires_at:
      credential.license_expires_at
       ?new Date(
        credential.license_expires_at
       ).toISOString()
       :null
    }
   }
  })

  app.post('/api/provision',{
   config:{
    rateLimit:{
     max:5,
     timeWindow:'1 minute'
    }
   }
  },async(request,reply)=>{
   const input=z.object({
    provisioning_key:
     z.string().min(20).max(500),
    setup:businessSetupSchema
   }).strict().parse(request.body)

   /*
    * Hash immediately. Plaintext is never
    * persisted or included in our responses.
    */
   const keyHash=
    licenseKeyHash(
     input.provisioning_key
    )

   const setup=
    input.setup

   const requestedFeatures=[
    ...new Set(
     setup.enabled_features
    )
   ]

   const slugBase=
    setup.business.name
     .toLowerCase()
     .normalize('NFKD')
     .replace(/[\u0300-\u036f]/g,'')
     .replace(/[^a-z0-9]+/g,'-')
     .replace(/^-|-$/g,'') ||
    'business'

   const client=
    await pool.connect()

   try{
    await client.query('begin')

    /*
     * Lock credential + licence + Vendor Business.
     * This serializes replay and concurrent
     * provisioning for the same commercial
     * identity.
     */
    const credential=(
     await client.query(`
      select
       k.id provisioning_key_id,
       k.channel,
       k.expires_at provisioning_expires_at,
       k.consumed_at,
       k.consumed_business_id,
       k.revoked_at,

       l.id license_id,
       l.customer_id,
       l.vendor_business_id,
       l.business_type,
       l.allowed_features,
       l.status license_status,
       l.expires_at license_expires_at,

       vb.status vendor_business_status,
       vb.business_type vendor_business_type,

       (
        select b.id
        from businesses b
        where
         b.vendor_business_id=
          l.vendor_business_id
        limit 1
       ) runtime_business_id,

       (
        select bl.business_id
        from business_licenses bl
        where bl.license_id=l.id
        limit 1
       ) bound_business_id

      from license_provisioning_keys k

      join licenses l
       on l.id=k.license_id

      join vendor_businesses vb
       on vb.id=l.vendor_business_id

      where k.key_hash=$1

      for update of k,l,vb
     `,[
      keyHash
     ])
    ).rows[0]

    if(!credential){
     await client.query('rollback')

     return reply.code(422).send({
      message:
       'Provisioning credential is invalid.',
      code:
       'PROVISIONING_KEY_INVALID'
     })
    }

    if(
     credential.channel!=='cloud'
    ){
     await client.query('rollback')

     return reply.code(422).send({
      message:
       'This provisioning credential cannot be used for cloud provisioning.',
      code:
       'PROVISIONING_CHANNEL_MISMATCH'
     })
    }

    if(credential.consumed_at){
     await client.query('rollback')

     return reply.code(409).send({
      message:
       'This provisioning credential has already been used.',
      code:
       'PROVISIONING_KEY_ALREADY_CONSUMED'
     })
    }

    if(credential.revoked_at){
     await client.query('rollback')

     return reply.code(410).send({
      message:
       'This provisioning credential has been revoked.',
      code:
       'PROVISIONING_KEY_REVOKED'
     })
    }

    if(
     credential.provisioning_expires_at &&
     new Date(
      credential.provisioning_expires_at
     ).getTime()<=Date.now()
    ){
     await client.query('rollback')

     return reply.code(410).send({
      message:
       'This provisioning credential has expired.',
      code:
       'PROVISIONING_KEY_EXPIRED'
     })
    }

    if(
     credential.vendor_business_status!==
      'active'
    ){
     await client.query('rollback')

     return reply.code(403).send({
      message:
       'Vendor Business is not active.',
      code:
       'VENDOR_BUSINESS_INACTIVE'
     })
    }

    if(
     credential.license_status!==
      'active'
    ){
     await client.query('rollback')

     return reply.code(403).send({
      message:
       'License is not active.',
      code:
       credential.license_status==='revoked'
        ?'LICENSE_REVOKED'
        :'LICENSE_INACTIVE'
     })
    }

    if(
     credential.license_expires_at &&
     new Date(
      credential.license_expires_at
     ).getTime()<=Date.now()
    ){
     await client.query('rollback')

     return reply.code(403).send({
      message:
       'License has expired.',
      code:
       'LICENSE_EXPIRED'
     })
    }

    if(
     credential.business_type!==
      setup.business.business_type ||
     credential.vendor_business_type!==
      setup.business.business_type
    ){
     await client.query('rollback')

     return reply.code(422).send({
      message:
       'Provisioned business type must match the Vendor Business license.',
      code:
       'PROVISIONING_BUSINESS_TYPE_MISMATCH'
     })
    }

    const allowedFeatures:
     string[]=
      Array.isArray(
       credential.allowed_features
      )
       ?credential.allowed_features
       :[]

    const denied=
     requestedFeatures.filter(
      feature=>
       !allowedFeatures.includes(
        feature
       )
     )

    if(denied.length){
     await client.query('rollback')

     return reply.code(403).send({
      message:
       'One or more selected modules are not included in the license.',
      code:
       'LICENSE_ENTITLEMENT_REQUIRED',
      features:denied
     })
    }

    if(
     credential.runtime_business_id ||
     credential.bound_business_id
    ){
     await client.query('rollback')

     return reply.code(409).send({
      message:
       'This Vendor Business is already provisioned.',
      code:
       'VENDOR_BUSINESS_ALREADY_PROVISIONED'
     })
    }

    /*
     * Hash Patron password only after the
     * credential has passed commercial checks.
     */
    const password=
     await argon2.hash(
      setup.admin.password
     )

    if(config.SAAS_TENANCY_MODE==='database_per_tenant'){
     /*
      * Operational data is created in its own PostgreSQL database.
      * The control plane keeps only a tiny shadow `businesses` row so
      * existing commercial FKs remain valid. Tenant provisioning is
      * idempotent, therefore a retry after a control-plane failure does
      * not create a second business database.
      */
     const tenantProvisioned=await provisionTenantDatabase({
      vendorBusinessId:String(credential.vendor_business_id),
      setup:{
       business:{
        name:setup.business.name,
        business_type:setup.business.business_type,
        logo:setup.business.logo??null,
        currency:setup.business.currency,
        locale:setup.business.locale,
        timezone:setup.business.timezone,
        address:setup.business.address??null,
        phone:setup.business.phone??null
       },
       enabled_features:requestedFeatures,
       admin:{
        name:setup.admin.name,
        email:setup.admin.email
       }
      },
      passwordHash:password
     }).catch(error=>{
      if(Number((error as any)?.statusCode)>=400)throw error
      throw Object.assign(
       new Error('Tenant provisioning failed. The provisioning code was not consumed.'),
       {statusCode:503,code:'TENANT_PROVISIONING_FAILED',cause:error}
      )
     })

     const ids=tenantIdentifiers(
      setup.business.name,
      String(credential.vendor_business_id)
     )

     const shadowBusiness=(await client.query(
      `insert into businesses(
        name,slug,business_type,logo,currency,locale,timezone,vendor_business_id
       ) values($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
       setup.business.name,ids.slug,setup.business.business_type,
       setup.business.logo??null,setup.business.currency.toUpperCase(),
       setup.business.locale,setup.business.timezone,
       credential.vendor_business_id
      ]
     )).rows[0]

     const tenant=(await client.query(
      `insert into saas_tenants(
        vendor_business_id,control_business_id,slug,database_name,status,
        schema_version,provisioned_at,last_error
       ) values($1,$2,$3,$4,'active',$5,now(),null)
       on conflict(vendor_business_id) do update set
        control_business_id=excluded.control_business_id,
        slug=excluded.slug,
        database_name=excluded.database_name,
        status='active',
        schema_version=excluded.schema_version,
        provisioned_at=coalesce(saas_tenants.provisioned_at,now()),
        last_error=null,
        updated_at=now()
       returning *`,
      [
       credential.vendor_business_id,shadowBusiness.id,
       ids.slug,ids.databaseName,tenantProvisioned.schemaVersion
      ]
     )).rows[0]

     await client.query(
      `insert into business_licenses(business_id,license_id,status)
       values($1,$2,'active')
       on conflict(business_id) do update set
        license_id=excluded.license_id,status='active',updated_at=now()`,
      [shadowBusiness.id,credential.license_id]
     )

     const consumed=(await client.query(
      `update license_provisioning_keys
       set consumed_at=now(),consumed_business_id=$2,updated_at=now()
       where id=$1 and consumed_at is null and revoked_at is null
       returning id`,
      [credential.provisioning_key_id,shadowBusiness.id]
     )).rows[0]

     if(!consumed)
      throw Object.assign(
       new Error('Provisioning credential was consumed concurrently.'),
       {statusCode:409,code:'PROVISIONING_KEY_REPLAY'}
      )

     await client.query(
      `insert into license_audit_logs(
        actor,action,entity_type,entity_id,description
       ) values('system','tenant.provision','saas_tenant',$1,$2)`,
      [
       tenant.id,
       `Dedicated database ${ids.databaseName} provisioned for Vendor Business ${credential.vendor_business_id}`
      ]
     )

     const activationGrant=await issueProvisioningActivationGrant({
      client,
      provisioningKeyId:String(credential.provisioning_key_id),
      licenseId:String(credential.license_id),
      vendorBusinessId:String(credential.vendor_business_id),
      tenantId:String(tenant.id),
      licenseExpiresAt:credential.license_expires_at
     })

     await client.query('commit')

     setProvisioningActivationGrantCookie(
      reply,
      activationGrant.plaintext,
      activationGrant.expiresAt
     )

     return reply.code(201).send({
      data:{
       business:tenantProvisioned.business,
       branch:tenantProvisioned.branch,
       patron:tenantProvisioned.patron,
       tenant:{
        id:tenant.id,
        slug:tenant.slug,
        database_name:tenant.database_name,
        status:tenant.status
       },
       license:{
        id:credential.license_id,
        vendor_business_id:credential.vendor_business_id,
        business_type:credential.business_type,
        features:allowedFeatures
       }
      }
     })
    }

    /*
     * Shared-mode slug creation:
     * first try the readable base, then a
     * deterministic Vendor Business suffix.
     */
    let business:any=null

    const slugCandidates=[
     slugBase,
     slugBase+'-'+
      String(
       credential.vendor_business_id
      ).slice(0,8)
    ]

    for(
     const slug of slugCandidates
    ){
     const created=(
      await client.query(`
       insert into businesses(
        name,
        slug,
        business_type,
        logo,
        currency,
        locale,
        timezone,
        vendor_business_id
       )
       values(
        $1,$2,$3,$4,$5,$6,$7,$8
       )
       on conflict(slug)
       do nothing
       returning *
      `,[
       setup.business.name,
       slug,
       setup.business.business_type,
       setup.business.logo??null,
       setup.business.currency
        .toUpperCase(),
       setup.business.locale,
       setup.business.timezone,
       credential.vendor_business_id
      ])
     ).rows[0]

     if(created){
      business=created
      break
     }
    }

    if(!business)
     throw Object.assign(
      new Error(
       'Unable to allocate a unique business slug.'
      ),
      {
       statusCode:409,
       code:
        'BUSINESS_SLUG_CONFLICT'
      }
     )

    const branch=(
     await client.query(
      `insert into branches(
        business_id,
        name,
        code,
        address,
        phone
       )
       values(
        $1,
        'Principal',
        'MAIN',
        $2,
        $3
       )
       returning *`,
      [
       business.id,
       setup.business.address??null,
       setup.business.phone??null
      ]
     )
    ).rows[0]

    for(
     const feature of
      requestedFeatures
    ){
     await client.query(
      `insert into business_features(
        business_id,
        feature
       )
       values($1,$2)`,
      [
       business.id,
       feature
      ]
     )
    }

    /*
     * New licensed businesses start with
     * the canonical visible owner role:
     * Patron.
     */
    const patron=(
     await client.query(
      `insert into users(
        business_id,
        branch_id,
        name,
        email,
        password,
        role,
        is_active
       )
       values(
        $1,$2,$3,$4,$5,
        'patron',
        true
       )
       returning
        id,
        name,
        email,
        role,
        is_active`,
      [
       business.id,
       branch.id,
       setup.admin.name,
       setup.admin.email
        .toLowerCase(),
       password
      ]
     )
    ).rows[0]

    /*
     * Cloud tenant licence binding does not
     * require a device certificate.
     */
    await client.query(
     `insert into business_licenses(
       business_id,
       license_id,
       status
      )
      values(
       $1,$2,'active'
      )`,
     [
      business.id,
      credential.license_id
     ]
    )

    /*
     * Replay-safe one-time consumption.
     */
    const consumed=(
     await client.query(
      `update license_provisioning_keys
       set
        consumed_at=now(),
        consumed_business_id=$2,
        updated_at=now()
       where id=$1
        and consumed_at is null
        and revoked_at is null
       returning id`,
      [
       credential.provisioning_key_id,
       business.id
      ]
     )
    ).rows[0]

    if(!consumed)
     throw Object.assign(
      new Error(
       'Provisioning credential was consumed concurrently.'
      ),
      {
       statusCode:409,
       code:
        'PROVISIONING_KEY_REPLAY'
      }
     )

    await client.query(
     `insert into license_audit_logs(
       actor,
       action,
       entity_type,
       entity_id,
       description
      )
      values(
       'system',
       'provisioning_key.consume',
       'provisioning_key',
       $1,
       $2
      )`,
     [
      credential.provisioning_key_id,
      'Runtime business '+business.id+
       ' provisioned for Vendor Business '+
       credential.vendor_business_id
     ]
    )

    await client.query('commit')

    return reply.code(201).send({
     data:{
      business,
      branch,
      patron,
      license:{
       id:
        credential.license_id,
       vendor_business_id:
        credential.vendor_business_id,
       business_type:
        credential.business_type,
       features:
        allowedFeatures
      }
     }
    })
   }catch(error){
    await client.query('rollback')
    throw error
   }finally{
    client.release()
   }
  })

  // Normal commercial onboarding: the Vendor supplies business and owner
  // details once; CorePOS provisions infrastructure internally. No customer
  // provisioning key or activation code is created here.
  app.post('/api/vendor/onboarding',{preHandler:vendor},async(request,reply)=>{
   const input=z.object({
    customer:z.object({
     name:z.string().trim().min(1).max(255),
     email:z.string().email().nullable().optional(),
     phone:z.string().max(80).nullable().optional(),
     notes:z.string().max(1000).nullable().optional()
    }),
    business:z.object({
     name:z.string().trim().min(1).max(255),
     business_type:businessType,
     logo:z.string().max(2_000_000).nullable().optional(),
     currency:z.string().trim().length(3).default('MAD'),
     locale:z.string().trim().min(2).max(16).default('fr-MA'),
     timezone:z.string().trim().min(2).max(80).default('Africa/Casablanca'),
     address:z.string().max(1000).nullable().optional(),
     phone:z.string().max(80).nullable().optional(),
     notes:z.string().max(1000).nullable().optional()
    }),
    owner:z.object({
     name:z.string().trim().min(1).max(255),
     email:z.string().email(),
     password:z.string().min(8).max(512)
    }),
    idempotency_key:z.string().uuid(),
    plan_id:z.string().uuid(),
    duration:z.enum(['lifetime','1_month','3_months','6_months','1_year','custom']).default('1_year'),
    custom_expires_at:z.string().datetime().nullable().optional(),
    offline_validity_days:z.number().int().positive().nullable().optional()
   }).parse(request.body)

   // A key is valid for exactly one request body. This prevents a retry token
   // from silently returning a prior business when a caller accidentally (or
   // maliciously) reuses it for different commercial details.
   const requestHash=crypto.createHash('sha256').update(JSON.stringify({
    customer:input.customer,business:input.business,owner:input.owner,
    plan_id:input.plan_id,duration:input.duration,
    custom_expires_at:input.custom_expires_at??null,
    offline_validity_days:input.offline_validity_days??null
   })).digest('hex')

   const now=new Date()
   let licenseExpiry:Date|null=input.duration==='lifetime'?null:new Date(now)
   if(input.duration==='custom'){
    if(!input.custom_expires_at)return reply.code(422).send({message:'Custom expiration is required.',code:'LICENSE_EXPIRY_REQUIRED'})
    licenseExpiry=new Date(input.custom_expires_at)
   }else if(licenseExpiry){
    if(input.duration==='1_month')licenseExpiry.setUTCMonth(licenseExpiry.getUTCMonth()+1)
    if(input.duration==='3_months')licenseExpiry.setUTCMonth(licenseExpiry.getUTCMonth()+3)
    if(input.duration==='6_months')licenseExpiry.setUTCMonth(licenseExpiry.getUTCMonth()+6)
    if(input.duration==='1_year')licenseExpiry.setUTCFullYear(licenseExpiry.getUTCFullYear()+1)
   }
   if(licenseExpiry&&(!Number.isFinite(licenseExpiry.getTime())||licenseExpiry.getTime()<=now.getTime()))return reply.code(422).send({message:'License expiration must be in the future.',code:'LICENSE_EXPIRY_INVALID'})

   const actor=(request as any).vendorAdmin?.username??'vendor'
   const passwordHash=await argon2.hash(input.owner.password)
   const client=await pool.connect()
   let customer:Record<string,unknown>
   let business:Record<string,unknown>
   let plan:Record<string,unknown>
   try{
    await client.query('begin')
    // Claim the key in the same transaction as customer/business creation.
    // PostgreSQL makes a concurrent duplicate wait for the winner to commit,
    // after which it receives the original business instead of making another
    // tenant or licence.
    const claimed=(await client.query(
      `insert into vendor_business_onboarding_requests(idempotency_key,request_hash)
       values($1,$2) on conflict do nothing returning idempotency_key`,
      [input.idempotency_key,requestHash]
    )).rows[0]
    if(!claimed){
      const previous=(await client.query(
        `select r.request_hash,vb.id,vb.name,vb.business_type,vb.customer_id
         from vendor_business_onboarding_requests r
         join vendor_businesses vb on vb.id=r.vendor_business_id
         where r.idempotency_key=$1
         for share of r,vb`,
        [input.idempotency_key]
      )).rows[0]
      if(!previous)throw Object.assign(new Error('The original business request did not complete. Submit it again with a new request.'),{statusCode:409,code:'ONBOARDING_REQUEST_INCOMPLETE'})
      if(!previous.request_hash||previous.request_hash!==requestHash)throw Object.assign(new Error('This idempotency key belongs to a different business request.'),{statusCode:409,code:'ONBOARDING_REQUEST_PAYLOAD_MISMATCH'})
      await client.query('commit')
      const lifecycle=await readVendorBusinessLifecycle(pool,String(previous.id))
      return reply.code(200).send({data:{
        replayed:true,
        customer:{id:previous.customer_id},
        business:{id:previous.id,name:previous.name,business_type:previous.business_type},
        plan:null,
        license:null,
        lifecycle
      }})
    }
    plan=(await client.query('select * from license_plans where id=$1 and active=true for share',[input.plan_id])).rows[0]
    if(!plan)throw Object.assign(new Error('Active plan not found.'),{statusCode:422,code:'PLAN_NOT_FOUND'})
    const planFeatures=Array.isArray(plan.features)?plan.features:[]
    if(!planFeatures.length)throw Object.assign(new Error('The selected plan has no modules.'),{statusCode:422,code:'PLAN_FEATURES_EMPTY'})

    customer=(await client.query(
     'insert into license_customers(name,email,phone,notes) values($1,$2,$3,$4) returning *',
     [input.customer.name,input.customer.email??null,input.customer.phone??null,input.customer.notes??null]
    )).rows[0]
    business=(await client.query(
     "insert into vendor_businesses(customer_id,name,business_type,status,notes) values($1,$2,$3,'active',$4) returning *",
     [customer.id,input.business.name,input.business.business_type,input.business.notes??null]
    )).rows[0]
    await client.query(
      `update vendor_business_onboarding_requests
       set vendor_business_id=$2 where idempotency_key=$1`,
      [input.idempotency_key,business.id]
    )
    const recipe={
     business:{
      name:input.business.name,business_type:input.business.business_type,logo:input.business.logo??null,
      currency:input.business.currency.toUpperCase(),locale:input.business.locale,timezone:input.business.timezone,
      address:input.business.address??null,phone:input.business.phone??input.customer.phone??null
     },
     enabled_features:planFeatures,
     admin:{name:input.owner.name,email:input.owner.email}
    }
    await client.query(
     `insert into vendor_business_provisioning(
       vendor_business_id,setup,owner_password_hash,plan_id,license_expires_at,offline_validity_days,notes
      ) values($1,$2,$3,$4,$5,$6,$7)`,
     [business.id,JSON.stringify(recipe),passwordHash,plan.id,licenseExpiry?.toISOString()??null,
      input.offline_validity_days===undefined?plan.offline_validity_days:input.offline_validity_days,
      'Created by Vendor business workflow']
    )
    await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values($1,'customer.create','customer',$2,$3)",[actor,customer.id,'Commercial contact created by business workflow'])
    await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values($1,'business.create','vendor_business',$2,$3)",[actor,business.id,'Business created; internal provisioning started'])
    await client.query('commit')
   }catch(error){
    await client.query('rollback')
    throw error
   }finally{
    client.release()
   }

   let provisioned:Awaited<ReturnType<typeof provisionVendorBusiness>>|null=null
   try{
    provisioned=await provisionVendorBusiness(pool,String(business.id),actor)
   }catch{
    // The provisioning helper persists the failure state and audit record.
    // Returning the created business lets the Vendor retry without creating a
    // second contact, business, licence, tenant database, or activation code.
   }
   const lifecycle=await readVendorBusinessLifecycle(pool,String(business.id))
   return reply.code(201).send({data:{
    customer:{id:customer.id,name:customer.name},
    business:{id:business.id,name:business.name,business_type:business.business_type},
    plan:{id:plan.id,code:plan.code,name:plan.name},
    license:provisioned?.license?publicLicense(provisioned.license):null,
    lifecycle
   }})
  })

  app.post('/api/vendor/businesses/:id/provision/retry',{preHandler:vendor},async(request,reply)=>{
   const businessId=z.string().uuid().parse((request.params as any).id)
   const actor=(request as any).vendorAdmin?.username??'vendor'
   const result=await provisionVendorBusiness(pool,businessId,actor)
   return reply.send({data:{
    license:publicLicense(result.license),
    lifecycle:result.lifecycle
   }})
  })

  app.get('/api/vendor/provisioning-keys',{preHandler:vendorInternalRecovery},async()=>({
   data:(await pool.query(`
    select
     k.id,
     k.license_id,
     k.key_hint,
     k.channel,
     k.expires_at,
     k.consumed_at,
     k.consumed_business_id,
     k.revoked_at,
     k.notes,
     k.created_at,
     k.updated_at,
     l.vendor_business_id,
     l.business_type,
     l.status license_status,
     vb.name vendor_business_name,
     vb.status vendor_business_status,
     c.name customer_name,
     p.code plan_code,
     case
      when k.consumed_at is not null then 'consumed'
      when k.revoked_at is not null then 'revoked'
      when k.expires_at<=now() then 'expired'
      else 'available'
     end provisioning_status
    from license_provisioning_keys k
    join licenses l on l.id=k.license_id
    join vendor_businesses vb on vb.id=l.vendor_business_id
    join license_customers c on c.id=l.customer_id
    left join license_plans p on p.id=l.plan_id
    order by k.created_at desc
    limit 500
   `)).rows
  }))

  app.post('/api/vendor/provisioning-keys',{preHandler:vendorInternalRecovery},async(request,reply)=>{
   const input=z.object({
    license_id:z.string().uuid(),
    channel:z.enum(['cloud','desktop','mobile']).default('cloud'),
    expires_at:z.string().datetime(),
    notes:z.string().max(1000).nullable().optional()
   }).parse(request.body)

   const requestedExpiry=new Date(input.expires_at)

   if(requestedExpiry.getTime()<=Date.now()){
    return reply.code(422).send({
     message:'Provisioning key expiration must be in the future.',
     code:'PROVISIONING_EXPIRY_INVALID'
    })
   }

   const client=await pool.connect()

   try{
    await client.query('begin')

    const license=(await client.query(`
     select
      l.*,
      p.code plan_code,
      vb.name vendor_business_name,
      vb.status vendor_business_status,
      c.name customer_name,
      (
       select b.id
       from businesses b
       where b.vendor_business_id=l.vendor_business_id
       limit 1
      ) runtime_business_id
     from licenses l
     join vendor_businesses vb on vb.id=l.vendor_business_id
     join license_customers c on c.id=l.customer_id
     left join license_plans p on p.id=l.plan_id
     where l.id=$1
     for update of l,vb
    `,[input.license_id])).rows[0]

    if(!license){
     await client.query('rollback')
     return reply.code(404).send({
      message:'License not found.',
      code:'LICENSE_NOT_FOUND'
     })
    }

    if(license.vendor_business_status!=='active'){
     await client.query('rollback')
     return reply.code(422).send({
      message:'Vendor Business must be active before provisioning.',
      code:'VENDOR_BUSINESS_INACTIVE'
     })
    }

    if(license.status!=='active'){
     await client.query('rollback')
     return reply.code(422).send({
      message:'License must be active before provisioning.',
      code:'LICENSE_INACTIVE'
     })
    }

    if(
     license.expires_at &&
     new Date(license.expires_at).getTime()<=Date.now()
    ){
     await client.query('rollback')
     return reply.code(422).send({
      message:'Expired licenses cannot issue provisioning credentials.',
      code:'LICENSE_EXPIRED'
     })
    }

    if(
     license.expires_at &&
     requestedExpiry.getTime()>new Date(license.expires_at).getTime()
    ){
     await client.query('rollback')
     return reply.code(422).send({
      message:'Provisioning credential cannot outlive the license.',
      code:'PROVISIONING_OUTLIVES_LICENSE'
     })
    }

    if(license.runtime_business_id){
     await client.query('rollback')
     return reply.code(409).send({
      message:'This Vendor Business is already provisioned.',
      code:'VENDOR_BUSINESS_ALREADY_PROVISIONED'
     })
    }

    /*
     * Replacement semantics:
     * only one live, unused credential per license.
     * Old unused credentials are revoked atomically.
     */
    await client.query(`
     update license_provisioning_keys
     set
      revoked_at=now(),
      updated_at=now()
     where license_id=$1
      and consumed_at is null
      and revoked_at is null
    `,[license.id])

    const provisioningKey=
     'prov_'+crypto.randomBytes(32).toString('base64url')

    const row=(await client.query(`
     insert into license_provisioning_keys(
      license_id,
      key_hash,
      key_hint,
      channel,
      expires_at,
      notes
     )
     values($1,$2,$3,$4,$5,$6)
     returning
      id,
      license_id,
      key_hint,
      channel,
      expires_at,
      consumed_at,
      consumed_business_id,
      revoked_at,
      notes,
      created_at,
      updated_at
    `,[
     license.id,
     licenseKeyHash(provisioningKey),
     provisioningKey.slice(-8),
     input.channel,
     input.expires_at,
     input.notes??null
    ])).rows[0]

    await client.query(
     "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','provisioning_key.issue','provisioning_key',$1,$2)",
     [
      row.id,
      'Provisioning credential issued for Vendor Business '+license.vendor_business_name
     ]
    )

    await client.query('commit')

    /*
     * Plaintext key is returned exactly once.
     * key_hash is deliberately not returned.
     */
    return reply.code(201).send({
     data:{
      ...row,
      vendor_business_id:license.vendor_business_id,
      vendor_business_name:license.vendor_business_name,
      customer_name:license.customer_name,
      business_type:license.business_type,
      plan_code:license.plan_code,
      provisioning_key:provisioningKey
     }
    })
   }catch(error){
    await client.query('rollback')
    throw error
   }finally{
    client.release()
   }
  })

  app.post('/api/vendor/provisioning-keys/:id/revoke',{preHandler:vendorInternalRecovery},async(request,reply)=>{
   const keyId=z.string().uuid().parse((request.params as any).id)
   const client=await pool.connect()

   try{
    await client.query('begin')

    const current=(await client.query(
     'select * from license_provisioning_keys where id=$1 for update',
     [keyId]
    )).rows[0]

    if(!current){
     await client.query('rollback')
     return reply.code(404).send({
      message:'Provisioning credential not found.',
      code:'PROVISIONING_KEY_NOT_FOUND'
     })
    }

    if(current.consumed_at){
     await client.query('rollback')
     return reply.code(409).send({
      message:'Consumed provisioning credentials cannot be revoked.',
      code:'PROVISIONING_KEY_ALREADY_CONSUMED'
     })
    }

    const row=(await client.query(`
     update license_provisioning_keys
     set
      revoked_at=coalesce(revoked_at,now()),
      updated_at=now()
     where id=$1
     returning
      id,
      license_id,
      key_hint,
      channel,
      expires_at,
      consumed_at,
      consumed_business_id,
      revoked_at,
      notes,
      created_at,
      updated_at
    `,[keyId])).rows[0]

    await client.query(
     "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','provisioning_key.revoke','provisioning_key',$1,'Provisioning credential revoked')",
     [keyId]
    )

    await client.query('commit')

    return{data:row}
   }catch(error){
    await client.query('rollback')
    throw error
   }finally{
    client.release()
   }
  })

    app.get('/api/vendor/activation-codes',{preHandler:vendor},async()=>({
      data:(await pool.query(`
        select
          c.id,c.license_id,c.key_hint,c.channel,c.expires_at,c.consumed_at,
          c.consumed_device_id,c.revoked_at,c.notes,c.created_at,c.updated_at,
          l.status license_status,l.expires_at license_expires_at,
          vb.name vendor_business_name,vb.status vendor_business_status,
          lc.name customer_name,
          case
            when c.consumed_at is not null then 'consumed'
            when c.revoked_at is not null then 'revoked'
            when c.expires_at<=now() then 'expired'
            else 'available'
          end activation_status
        from license_activation_codes c
        join licenses l on l.id=c.license_id
        join vendor_businesses vb on vb.id=l.vendor_business_id
        join license_customers lc on lc.id=l.customer_id
        order by c.created_at desc
        limit 500
      `)).rows
    }));

    app.post('/api/vendor/activation-codes',{preHandler:vendor},async(request,reply)=>{
      const input=z.object({
        license_id:z.string().uuid(),
        channel:z.literal('desktop').default('desktop'),
        ttl_hours:z.number().int().min(1).max(168).default(24),
        notes:z.string().max(1000).nullable().optional()
      }).strict().parse(request.body);
      const client=await pool.connect();
      try{
        await client.query('begin');
        const license=(await client.query(
          `select l.*,vb.name vendor_business_name,vb.status vendor_business_status,
                  c.name customer_name,t.status tenant_status,
                  recipe.last_error_code provisioning_error_code,
                  (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id
           from licenses l
           join vendor_businesses vb on vb.id=l.vendor_business_id
           join license_customers c on c.id=l.customer_id
           left join saas_tenants t on t.vendor_business_id=vb.id
           left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id
           where l.id=$1
           for update of l,vb`,
          [input.license_id]
        )).rows[0];
        if(!license){
          await client.query('rollback');
          return reply.code(404).send({message:'License not found.'});
        }
        if(license.vendor_business_status!=='active')
          throw Object.assign(new Error('Vendor Business is not active.'),{statusCode:403,code:'VENDOR_BUSINESS_INACTIVE'});
        if(license.status!=='active')
          throw Object.assign(new Error('License is not active.'),{statusCode:403,code:'LICENSE_INACTIVE'});
        if(license.expires_at&&Date.parse(license.expires_at)<=Date.now())
          throw Object.assign(new Error('Expired licenses cannot issue activation codes.'),{statusCode:410,code:'LICENSE_EXPIRED'});
        const lifecycle=commercialLifecycle({
          vendor_business_status:license.vendor_business_status,
          license_id:license.id,
          license_status:license.status,
          license_expires_at:license.expires_at,
          max_devices:license.max_devices,
          max_desktop_devices:license.max_desktop_devices,
          max_web_devices:license.max_web_devices,
          max_mobile_devices:license.max_mobile_devices,
          tenant_status:license.tenant_status,
          runtime_business_id:license.runtime_business_id,
          provisioning_error_code:license.provisioning_error_code
        },config.SAAS_TENANCY_MODE);
        if(lifecycle.state!=='READY_FOR_ACTIVATION')
          throw Object.assign(new Error('Business provisioning is not complete.'),{statusCode:409,code:'BUSINESS_NOT_READY_FOR_ACTIVATION'});

        const issued=await issueActivationCode({
          client,
          licenseId:license.id,
          channel:input.channel,
          licenseExpiresAt:license.expires_at,
          ttlHours:input.ttl_hours,
          notes:input.notes??null
        });
        await client.query(
          "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','activation_code.issue','activation_code',$1,$2)",
          [issued.row.id,`${input.channel} activation code issued for ${license.vendor_business_name}`]
        );
        await client.query('commit');
        return reply.code(201).send({data:{
          ...issued.row,
          activation_code:issued.plaintext,
          vendor_business_name:license.vendor_business_name,
          customer_name:license.customer_name
        }});
      }catch(error){
        await client.query('rollback');
        throw error;
      }finally{
        client.release();
      }
    });

    app.post('/api/vendor/activation-codes/:id/revoke',{preHandler:vendor},async(request,reply)=>{
      const codeId=z.string().uuid().parse((request.params as any).id);
      const client=await pool.connect();
      try{
        await client.query('begin');
        const code=(await client.query('select * from license_activation_codes where id=$1 for update',[codeId])).rows[0];
        if(!code){
          await client.query('rollback');
          return reply.code(404).send({message:'Activation code not found.'});
        }
        if(code.consumed_at){
          await client.query('rollback');
          return reply.code(409).send({message:'Consumed activation codes cannot be revoked.',code:'ACTIVATION_CODE_ALREADY_CONSUMED'});
        }
        const row=(await client.query(
          'update license_activation_codes set revoked_at=coalesce(revoked_at,now()),updated_at=now() where id=$1 returning *',
          [codeId]
        )).rows[0];
        await client.query(
          "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','activation_code.revoke','activation_code',$1,'Activation code revoked')",
          [codeId]
        );
        await client.query('commit');
        return {data:row};
      }catch(error){
        await client.query('rollback');
        throw error;
      }finally{
        client.release();
      }
    });

    app.post('/api/vendor/licenses/:id/activation-code/regenerate',{preHandler:vendor},async(request,reply)=>{
      const licenseId=z.string().uuid().parse((request.params as any).id);
      const input=z.object({
        channel:z.literal('desktop').default('desktop'),
        ttl_hours:z.number().int().min(1).max(168).default(24),
        notes:z.string().max(1000).nullable().optional()
      }).strict().parse(request.body);
      const client=await pool.connect();
      try{
        await client.query('begin');
        const license=(await client.query(
          `select l.*,vb.name vendor_business_name,vb.status vendor_business_status,
                  c.name customer_name,t.status tenant_status,
                  recipe.last_error_code provisioning_error_code,
                  (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id
           from licenses l
           join vendor_businesses vb on vb.id=l.vendor_business_id
           join license_customers c on c.id=l.customer_id
           left join saas_tenants t on t.vendor_business_id=vb.id
           left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id
           where l.id=$1
           for update of l,vb`,
          [licenseId]
        )).rows[0];
        if(!license){
          await client.query('rollback');
          return reply.code(404).send({message:'License not found.',code:'LICENSE_NOT_FOUND'});
        }
        if(license.vendor_business_status!=='active')
          throw Object.assign(new Error('Vendor Business is not active.'),{statusCode:403,code:'VENDOR_BUSINESS_INACTIVE'});
        if(license.status!=='active')
          throw Object.assign(new Error('License is disabled.'),{statusCode:403,code:'LICENSE_DISABLED'});
        if(license.expires_at&&Date.parse(license.expires_at)<=Date.now())
          throw Object.assign(new Error('Expired licenses cannot issue activation codes.'),{statusCode:410,code:'LICENSE_EXPIRED'});
        const lifecycle=commercialLifecycle({
          ...license,
          license_id:license.id,
          license_status:license.status,
          license_expires_at:license.expires_at
        },config.SAAS_TENANCY_MODE);
        if(lifecycle.state!=='READY_FOR_ACTIVATION')
          throw Object.assign(new Error('Business provisioning is not complete.'),{statusCode:409,code:'BUSINESS_NOT_READY_FOR_ACTIVATION'});

        await client.query(
          `update license_activation_codes
           set revoked_at=now(),updated_at=now()
           where license_id=$1 and channel=$2
             and consumed_at is null and revoked_at is null and expires_at>now()`,
          [licenseId,input.channel]
        );
        const issued=await issueActivationCode({
          client,
          licenseId,
          channel:input.channel,
          licenseExpiresAt:license.expires_at,
          ttlHours:input.ttl_hours,
          notes:input.notes??'Regenerated from Vendor Console'
        });
        await client.query(
          "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','activation_code.regenerate','activation_code',$1,$2)",
          [issued.row.id,`Unused Desktop activation codes replaced for ${license.vendor_business_name}`]
        );
        await client.query('commit');
        return reply.code(201).send({data:{
          ...issued.row,
          activation_code:issued.plaintext,
          vendor_business_name:license.vendor_business_name,
          customer_name:license.customer_name
        }});
      }catch(error){
        await client.query('rollback');
        throw error;
      }finally{
        client.release();
      }
    });

    app.get('/api/vendor/licenses',{preHandler:vendor},async()=>{
        const rows=(await pool.query(
            `select l.*,c.name customer_name,vb.name vendor_business_name,vb.status vendor_business_status,p.name plan_name,p.code plan_code,
              (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active') active_devices,
              (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active' and d.channel='desktop') active_desktop_devices,
              (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active' and d.channel='web') active_web_devices,
              (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active' and d.channel='mobile') active_mobile_devices,
              (select b.id from businesses b where b.vendor_business_id=l.vendor_business_id limit 1) runtime_business_id,
              t.status tenant_status,recipe.last_error_code provisioning_error_code
             from licenses l
             left join vendor_businesses vb on vb.id=l.vendor_business_id
             left join license_customers c on c.id=l.customer_id
             left join license_plans p on p.id=l.plan_id
             left join saas_tenants t on t.vendor_business_id=l.vendor_business_id
             left join vendor_business_provisioning recipe on recipe.vendor_business_id=l.vendor_business_id
             order by l.created_at desc`
        )).rows;
        return {data:rows.map(row=>{
            const lifecycle=commercialLifecycle({...row,license_id:row.id,license_status:row.status,license_expires_at:row.expires_at},config.SAAS_TENANCY_MODE);
            return {...publicLicense(row),lifecycle_state:lifecycle.state,readiness_reason:lifecycle.reason};
        })};
    });

    app.post('/api/vendor/licenses',{preHandler:vendor},async(request,reply)=>{
        const input=z.object({
            vendor_business_id:z.string().uuid(),
            plan_id:z.string().uuid(),
            allowed_features:features,
            max_devices:z.number().int().positive(),
            max_desktop_devices:z.number().int().min(0).nullable().optional(),
            max_web_devices:z.number().int().min(0).nullable().optional(),
            max_mobile_devices:z.number().int().min(0).nullable().optional(),
            expires_at:z.string().datetime().nullable().optional(),
            offline_validity_days:z.number().int().positive().nullable().optional(),
            notes:z.string().max(1000).nullable().optional()
        }).parse(request.body);

        const requestedExpiry=input.expires_at===null?null:input.expires_at?new Date(input.expires_at):(()=>{const value=new Date();value.setUTCFullYear(value.getUTCFullYear()+1);return value})()
        if(requestedExpiry&&(!Number.isFinite(requestedExpiry.getTime())||requestedExpiry.getTime()<=Date.now()))
            return reply.code(422).send({message:'License expiration must be in the future.',code:'LICENSE_EXPIRY_INVALID'});

        const client=await pool.connect();

        try{
            await client.query('begin');

            const business=(await client.query(
                `select vb.*,c.name customer_name,t.status tenant_status,
                   (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id
                 from vendor_businesses vb
                 join license_customers c on c.id=vb.customer_id
                 left join saas_tenants t on t.vendor_business_id=vb.id
                 where vb.id=$1 for update of vb`,
                [input.vendor_business_id]
            )).rows[0];

            if(!business)
                throw Object.assign(
                    new Error('Vendor Business not found.'),
                    {statusCode:404}
                );

            if(business.status!=='active')
                throw Object.assign(
                    new Error(
                        'Vendor Business must be active before a licence can be created.'
                    ),
                    {
                        statusCode:422,
                        code:'VENDOR_BUSINESS_INACTIVE'
                    }
                );

            const existingLicense=(await client.query(
                'select id from licenses where vendor_business_id=$1 limit 1 for update',
                [business.id]
            )).rows[0];
            if(existingLicense)
                throw Object.assign(
                    new Error('A commercial licence is already assigned to this business.'),
                    {statusCode:409,code:'COMMERCIAL_LICENSE_ALREADY_ASSIGNED'}
                );

            if(
                (config.SAAS_TENANCY_MODE==='database_per_tenant'&&
                  (business.tenant_status!=='active'||!business.runtime_business_id))||
                (config.SAAS_TENANCY_MODE!=='database_per_tenant'&&!business.runtime_business_id)
            )
                throw Object.assign(
                    new Error('Business provisioning must finish before a commercial licence is assigned.'),
                    {statusCode:409,code:'BUSINESS_NOT_READY_FOR_ACTIVATION'}
                );

            const plan=(await client.query(
                'select * from license_plans where id=$1 and active=true',
                [input.plan_id]
            )).rows[0];

            if(!plan)
                throw Object.assign(
                    new Error('Active plan not found.'),
                    {statusCode:422}
                );

            const planFeatures=
                Array.isArray(plan.features)
                    ?plan.features
                    :[];

            const invalid=
                input.allowed_features.filter(
                    feature=>!planFeatures.includes(feature)
                );

            if(invalid.length)
                throw Object.assign(
                    new Error(
                        'Licence modules must be included in the selected plan.'
                    ),
                    {
                        statusCode:422,
                        code:'LICENSE_FEATURE_OUTSIDE_PLAN',
                        features:invalid
                    }
                );

            const key=
                crypto.randomBytes(32).toString('base64url');

            const row=(await client.query(
                `insert into licenses(
                  customer_id,vendor_business_id,plan_id,key_hash,status,business_type,allowed_features,
                  max_devices,max_desktop_devices,max_web_devices,max_mobile_devices,
                  expires_at,offline_validity_days,notes
                 ) values($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
                [
                    business.customer_id,
                    business.id,
                    input.plan_id,
                    licenseKeyHash(key),
                    business.business_type,
                    JSON.stringify(input.allowed_features),
                    input.max_devices,
                    input.max_desktop_devices===undefined?plan.default_desktop_device_limit:input.max_desktop_devices,
                    input.max_web_devices===undefined?plan.default_web_device_limit:input.max_web_devices,
                    input.max_mobile_devices===undefined?plan.default_mobile_device_limit:input.max_mobile_devices,
                    requestedExpiry?.toISOString()??null,
                    input.offline_validity_days===undefined?plan.offline_validity_days:input.offline_validity_days,
                    input.notes??null
                ]
            )).rows[0];

            await client.query(
                "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','license.create','license',$1,$2)",
                [
                    row.id,
                    'Licence created for Vendor Business '+business.name
                ]
            );
            await client.query('commit');

            return reply.code(201).send({
                data:{
                    ...publicLicense(row),
                    customer_name:business.customer_name,
                    vendor_business_name:business.name,
                    plan_name:plan.name,
                    plan_code:plan.code
                }
            });
        }
        catch(error){
            await client.query('rollback');
            throw error;
        }
        finally{
            client.release();
        }
    });
    app.put('/api/vendor/licenses/:id/device-limits',{preHandler:vendor},async(request,reply)=>{
     const licenseId=z.string().uuid().parse((request.params as any).id)
     const input=z.object({
      max_devices:z.number().int().positive(),
      max_desktop_devices:z.number().int().min(0).nullable(),
      max_web_devices:z.number().int().min(0).nullable(),
      max_mobile_devices:z.number().int().min(0).nullable()
     }).strict().parse(request.body)
     const client=await pool.connect()
     try{
      await client.query('begin')
      const license=(await client.query('select * from licenses where id=$1 for update',[licenseId])).rows[0]
      if(!license){await client.query('rollback');return reply.code(404).send({message:'License not found.'})}
      const counts=(await client.query(`select
       count(*) filter(where status='active')::int total,
       count(*) filter(where status='active' and channel='desktop')::int desktop,
       count(*) filter(where status='active' and channel='web')::int web,
       count(*) filter(where status='active' and channel='mobile')::int mobile
       from license_devices where license_id=$1`,[licenseId])).rows[0]
      const below=(limit:number|null,used:number)=>limit!==null&&limit<used
      if(input.max_devices<Number(counts.total)||below(input.max_desktop_devices,Number(counts.desktop))||below(input.max_web_devices,Number(counts.web))||below(input.max_mobile_devices,Number(counts.mobile)))
       return reply.code(409).send({message:'Revoke devices before lowering a limit below current usage.',code:'LICENSE_DEVICE_LIMIT_BELOW_USAGE',active_devices:counts})
      const row=(await client.query(`update licenses set max_devices=$2,max_desktop_devices=$3,max_web_devices=$4,max_mobile_devices=$5,updated_at=now() where id=$1 returning *`,[licenseId,input.max_devices,input.max_desktop_devices,input.max_web_devices,input.max_mobile_devices])).rows[0]
      await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','license.device_limits.update','license',$1,$2)",[licenseId,`Device limits updated: total=${input.max_devices}, desktop=${input.max_desktop_devices??'unlimited'}, web=${input.max_web_devices??'unlimited'}, mobile=${input.max_mobile_devices??'unlimited'}`])
      await client.query('commit')
      return{data:{...publicLicense(row),active_devices:counts}}
     }catch(error){await client.query('rollback');throw error}finally{client.release()}
    })
    app.get('/api/vendor/devices',{preHandler:vendor},async()=>({data:(await pool.query(`
     select d.*,c.name customer_name,vb.name vendor_business_name,
       l.max_devices,l.max_desktop_devices,l.max_web_devices,l.max_mobile_devices,
       (select count(*)::int from license_devices active where active.license_id=l.id and active.status='active') active_devices,
       (select count(*)::int from license_devices active where active.license_id=l.id and active.status='active' and active.channel='desktop') active_desktop_devices,
       (select count(*)::int from license_devices active where active.license_id=l.id and active.status='active' and active.channel='web') active_web_devices,
       (select count(*)::int from license_devices active where active.license_id=l.id and active.status='active' and active.channel='mobile') active_mobile_devices
     from license_devices d
     join licenses l on l.id=d.license_id
     join vendor_businesses vb on vb.id=l.vendor_business_id
     left join license_customers c on c.id=l.customer_id
     order by coalesce(d.last_seen_at,d.activated_at) desc
    `)).rows}));
    app.post('/api/vendor/devices/:id/revoke', { preHandler: vendor }, async (request, reply) => { const deviceId = z.string().uuid().parse((request.params as any).id), client = await pool.connect(); try {
        await client.query('begin');
        const row = (await client.query("update license_devices set status='revoked',revoked_at=coalesce(revoked_at,now()) where id=$1 returning id,status", [deviceId])).rows[0];
        if (!row) {
            await client.query('rollback');
            return reply.code(404).send({ message: 'Device not found.' });
        }
        await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','device.revoke','device',$1,'Device slot revoked')", [deviceId]);
        await client.query('commit');
        return { data: row };
    }
    catch (error) {
        await client.query('rollback');
        throw error;
    }
    finally {
        client.release();
    } });
    app.post('/api/vendor/offline-activations/candidates', {preHandler:vendor}, async(request,reply)=>{
      const req=offlineRequestSchema.parse(request.body);
      if(!activationRequestIsFresh(req.requested_at,offlineActivationWindowMs()))
        return reply.code(422).send({message:'Offline request has expired.',code:'ACTIVATION_REQUEST_STALE'});
      if(!verifyOfflineDeviceProof(req.device_public_key,offlineProofPayload(req),req.device_proof))
        return reply.code(403).send({message:'Offline request proof is invalid.',code:'DEVICE_PROOF_INVALID'});
      const rows=await pool.query(`select l.id,l.business_type,l.offline_validity_days,l.max_devices,l.max_desktop_devices,c.name customer_name,vb.name vendor_business_name,
        vb.status vendor_business_status,l.id license_id,l.status license_status,l.expires_at license_expires_at,
        l.max_web_devices,l.max_mobile_devices,t.status tenant_status,recipe.last_error_code provisioning_error_code,
        (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id,
        (select count(*)::int from license_devices d where d.license_id=l.id and d.status='active') active_devices
        from licenses l join vendor_businesses vb on vb.id=l.vendor_business_id
        join license_customers c on c.id=l.customer_id
        left join saas_tenants t on t.vendor_business_id=vb.id
        left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id
        where l.status='active' and vb.status='active' and (l.expires_at is null or l.expires_at>now())
        and ($1::text is null or l.business_type=$1)
        and (l.max_desktop_devices is null or l.max_desktop_devices>0)
        and (
          exists(select 1 from license_devices d where d.license_id=l.id and d.installation_id=$2 and d.device_fingerprint=$3 and d.channel='desktop' and d.status='active')
          or (
            not exists(select 1 from license_devices d where d.license_id=l.id and d.installation_id=$2)
            and (select count(*) from license_devices d where d.license_id=l.id and d.status='active')<l.max_devices
            and (l.max_desktop_devices is null or (select count(*) from license_devices d where d.license_id=l.id and d.status='active' and d.channel='desktop')<l.max_desktop_devices)
          )
        ) order by c.name,vb.name`,[req.version===1?req.business_type:null,req.installation_id,fingerprint(req.device_public_key)]);
      return {data:rows.rows
        .filter(row=>commercialLifecycle(row,config.SAAS_TENANCY_MODE).state==='READY_FOR_ACTIVATION')
        .map(({vendor_business_status:_businessStatus,license_id:_licenseId,license_status:_licenseStatus,license_expires_at:_licenseExpiry,max_web_devices:_web,max_mobile_devices:_mobile,tenant_status:_tenant,provisioning_error_code:_provisioning,runtime_business_id:_runtime,...safe})=>safe)};
    });
    app.post('/api/vendor/offline-activations/issue', { preHandler: vendor }, async (request, reply) => {
        const input = z.object({
            license_id: z.string().uuid(),
            request: offlineRequestSchema
        }).parse(request.body);
        const req = input.request;
        if (!activationRequestIsFresh(req.requested_at, offlineActivationWindowMs()))
            return reply.code(422).send({ message: 'Offline activation request timestamp is outside the allowed window.', code: 'ACTIVATION_REQUEST_STALE' });
        if (!verifyOfflineDeviceProof(req.device_public_key, offlineProofPayload(req), req.device_proof)) {
            return reply.code(403).send({
                message: 'Offline activation request proof is invalid.',
                code: 'DEVICE_PROOF_INVALID'
            });
        }
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query("select l.*,p.code plan_code,vb.status vendor_business_status from licenses l join vendor_businesses vb on vb.id=l.vendor_business_id left join license_plans p on p.id=l.plan_id where l.id=$1 for update of l,vb", [input.license_id])).rows[0];
            if (!license)
                throw Object.assign(new Error('License not found.'), { statusCode: 404, code: 'LICENSE_NOT_FOUND' });
            if (license.vendor_business_status !== 'active')
                throw Object.assign(new Error('Vendor Business is not active.'), { statusCode: 403, code: 'VENDOR_BUSINESS_INACTIVE' });
            if (license.status !== 'active')
                throw Object.assign(new Error('License is not active.'), { statusCode: 403, code: license.status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INACTIVE' });
            if (license.expires_at && Date.parse(license.expires_at) <= Date.now())
                throw Object.assign(new Error('License has expired.'), { statusCode: 403, code: 'LICENSE_EXPIRED' });
            if (req.version === 1 && license.business_type !== req.business_type)
                throw Object.assign(new Error('License is not compatible with the requested business type.'), { statusCode: 422, code: 'LICENSE_BUSINESS_TYPE_MISMATCH' });
            if (license.max_desktop_devices === 0)
                throw Object.assign(new Error('Desktop activation is not permitted by this license.'), { statusCode: 403, code: 'DESKTOP_CHANNEL_DISABLED' });
            await requireActivationReady(client, license.id);
            const replay = (await client.query('select 1 from license_activations where license_id=$1 and request_nonce=$2 limit 1', [license.id, req.nonce])).rows[0];
            if (replay)
                throw Object.assign(new Error('This offline activation request was already used.'), { statusCode: 409, code: 'ACTIVATION_REPLAY' });
            const requestedFingerprint = fingerprint(req.device_public_key);
            let device = (await client.query('select * from license_devices where license_id=$1 and installation_id=$2', [license.id, req.installation_id])).rows[0];
            if (device && device.status !== 'active')
                throw Object.assign(new Error('This device has been revoked.'), { statusCode: 403, code: 'DEVICE_REVOKED' });
            if (device && device.device_fingerprint !== requestedFingerprint)
                throw Object.assign(new Error('Device identity mismatch.'), { statusCode: 403, code: 'DEVICE_IDENTITY_MISMATCH' });
            if (device && device.channel !== 'desktop')
                throw Object.assign(new Error('Device channel mismatch.'), { statusCode: 409, code: 'DEVICE_CHANNEL_MISMATCH' });
            if (!device) {
                await assertDeviceSlotAvailable(client, license, 'desktop');
                device = (await client.query("insert into license_devices(license_id,installation_id,device_public_key,device_fingerprint,device_name,app_version,channel,platform,last_validated_at,last_seen_at) values($1,$2,$3,$4,$5,$6,'desktop','windows',now(),now()) returning *", [
                    license.id,
                    req.installation_id,
                    req.device_public_key,
                    requestedFingerprint,
                    req.device_name,
                    req.app_version
                ])).rows[0];
            }
            else {
                device = (await client.query('update license_devices set device_name=$1,app_version=$2,last_validated_at=now(),last_seen_at=now() where id=$3 returning *', [req.device_name, req.app_version, device.id])).rows[0];
            }
            const signed = await issue(license, device, null);
            await client.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'offline','approved',$4)", [
                license.id,
                device.id,
                signed.certificate.certificate_id,
                req.nonce
            ]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','offline_activation.issue','device',$1,$2)", [
                device.id,
                `Offline certificate ${signed.certificate.certificate_id} issued`
            ]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','offline_activation.issue','vendor_business',$1,$2)", [
                license.vendor_business_id,
                `Offline licence issued for device ${device.device_name ?? device.installation_id}`
            ]);
            await client.query('commit');
            return reply.code(201).send({ data: signed });
        }
        catch (error) {
            await client.query('rollback');
            if (replayError(error))
                return reply.code(409).send({ message: 'This offline activation request was already used.', code: 'ACTIVATION_REPLAY' });
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.get('/api/vendor/businesses/:id/offline-activations',{preHandler:vendor},async(request)=>{
      const businessId=z.string().uuid().parse((request.params as any).id)
      return {data:(await pool.query(`
        select a.id,a.created_at,a.status,a.certificate_id,d.device_name,d.platform,d.installation_id
        from license_activations a
        join licenses l on l.id=a.license_id
        left join license_devices d on d.id=a.device_id
        where l.vendor_business_id=$1 and a.kind='offline'
        order by a.created_at desc limit 100
      `,[businessId])).rows}
    });
    app.get('/api/vendor/dashboard', { preHandler: vendor }, async () => {
        const [businesses, licenses, devices, activations] = await Promise.all([
            pool.query(`select
              vb.status vendor_business_status,
              l.id license_id,l.status license_status,l.expires_at license_expires_at,
              l.max_devices,l.max_desktop_devices,l.max_web_devices,l.max_mobile_devices,
              t.status tenant_status,recipe.last_error_code provisioning_error_code,
              runtime.id runtime_business_id
             from vendor_businesses vb
             left join lateral (select id,status,expires_at,max_devices,max_desktop_devices,max_web_devices,max_mobile_devices from licenses where vendor_business_id=vb.id order by issued_at desc,created_at desc limit 1) l on true
             left join lateral (select id from businesses where vendor_business_id=vb.id limit 1) runtime on true
             left join saas_tenants t on t.vendor_business_id=vb.id
             left join vendor_business_provisioning recipe on recipe.vendor_business_id=vb.id`),
            pool.query("select count(*)::int total,count(*) filter (where status='active')::int active,count(*) filter (where status='suspended')::int suspended,count(*) filter (where status='revoked')::int revoked from licenses"),
            pool.query("select count(*)::int total,count(*) filter (where status='active')::int active,count(*) filter (where status='revoked')::int revoked from license_devices"),
            pool.query("select count(*)::int total,count(*) filter (where created_at>=now()-interval '30 days')::int last_30_days from license_activations")
        ]);
        const lifecycleRows=businesses.rows.map(row=>commercialLifecycle(row,config.SAAS_TENANCY_MODE));
        return { data: {
                businesses: {
                  count: lifecycleRows.length,
                  ready: lifecycleRows.filter(item=>item.state==='READY_FOR_ACTIVATION').length,
                  attention: lifecycleRows.filter(item=>item.state==='PROVISIONING_FAILED'||item.state==='BLOCKED').length,
                },
                licenses: licenses.rows[0],
                devices: devices.rows[0],
                activations: activations.rows[0]
            } };
    });
    app.get('/api/vendor/activations', { preHandler: vendor }, async () => ({
        data: (await pool.query('select a.*,l.status license_status,l.business_type,c.name customer_name,d.device_name,d.installation_id,d.status device_status ' +
            'from license_activations a ' +
            'join licenses l on l.id=a.license_id ' +
            'left join license_customers c on c.id=l.customer_id ' +
            'left join license_devices d on d.id=a.device_id ' +
            'order by a.created_at desc limit 500')).rows
    }));
    app.get('/api/vendor/audit', { preHandler: vendor }, async () => ({
        data: (await pool.query('select * from license_audit_logs order by created_at desc limit 1000')).rows
    }));
    const changeLicenseStatus=async(request:FastifyRequest,status:'active'|'suspended'|'revoked')=>{
        const licenseId = z.string().uuid().parse((request.params as any).id);
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query('select * from licenses where id=$1 for update', [licenseId])).rows[0];
            if (!license)
                throw Object.assign(new Error('License not found.'), { statusCode: 404 });
            if(status==='active'&&license.status==='revoked'){
                await client.query('rollback');
                throw Object.assign(new Error('A revoked license cannot be reactivated.'),{statusCode:409,code:'LICENSE_REVOKED'});
            }
            await client.query('update licenses set status=$2,updated_at=now() where id=$1', [licenseId, status]);
            await client.query('update business_licenses set status=$2,updated_at=now() where license_id=$1', [licenseId, status]);
            if (status === 'revoked') {
                await client.query("update license_devices set status='revoked',revoked_at=coalesce(revoked_at,now()) where license_id=$1 and status='active'", [licenseId]);
            }
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor',$1,'license',$2,$3)", [
                'license.' + status,
                licenseId,
                'License status changed to ' + status
            ]);
            await client.query('commit');
            return { data: { id: licenseId, status } };
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    };
    app.post('/api/vendor/licenses/:id/suspend', { preHandler: vendor }, async (request) => changeLicenseStatus(request, 'suspended'));
    app.post('/api/vendor/licenses/:id/reactivate', { preHandler: vendor }, async (request) => changeLicenseStatus(request, 'active'));
    app.post('/api/vendor/licenses/:id/revoke', { preHandler: vendor }, async (request) => changeLicenseStatus(request, 'revoked'));
    app.post('/api/vendor/licenses/:id/renew', { preHandler: vendor }, async (request, reply) => {
        const licenseId = z.string().uuid().parse((request.params as any).id);
        const input = z.object({
            expires_at: z.string().datetime().nullable().optional(),
            offline_validity_days: z.number().int().positive().nullable().optional()
        }).parse(request.body);
        const renewalExpiry=input.expires_at===null?null:input.expires_at?new Date(input.expires_at):(()=>{const value=new Date();value.setUTCFullYear(value.getUTCFullYear()+1);return value})()
        if(renewalExpiry&&(!Number.isFinite(renewalExpiry.getTime())||renewalExpiry.getTime()<=Date.now()))
            return reply.code(422).send({message:'Renewal expiration must be in the future.',code:'LICENSE_EXPIRY_INVALID'});
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query('select * from licenses where id=$1 for update', [licenseId])).rows[0];
            if (!license)
                throw Object.assign(new Error('License not found.'), { statusCode: 404 });
            const offlineValidityDays=input.offline_validity_days===undefined?license.offline_validity_days:input.offline_validity_days;
            const updated = (await client.query("update licenses set expires_at=$2,offline_validity_days=$3,status='active',updated_at=now() where id=$1 returning *", [licenseId, renewalExpiry?.toISOString()??null, offlineValidityDays])).rows[0];
            await client.query("update business_licenses set status='active',updated_at=now() where license_id=$1", [licenseId]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','license.renew','license',$1,$2)", [
                licenseId,
                `License updated: expiration=${renewalExpiry?.toISOString()??'lifetime'}, offline=${offlineValidityDays??'permanent'}`
            ]);
            await client.query('commit');
            return { data: publicLicense(updated) };
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
