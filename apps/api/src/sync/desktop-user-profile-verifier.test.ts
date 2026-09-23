import assert from 'node:assert/strict';import test from 'node:test';import {passwordVerifierSchema} from '@corepos/validation';

test('profile verifier allowlist rejects plaintext, unsupported, and malformed credentials without echoing them',()=>{for(const value of ['plain-sentinel-password','scrypt$sentinel','\$2b\$04\$short','\$argon2id\$v=19\$bad']){const result=passwordVerifierSchema.safeParse(value);assert.equal(result.success,false);if(!result.success)assert.equal(JSON.stringify(result.error.flatten()).includes(value),false)}});
