import crypto from'node:crypto'
import type{FastifyInstance,FastifyReply,FastifyRequest}from'fastify'
import type pg from'pg'
import argon2 from'argon2'
import{z}from'zod'
import{businessSetupSchema}from'@bimik/validation'
import{businessTypes,featureKeys}from'@bimik/shared-types'
import{fingerprint,licenseKeyHash,signCertificate,type LicenseCertificate}from'./crypto.js'
import{activationRequestIsFresh}from'./policy.js'

type User={
 id:number
 businessId:number
 branchId:number|null
 role:string
}

type Deps={
 pool:pg.Pool
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
const replayError=(error:any)=>{
    const value = error;
    return value?.code === '23505' && value.constraint === 'license_activations_license_nonce_unique';
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
const offlineProofPayload=(input:any)=>[
    'posreq-v1',
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.business_type,
    input.nonce,
    input.requested_at
].join('\n');
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
export async function registerLicenseRoutes(app:FastifyInstance,{pool,authenticate,resolveUser}:Deps){
    const merchant=async(request:FastifyRequest,reply:FastifyReply)=> { await authenticate(request, reply); if (reply.sent)
        return; const user = await resolveUser(request); if (!user)
        return reply.code(401).send({ message: 'Unauthenticated.' }); (request as any).merchant=user; };
    const vendor=async(request:FastifyRequest,reply:FastifyReply)=> { const configured = process.env.VENDOR_ADMIN_TOKEN; if (!configured || process.env.NODE_ENV === 'production' && configured.length < 32)
        return reply.code(503).send({ message: 'Vendor administration is not configured.' }); const supplied = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''); if (supplied.length !== configured.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured)))
        return reply.code(401).send({ message: 'Vendor authentication required.' }); };
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
    app.addHook('preHandler',async(request,reply)=>{
     if(
      request.method!=='POST' ||
      request.url.split('?')[0]!=='/api/license/activate'
     )
      return

     await authenticate(request,reply)

     if(reply.sent)
      return

     const user=await resolveUser(request)
     const key=(request.body as any)?.license_key

     if(!user||typeof key!=='string')
      return

     const row=(await pool.query(
      `select
        l.id,
        l.business_type,
        l.vendor_business_id,
        b.business_type current_business_type,
        b.vendor_business_id current_vendor_business_id,
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
       cross join businesses b
       where l.key_hash=$1
        and b.id=$2`,
      [
       licenseKeyHash(key),
       user.businessId
      ]
     )).rows[0]

     if(!row)
      return

     if(row.vendor_business_status!=='active')
      return reply.code(403).send({
       message:'Vendor Business is not active.',
       code:'VENDOR_BUSINESS_INACTIVE'
      })

     if(!row.current_vendor_business_id)
      return reply.code(409).send({
       message:
        'This runtime business is not provisioned by the Vendor control plane.',
       code:'BUSINESS_VENDOR_IDENTITY_REQUIRED'
      })

     if(
      row.vendor_business_id!==
      row.current_vendor_business_id
     )
      return reply.code(409).send({
       message:
        'This license belongs to another Vendor Business.',
       code:'LICENSE_VENDOR_BUSINESS_MISMATCH'
      })

     if(
      row.business_type!==
      row.current_business_type
     )
      return reply.code(422).send({
       message:
        'This license is not compatible with the configured business type.',
       code:'LICENSE_BUSINESS_TYPE_MISMATCH'
      })

     if(
      row.bound_business_id &&
      Number(row.bound_business_id)!==user.businessId
     )
      return reply.code(409).send({
       message:
        'This license is already assigned to another business.',
       code:'LICENSE_ALREADY_BOUND'
      })
    })
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

      const row=(await pool.query(
       `select
         case
          when l.status<>'active' then l.status
          when l.expires_at is not null
           and l.expires_at<=now() then 'expired'
          else bl.status
         end status,
         l.expires_at,
         l.allowed_features features,
         p.code plan
        from business_licenses bl
        join licenses l
         on l.id=bl.license_id
        left join license_plans p
         on p.id=l.plan_id
        where bl.business_id=$1`,
       [user.businessId]
      )).rows[0]

      return{
       data:row??{
        status:'activation_required',
        features:[]
       }
      }
     }
    )
    app.post(
     '/api/license/activate',
     {preHandler:merchant},
     async(request,reply)=>{
      const user=(request as any).merchant as User

      if(!['owner','patron'].includes(user.role))
       return reply.code(403).send({
        message:'Only the Patron can activate a license.'
       })

      const input=z.object({
       license_key:z.string().min(20),
       installation_id:z.string().uuid(),
       device_public_key:z.string().min(40).max(5000),
       device_name:z.string().max(200).optional(),
       app_version:z.string().max(50)
      }).parse(request.body)

      const client=await pool.connect()

      try{
       await client.query('begin')

       const license=(await client.query(
        `select
          l.*,
          p.code plan_code,
          vb.status vendor_business_status,
          b.vendor_business_id current_vendor_business_id,
          b.business_type current_business_type,
          (
           select business_id
           from business_licenses
           where license_id=l.id
           limit 1
          ) bound_business_id
         from licenses l
         join vendor_businesses vb
          on vb.id=l.vendor_business_id
         join businesses b
          on b.id=$2
         left join license_plans p
          on p.id=l.plan_id
         where l.key_hash=$1
          and l.status='active'
          and (
           l.expires_at is null
           or l.expires_at>now()
          )
         for update of l,vb,b`,
        [
         licenseKeyHash(input.license_key),
         user.businessId
        ]
       )).rows[0]

       if(!license)
        throw Object.assign(
         new Error(
          'License key is invalid, expired, or inactive.'
         ),
         {statusCode:422}
        )

       if(license.vendor_business_status!=='active')
        throw Object.assign(
         new Error('Vendor Business is not active.'),
         {
          statusCode:403,
          code:'VENDOR_BUSINESS_INACTIVE'
         }
        )

       if(!license.current_vendor_business_id)
        throw Object.assign(
         new Error(
          'This runtime business is not provisioned by the Vendor control plane.'
         ),
         {
          statusCode:409,
          code:'BUSINESS_VENDOR_IDENTITY_REQUIRED'
         }
        )

       if(
        license.vendor_business_id!==
        license.current_vendor_business_id
       )
        throw Object.assign(
         new Error(
          'This license belongs to another Vendor Business.'
         ),
         {
          statusCode:409,
          code:'LICENSE_VENDOR_BUSINESS_MISMATCH'
         }
        )

       if(
        license.business_type!==
        license.current_business_type
       )
        throw Object.assign(
         new Error(
          'This license is not compatible with the configured business type.'
         ),
         {
          statusCode:422,
          code:'LICENSE_BUSINESS_TYPE_MISMATCH'
         }
        )

       if(
        license.bound_business_id &&
        Number(license.bound_business_id)!==
         user.businessId
       )
        throw Object.assign(
         new Error(
          'This license is already assigned to another business.'
         ),
         {
          statusCode:409,
          code:'LICENSE_ALREADY_BOUND'
         }
        )

       let device=(await client.query(
        `select *
         from license_devices
         where license_id=$1
          and installation_id=$2`,
        [
         license.id,
         input.installation_id
        ]
       )).rows[0]

       if(device&&device.status!=='active')
        throw Object.assign(
         new Error('This device has been revoked.'),
         {statusCode:403}
        )

       if(!device){
        const count=Number(
         (await client.query(
          `select count(*) count
           from license_devices
           where license_id=$1
            and status='active'`,
          [license.id]
         )).rows[0].count
        )

        if(count>=license.max_devices)
         throw Object.assign(
          new Error(
           'The license device limit has been reached.'
          ),
          {statusCode:409}
         )

        device=(await client.query(
         `insert into license_devices(
           license_id,
           installation_id,
           device_public_key,
           device_fingerprint,
           device_name,
           app_version
          )
          values($1,$2,$3,$4,$5,$6)
          returning *`,
         [
          license.id,
          input.installation_id,
          input.device_public_key,
          fingerprint(input.device_public_key),
          input.device_name??null,
          input.app_version
         ]
        )).rows[0]
       }
       else if(
        device.device_fingerprint!==
        fingerprint(input.device_public_key)
       )
        throw Object.assign(
         new Error('Device identity mismatch.'),
         {statusCode:403}
        )

       const signed=await issue(
        license,
        device,
        user.businessId
       )

       await client.query(
        `insert into business_licenses(
          business_id,
          license_id,
          certificate_json,
          certificate_signature,
          status
         )
         values($1,$2,$3,$4,'active')
         on conflict(business_id)
         do update set
          license_id=excluded.license_id,
          certificate_json=excluded.certificate_json,
          certificate_signature=
           excluded.certificate_signature,
          status='active',
          updated_at=now()`,
        [
         user.businessId,
         license.id,
         JSON.stringify(signed.certificate),
         signed.signature
        ]
       )

       await client.query(
        `insert into license_activations(
          license_id,
          device_id,
          certificate_id,
          kind,
          status
         )
         values($1,$2,$3,'online','approved')`,
        [
         license.id,
         device.id,
         signed.certificate.certificate_id
        ]
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
    app.post('/api/license/device-activate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const input = z.object({
            license_key: z.string().min(20).max(200),
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
            const license = (await client.query("select l.*,p.code plan_code,vb.status vendor_business_status from licenses l join vendor_businesses vb on vb.id=l.vendor_business_id left join license_plans p on p.id=l.plan_id where l.key_hash=$1 and l.status='active' and (l.expires_at is null or l.expires_at>now()) for update of l,vb", [licenseKeyHash(input.license_key)])).rows[0];
            if (!license)
                throw Object.assign(new Error('License key is invalid, expired, or inactive.'), { statusCode: 422 });
            if (license.vendor_business_status !== 'active')
                throw Object.assign(new Error('Vendor Business is not active.'), { statusCode: 403, code: 'VENDOR_BUSINESS_INACTIVE' });
            const replay = (await client.query('select 1 from license_activations where license_id=$1 and request_nonce=$2 limit 1', [license.id, input.nonce])).rows[0];
            if (replay)
                throw Object.assign(new Error('This activation request was already used.'), { statusCode: 409 });
            const requestedFingerprint = fingerprint(input.device_public_key);
            let device = (await client.query('select * from license_devices where license_id=$1 and installation_id=$2', [license.id, input.installation_id])).rows[0];
            if (device && device.status !== 'active')
                throw Object.assign(new Error('This device has been revoked.'), { statusCode: 403 });
            if (device && device.device_fingerprint !== requestedFingerprint)
                throw Object.assign(new Error('Device identity mismatch.'), { statusCode: 403 });
            if (!device) {
                const count = Number((await client.query("select count(*) count from license_devices where license_id=$1 and status='active'", [license.id])).rows[0].count);
                if (count >= license.max_devices)
                    throw Object.assign(new Error('The license device limit has been reached.'), { statusCode: 409 });
                device = (await client.query('insert into license_devices(license_id,installation_id,device_public_key,device_fingerprint,device_name,app_version,last_validated_at) values($1,$2,$3,$4,$5,$6,now()) returning *', [
                    license.id,
                    input.installation_id,
                    input.device_public_key,
                    requestedFingerprint,
                    input.device_name,
                    input.app_version
                ])).rows[0];
            }
            else {
                device = (await client.query('update license_devices set device_name=$1,app_version=$2,last_validated_at=now() where id=$3 returning *', [
                    input.device_name,
                    input.app_version,
                    device.id
                ])).rows[0];
            }
            const signed = await issue(license, device, null);
            await client.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'desktop_online','approved',$4)", [
                license.id,
                device.id,
                signed.certificate.certificate_id,
                input.nonce
            ]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('device','desktop_activation.approve','device',$1,$2)", [
                device.id,
                `Desktop online certificate ${signed.certificate.certificate_id} issued`
            ]);
            await client.query('commit');
            return reply.code(201).send({ data: signed });
        }
        catch (error) {
            await client.query('rollback');
            if (replayError(error))
                return reply.code(409).send({ message: 'This activation request was already used.', code: 'ACTIVATION_REPLAY' });
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.get('/api/vendor/plans', { preHandler: vendor }, async () => ({ data: (await pool.query('select * from license_plans order by name')).rows }));
    app.post('/api/vendor/plans', { preHandler: vendor }, async (request, reply) => { const input = z.object({ code: z.string().regex(/^[a-z0-9_-]+$/), name: z.string().min(1), features, default_device_limit: z.number().int().positive(), offline_validity_days: z.number().int().positive().nullable().optional() }).parse(request.body); const row = (await pool.query('insert into license_plans(code,name,features,default_device_limit,offline_validity_days) values($1,$2,$3,$4,$5) returning *', [input.code, input.name, JSON.stringify(input.features), input.default_device_limit, input.offline_validity_days ?? null])).rows[0]; await pool.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','plan.create','plan',$1,$2)", [row.id, `Plan ${row.code} created`]); return reply.code(201).send({ data: row }); });
    app.put('/api/vendor/plans/:id', { preHandler: vendor }, async (request, reply) => { const planId = z.string().uuid().parse((request.params as any).id), input = z.object({ name: z.string().min(1), features, default_device_limit: z.number().int().positive(), offline_validity_days: z.number().int().positive().nullable().optional(), active: z.boolean().optional() }).parse(request.body), row = (await pool.query('update license_plans set name=$2,features=$3,default_device_limit=$4,offline_validity_days=$5,active=$6,updated_at=now() where id=$1 returning *', [planId, input.name, JSON.stringify(input.features), input.default_device_limit, input.offline_validity_days ?? null, input.active ?? true])).rows[0]; if (!row)
        return reply.code(404).send({ message: 'Plan not found.' }); await pool.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','plan.update','plan',$1,$2)", [row.id, `Plan ${row.code} updated`]); return { data: row }; });
    app.get('/api/vendor/customers', { preHandler: vendor }, async () => ({ data: (await pool.query('select * from license_customers order by created_at desc')).rows }));
    app.post('/api/vendor/customers', { preHandler: vendor }, async (request, reply) => { const input = z.object({ name: z.string().min(1), email: z.string().email().nullable().optional(), phone: z.string().max(80).nullable().optional(), notes: z.string().max(1000).nullable().optional() }).parse(request.body), row = (await pool.query('insert into license_customers(name,email,phone,notes) values($1,$2,$3,$4) returning *', [input.name, input.email ?? null, input.phone ?? null, input.notes ?? null])).rows[0]; await pool.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','customer.create','customer',$1,$2)", [row.id, `Customer ${row.name} created`]); return reply.code(201).send({ data: row }); });
    app.get('/api/vendor/businesses',{preHandler:vendor},async()=>({
        data:(await pool.query(
            "select vb.*,c.name customer_name,(select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id,(select count(*)::int from licenses l where l.vendor_business_id=vb.id) license_count from vendor_businesses vb join license_customers c on c.id=vb.customer_id order by vb.created_at desc"
        )).rows
    }));

    app.post('/api/vendor/businesses',{preHandler:vendor},async(request,reply)=>{
        const input=z.object({
            customer_id:z.string().uuid(),
            name:z.string().min(1).max(255),
            business_type:businessType,
            status:z.enum(['active','suspended','closed']).optional(),
            notes:z.string().max(1000).nullable().optional()
        }).parse(request.body);

        const customer=(await pool.query(
            'select id from license_customers where id=$1',
            [input.customer_id]
        )).rows[0];

        if(!customer)
            return reply.code(404).send({
                message:'Vendor Client not found.'
            });

        const row=(await pool.query(
            "insert into vendor_businesses(customer_id,name,business_type,status,notes) values($1,$2,$3,$4,$5) returning *",
            [
                input.customer_id,
                input.name,
                input.business_type,
                input.status??'active',
                input.notes??null
            ]
        )).rows[0];

        await pool.query(
            "insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','business.create','vendor_business',$1,$2)",
            [row.id,'Vendor Business '+row.name+' created']
        );

        return reply.code(201).send({data:row});
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
       'LICENSE_INACTIVE'
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

    /*
     * Multi-tenant slug creation:
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

  app.get('/api/vendor/provisioning-keys',{preHandler:vendor},async()=>({
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

  app.post('/api/vendor/provisioning-keys',{preHandler:vendor},async(request,reply)=>{
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

  app.post('/api/vendor/provisioning-keys/:id/revoke',{preHandler:vendor},async(request,reply)=>{
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
    app.get('/api/vendor/licenses',{preHandler:vendor},async()=>({
        data:(await pool.query(
            "select l.*,c.name customer_name,vb.name vendor_business_name,p.name plan_name,p.code plan_code,(select count(*)::int from license_devices d where d.license_id=l.id and d.status='active') active_devices from licenses l left join vendor_businesses vb on vb.id=l.vendor_business_id left join license_customers c on c.id=l.customer_id left join license_plans p on p.id=l.plan_id order by l.created_at desc"
        )).rows
    }));

    app.post('/api/vendor/licenses',{preHandler:vendor},async(request,reply)=>{
        const input=z.object({
            vendor_business_id:z.string().uuid(),
            plan_id:z.string().uuid(),
            allowed_features:features,
            max_devices:z.number().int().positive(),
            expires_at:z.string().datetime().nullable().optional(),
            offline_validity_days:z.number().int().positive().nullable().optional(),
            notes:z.string().max(1000).nullable().optional()
        }).parse(request.body);

        const client=await pool.connect();

        try{
            await client.query('begin');

            const business=(await client.query(
                "select vb.*,c.name customer_name from vendor_businesses vb join license_customers c on c.id=vb.customer_id where vb.id=$1 for update",
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
                "insert into licenses(customer_id,vendor_business_id,plan_id,key_hash,status,business_type,allowed_features,max_devices,expires_at,offline_validity_days,notes) values($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10) returning *",
                [
                    business.customer_id,
                    business.id,
                    input.plan_id,
                    licenseKeyHash(key),
                    business.business_type,
                    JSON.stringify(input.allowed_features),
                    input.max_devices,
                    input.expires_at??null,
                    input.offline_validity_days??null,
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
                    ...row,
                    customer_name:business.customer_name,
                    vendor_business_name:business.name,
                    plan_name:plan.name,
                    plan_code:plan.code,
                    license_key:key
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
    app.get('/api/vendor/devices', { preHandler: vendor }, async () => ({ data: (await pool.query("select d.*,c.name customer_name,l.max_devices,(select count(*)::int from license_devices active where active.license_id=l.id and active.status='active') active_devices from license_devices d join licenses l on l.id=d.license_id left join license_customers c on c.id=l.customer_id order by d.activated_at desc")).rows }));
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
    app.post('/api/vendor/offline-activations/issue', { preHandler: vendor }, async (request, reply) => {
        const input = z.object({
            license_id: z.string().uuid(),
            request: z.object({
                version: z.literal(1),
                installation_id: z.string().uuid(),
                device_public_key: z.string().min(40).max(5000),
                device_name: z.string().min(1).max(200),
                app_version: z.string().min(1).max(100),
                business_type: businessType,
                nonce: z.string().min(16).max(200),
                requested_at: z.string().datetime(),
                device_proof: z.string().min(40).max(500)
            })
        }).parse(request.body);
        const req = input.request;
        if (!verifyOfflineDeviceProof(req.device_public_key, offlineProofPayload(req), req.device_proof)) {
            return reply.code(403).send({
                message: 'Offline activation request proof is invalid.',
                code: 'DEVICE_PROOF_INVALID'
            });
        }
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query("select l.*,p.code plan_code,vb.status vendor_business_status from licenses l join vendor_businesses vb on vb.id=l.vendor_business_id left join license_plans p on p.id=l.plan_id where l.id=$1 and l.status='active' and (l.expires_at is null or l.expires_at>now()) for update of l,vb", [input.license_id])).rows[0];
            if (!license)
                throw Object.assign(new Error('License cannot be issued.'), { statusCode: 422 });
            if (license.vendor_business_status !== 'active')
                throw Object.assign(new Error('Vendor Business is not active.'), { statusCode: 403, code: 'VENDOR_BUSINESS_INACTIVE' });
            if (license.business_type !== req.business_type)
                throw Object.assign(new Error('License is not compatible with the requested business type.'), { statusCode: 422 });
            const replay = (await client.query('select 1 from license_activations where license_id=$1 and request_nonce=$2 limit 1', [license.id, req.nonce])).rows[0];
            if (replay)
                throw Object.assign(new Error('This offline activation request was already used.'), { statusCode: 409 });
            const requestedFingerprint = fingerprint(req.device_public_key);
            let device = (await client.query('select * from license_devices where license_id=$1 and installation_id=$2', [license.id, req.installation_id])).rows[0];
            if (device && device.status !== 'active')
                throw Object.assign(new Error('This device has been revoked.'), { statusCode: 403 });
            if (device && device.device_fingerprint !== requestedFingerprint)
                throw Object.assign(new Error('Device identity mismatch.'), { statusCode: 403 });
            if (!device) {
                const count = Number((await client.query("select count(*) count from license_devices where license_id=$1 and status='active'", [license.id])).rows[0].count);
                if (count >= license.max_devices)
                    throw Object.assign(new Error('Device limit reached.'), { statusCode: 409 });
                device = (await client.query('insert into license_devices(license_id,installation_id,device_public_key,device_fingerprint,device_name,app_version) values($1,$2,$3,$4,$5,$6) returning *', [
                    license.id,
                    req.installation_id,
                    req.device_public_key,
                    requestedFingerprint,
                    req.device_name,
                    req.app_version
                ])).rows[0];
            }
            else {
                device = (await client.query('update license_devices set device_name=$1,app_version=$2,last_validated_at=now() where id=$3 returning *', [req.device_name, req.app_version, device.id])).rows[0];
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
    app.get('/api/vendor/dashboard', { preHandler: vendor }, async () => {
        const [customers, licenses, devices, activations] = await Promise.all([
            pool.query('select count(*)::int count from license_customers'),
            pool.query("select count(*)::int total,count(*) filter (where status='active')::int active,count(*) filter (where status='suspended')::int suspended,count(*) filter (where status='revoked')::int revoked from licenses"),
            pool.query("select count(*)::int total,count(*) filter (where status='active')::int active,count(*) filter (where status='revoked')::int revoked from license_devices"),
            pool.query("select count(*)::int total,count(*) filter (where created_at>=now()-interval '30 days')::int last_30_days from license_activations")
        ]);
        return { data: {
                customers: customers.rows[0],
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
    app.post('/api/vendor/licenses/:id/renew', { preHandler: vendor }, async (request) => {
        const licenseId = z.string().uuid().parse((request.params as any).id);
        const input = z.object({
            expires_at: z.string().datetime().nullable()
        }).parse(request.body);
        const client = await pool.connect();
        try {
            await client.query('begin');
            const license = (await client.query('select * from licenses where id=$1 for update', [licenseId])).rows[0];
            if (!license)
                throw Object.assign(new Error('License not found.'), { statusCode: 404 });
            const updated = (await client.query("update licenses set expires_at=$2,status='active',updated_at=now() where id=$1 returning *", [licenseId, input.expires_at])).rows[0];
            await client.query("update business_licenses set status='active',updated_at=now() where license_id=$1", [licenseId]);
            await client.query("insert into license_audit_logs(actor,action,entity_type,entity_id,description) values('vendor','license.renew','license',$1,$2)", [
                licenseId,
                input.expires_at
                    ? 'License renewed until ' + input.expires_at
                    : 'License renewed without expiration'
            ]);
            await client.query('commit');
            return { data: updated };
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
