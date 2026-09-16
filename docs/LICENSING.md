# Core POS V2 commercial licensing

The commercial hierarchy is **Vendor Client -> Vendor Business -> renewable Licence -> registered devices -> merchant workspace**. Merchant users are tenant users; Vendor administration remains in the control plane.

## Commercial expiration

Every commercial licence has a non-null `expires_at`. New licences default to one year when no duration is supplied. Vendor onboarding offers 1 month, 3 months, 6 months, 1 year, or a custom future date. Renewal always creates a new future expiration; there is no new "without expiration" commercial licence.

Migration `0016_require_commercial_license_expiry.sql` gives any legacy null-expiry licence one transition year from migration time and then makes `licenses.expires_at` mandatory. The signed Desktop certificate also contains the commercial expiration, so `offline_validity_days = null` means "no periodic online deadline", **not** "commercial licence never expires".

## One-time Desktop activation

The commercial licence secret is internal and is never handed to the customer as a reusable activation key. Desktop uses a short-lived one-time activation code stored server-side only as SHA-256 (`license_activation_codes`). Default validity is 24 hours, capped at the commercial licence expiration.

A code is accepted only once. Successful activation atomically records `consumed_at` and the exact `consumed_device_id`. A consumed, revoked, expired, wrong-channel, inactive-business, or expired-licence code is rejected. Device activation still requires the signed Ed25519 device proof, so possession of a code alone is insufficient to impersonate another installation.

Offline `.posreq` activation does not expose a reusable master key. Each request has a device proof, timestamp and replay nonce; one request cannot be issued twice. The resulting `.poslic` is Vendor-signed and device-bound.

New cloud provisioning does not ask the merchant for a second activation code. A successful `prov_...` transaction creates a short-lived, one-time server-side activation grant bound to its provisioning key, licence, Vendor Business, and tenant. The browser receives only an HttpOnly grant cookie, exchanges it once for the existing activated-device cookie, and then proceeds to employee login. Manual `act_...` activation remains available for existing customers and support recovery.

## Device accounting

`license_devices.channel` is one of `desktop`, `web`, or `mobile`. Each licence has `max_devices` plus optional `max_desktop_devices`, `max_web_devices`, and `max_mobile_devices`. A new device must satisfy both the total and its channel limit.

Desktop uses its cryptographic installation identity. Browser/PWA sessions use a server-signed HttpOnly device cookie and cannot choose arbitrary installation IDs. Native mobile login support uses a signed device key proof. Revoking a device prevents subsequent validation/session refresh and frees its active slot; a replacement Desktop receives a new one-time activation code.

## Access enforcement

Effective access is the intersection of licence entitlements, enabled business modules, and authenticated role permissions. Operational writes require an active Vendor Business and an active, unexpired licence. Licensing never deletes merchant data.

A physically disconnected device cannot learn an early remote suspension or revocation until it reconnects. It can still enforce the expiration and offline deadline already present in its signed certificate. This is an unavoidable property of true offline operation.
