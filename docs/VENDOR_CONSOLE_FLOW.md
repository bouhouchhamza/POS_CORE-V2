# Core POS V2 - Vendor Console flow

## Goal
The Vendor Console is the commercial control plane. Merchant users never need the vendor admin token.

## Normal vendor login
1. Open `/Vendor`.
2. Enter the configured vendor username and password.
3. The API verifies the Argon2 password hash stored server-side.
4. The API creates a signed, HttpOnly, Secure vendor session cookie.
5. The browser does not store the vendor admin token.

`VENDOR_ADMIN_TOKEN` remains a bootstrap/emergency API credential only. It is not part of the normal UI flow.

## New customer flow
The **Nouveau client** wizard performs one transactional operation:

1. Create Vendor Client.
2. Create Vendor Business.
3. Select an active Plan.
4. Choose licence duration: no expiry, 1 month, 3 months, 6 months, 1 year, or custom date.
5. Create the active Licence using the Plan modules/device limit/offline policy.
6. Create a cloud Provisioning Code automatically, valid for at most 24 hours and never beyond the licence expiry.
7. Show the one-time Provisioning Code and Desktop Licence Key clearly as two different credentials.

If the transaction fails, the new onboarding objects are rolled back together.

## What each credential is for
- **Provisioning Code (`prov_...`)**: sent to the merchant for `/provision`. It creates/binds the merchant runtime business. It is short-lived and one-time.
- **Desktop Licence Key**: kept for Desktop/device activation. It is not the `/provision` code.
- **Vendor Admin Token**: server-side/bootstrap only. Never send it to a merchant and never use it as the daily browser login.

## Simplified navigation
Normal navigation is limited to:
- Dashboard
- Clients
- Licences
- Appareils
- Avance

Technical views (Businesses, Plans & Modules, provisioning history, activations, offline activation, audit) live under **Avance**.

## Licence expiry
Vendor chooses a business-friendly duration. No raw date is required unless **Date personnalisee** is selected.

## Provisioning expiry
The Vendor does not type this manually. The console chooses 24 hours automatically, capped by licence expiry.
