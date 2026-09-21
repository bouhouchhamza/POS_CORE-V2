# CorePOS commercial licensing

CorePOS has one customer licensing journey:

1. A Vendor creates the Business and selects its commercial plan.
2. CorePOS provisions the Business internally and creates its commercial licence.
3. When the Business is ready, the Vendor generates one CP activation code.
4. The customer opens `/activation`, enters that code, activates the device, then signs in.

Customers do not receive a provisioning key, activation grant, tenant name, database name, or reusable commercial secret.

## Authoritative lifecycle

The server computes a single lifecycle state. The web client does not combine historical setup booleans to guess a route.

| State | Meaning | Normal browser outcome |
| --- | --- | --- |
| `PROVISIONING` | CorePOS is preparing the internally created Business. | Non-actionable preparation notice. |
| `PROVISIONING_FAILED` | Internal preparation needs a Vendor retry. | Non-actionable notice; Vendor retries from Business. |
| `READY_FOR_ACTIVATION` | Workspace, active commercial licence, and valid quota are ready. | `/activation` |
| `DEVICE_ACTIVATED` | Device is activated; no merchant user is authenticated. | `/login` |
| `READY` | Device and merchant session are valid. | Application dashboard/route. |
| `BLOCKED` | Business, licence, or device is unavailable. | Localized blocked notice. |
| `SETUP_REQUIRED` | Development/local-only first setup. | `/setup` |

`GET /api/setup/status` returns this state. Old boolean fields remain response compatibility only and must not drive new routing.

## Customer activation code

The only normal customer credential is `CP-XXXX-XXXX-XXXX-XXXX`.

- Its 16-character payload uses cryptographic randomness with rejection sampling from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`: 31 unambiguous characters and about 79 bits of entropy.
- It is non-sequential and independent of customer, Business, tenant, licence, and device identifiers.
- Only its SHA-256 hash is persisted in `license_activation_codes`; plaintext exists only in the issuance response.
- Complete CP codes safely case-fold and normalize spaces/hyphens. Opaque legacy `act_...` credentials retain trim-only matching, preserving existing hashes.
- The unique hash index is the final uniqueness authority. Codes are one-time, channel-scoped, audited, rate-limited, and short lived (24 hours by default, never past commercial expiry).
- Regeneration revokes only unused live codes. It never revokes or deactivates an already activated device.

Browser activation uses exactly one hosted endpoint: `POST /api/license/device-activate`. The desktop local relay may expose `/api/license/activate`; it forwards the same signed proof to the canonical control-plane endpoint and persists the returned certificate. It is not a second hosted activation flow.

UI error classification uses machine codes, never HTTP status alone. `ACTIVATION_CODE_INVALID` and `DEVICE_LIMIT_REACHED`, including when returned as HTTP 409, remain on `/activation` and never invoke provisioning recovery.

## Device, certificate, and offline security

Online activation requires a signed device proof and atomically binds the code to a registered device. Total and channel quotas apply. Replay returns an explicit used/already-activated state rather than creating a new device.

CorePOS keeps its Ed25519-signed, device-bound certificate model. Offline `.posreq` / `.poslic` activation remains a signed, nonce-protected secondary path. It does not expose a reusable licence secret or weaken online replay protection. Trusted-device behavior and public-QR tenant resolution remain server-authoritative.

## Internal and legacy provisioning

Tenant provisioning is Vendor-initiated infrastructure. For a new Business, CorePOS persists an internal replay-safe recipe, creates/migrates the tenant database where required, bootstraps owner/default data, creates the commercial licence, binds the control-plane shadow, records audit events, and only then makes the Business ready for activation.

Historical `/api/provision` and `/api/provision/activate-device` grant exchange remain only for explicitly enabled legacy recovery. `/provision` requires both `VITE_ENABLE_LEGACY_PROVISIONING_RECOVERY=true` and `?legacy-recovery=1`; it is absent from normal navigation. Provisioning-key management requires the internal bootstrap-token credential, not a normal Vendor Console session. `/activation` never probes the grant endpoint.

## Migration and deployment

Migration `0020_vendor_business_lifecycle.sql` adds `vendor_business_provisioning`. It does not modify or delete existing Business, tenant, licence, device, certificate, activation-code, or provisioning-grant rows. It stores an Argon2 owner-password hash and an internal setup recipe, never plaintext customer credentials.

Apply this control-plane migration before deploying code that creates new Vendor Businesses. Keep it when a new workflow record exists; do not drop the table as a routine rollback.
