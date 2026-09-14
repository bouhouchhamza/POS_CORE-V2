# QR Menu

Each active table has a random 256-bit token; only its SHA-256 digest is stored. The public route resolves business, branch, room, and table from the business slug and token, then returns public, active, available menu items.

Guests can submit an idempotent dine-in order with notes, call a waiter, or request the bill without employee authentication. Orders remain attached to the table and flow to the universal order and kitchen screens. Staff can rotate, download, and print table QR codes; rotation invalidates the previous token.

Public endpoints are rate limited in cloud mode. Payment gateway integration is not implemented.
