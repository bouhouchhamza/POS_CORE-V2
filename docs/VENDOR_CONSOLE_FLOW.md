# CorePOS Vendor Console flow

## Information architecture

The normal Vendor Console has five commercial areas:

- Dashboard
- Businesses
- Licences
- Devices
- Administration: plans, activation-code history, activations, and audit

“Business” is a CorePOS subscriber/business. It is distinct from a retail customer managed by that Business inside the POS. Tenant, workspace, database, grant, and hash terminology does not appear in normal workflows.

## Create Business

**New business** is the primary action on Dashboard and Businesses. The Vendor provides only business/commercial information: identity and regional defaults, contact, owner account, plan, and licence duration.

After submit, CorePOS prepares infrastructure internally. The console shows either:

- **Ready for activation** — next action: **Generate activation code**.
- **Preparation needs attention** — action: **Retry preparation**.

Retry continues the existing recipe; it does not create another Business, tenant, owner, licence, or activation code. No provisioning credential is displayed.

## Business details

Each Business has one details screen:

- Overview: contact, licence summary, device usage, creation date.
- Licence: commercial status, quota, and code-generation action when ready.
- Devices: activated device metadata and supported revoke action.
- Activity: safe commercial labels for recorded activity.

The Business list includes name, commercial status, readiness, plan, device usage, search, details, and only contextual actions. Failed preparation exposes retry; ready Business exposes activation-code generation.

## Activation-code issuance

Generating a code opens one show-once card containing Business, `CP-XXXX-XXXX-XXXX-XXXX`, device usage, licence status, and Copy/Regenerate/Done actions. The console never retrieves an old plaintext code because only its hash is stored. Regeneration explains that unused codes are revoked while activated devices remain active.

## Licence and device management

Licences show plan, localized status, applicable expiry, quota, and device usage. Supported suspend/reactivate actions are contextual. Devices show Business, device name/channel/platform, status, and meaningful last activity; revoke requires confirmation. The UI does not invent unsupported device-management controls.

## Empty, loading, and responsive states

Businesses, licences, devices, and activity have intentional empty states. Pending actions disable their controls and show one localized result message. French, English, and Arabic are supported; Arabic uses RTL layout while activation codes remain isolated LTR.

At narrow widths navigation becomes a compact grid, forms are one column, actions wrap, dialogs fit the viewport, activation-code actions stack, and tables remain in controlled horizontal containers.

## Internal recovery compatibility

Historical provisioning-key and provisioning-grant tooling is intentionally absent from normal navigation. It is an operator-only legacy-recovery capability requiring `VENDOR_ADMIN_TOKEN`, not a daily Vendor Console password session, customer activation, or Business creation step.
