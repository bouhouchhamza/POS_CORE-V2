import {z} from 'zod';

export const universalV1Entities=['categories','units','customers'] as const;
export type UniversalV1Entity=typeof universalV1Entities[number];

const categorySchema=z.object({
  name:z.string().trim().min(1).max(255),
  image:z.string().nullable().optional(),
  is_public:z.boolean(),
}).strict();
const unitSchema=z.object({
  code:z.string().trim().min(1).max(50),
  name:z.string().trim().min(1).max(255),
  precision:z.number().int().min(0).max(6),
  active:z.boolean(),
}).strict();
const customerSchema=z.object({
  name:z.string().trim().min(1).max(255),
  phone:z.string().nullable().optional(),
  email:z.string().email().nullable().optional(),
  address:z.string().nullable().optional(),
  notes:z.string().nullable().optional(),
  active:z.boolean(),
}).strict();

export const universalV1DataSchemas={
  categories:categorySchema,
  units:unitSchema,
  customers:customerSchema,
} satisfies Record<UniversalV1Entity,z.ZodTypeAny>;

type JsonRecord=Record<string,unknown>;
const record=(value:unknown):JsonRecord=>z.record(z.string(),z.unknown()).parse(value);
const wireBoolean=(value:unknown)=>z.union([z.boolean(),z.literal(0),z.literal(1)]).transform(Boolean).parse(value);

/** Closed, explicit serializers prevent database-only columns entering V1. */
export const universalV1Serializers={
  categories:(value:unknown)=>{
    const row=record(value);
    return categorySchema.parse({name:row.name,image:row.image??null,is_public:wireBoolean(row.is_public)});
  },
  units:(value:unknown)=>{
    const row=record(value);
    return unitSchema.parse({code:row.code,name:row.name,precision:row.precision,active:wireBoolean(row.active)});
  },
  customers:(value:unknown)=>{
    const row=record(value);
    return customerSchema.parse({name:row.name,phone:row.phone??null,email:row.email??null,address:row.address??null,notes:row.notes??null,active:wireBoolean(row.active)});
  },
} satisfies Record<UniversalV1Entity,(value:unknown)=>JsonRecord>;

export function serializeUniversalV1Data(entity:UniversalV1Entity,value:unknown){
  return universalV1Serializers[entity](value);
}
