---
topic: permissions
title: Permissions and access to data
applies-to: admin, role, team, organisation, tenant, workspace, share, dashboard, api, profile, account, supabase, firebase, multi-user
---

## R-permissions-01: Hiding a button instead of checking on the server
**How it shows up:** A normal user calls the admin API directly and deletes data, because only the button was hidden.
**Why it happens:** Permission checks live in the page, not on the server that does the work.
**What a senior decides up front:** Every server endpoint checks who is calling and whether they are allowed, in one shared place. The page hides buttons only for convenience.
**One-way or two-way:** One-way in practice, because the permission model shapes every endpoint.
**Test that proves it:** Call each admin endpoint as a normal user. Every call is refused.
**Source:** OWASP Top 10, "Broken Access Control".

## R-permissions-02: Changing an id in the URL shows someone else's data
**How it shows up:** `/invoices/1042` shows your invoice, and `/invoices/1043` shows a stranger's.
**Why it happens:** The server loads a record by id without checking that it belongs to the caller.
**What a senior decides up front:** Every lookup is scoped to the caller, for example `WHERE id = ? AND owner_id = ?`, through a shared helper, so it cannot be forgotten.
**One-way or two-way:** Two-way, but a data leak until fixed.
**Test that proves it:** Request another user's record id while logged in. The server answers "not found".
**Source:** OWASP, "Insecure Direct Object Reference".

## R-permissions-03: Database open to the browser without row rules
**How it shows up:** Anyone with the public key can read or change every row in a table.
**Why it happens:** Services such as Supabase or Firebase let the browser talk to the database directly, and access rules (row-level security or security rules) were left off or written too broadly.
**What a senior decides up front:** Row-level security is on for every table from the first migration, with a policy per action. Run the provider's security checks before launch.
**One-way or two-way:** One-way in practice, because data may already have leaked.
**Test that proves it:** With only the public key, try to read and update another user's row. Both fail.
**Source:** Repeated public incidents with apps built on these platforms, and their own security guides.

## R-permissions-04: Mixing tenants' data
**How it shows up:** One company's users see another company's projects in a search result or an export.
**Why it happens:** In a shared database, one query forgot the tenant filter.
**What a senior decides up front:** Decide the tenancy model early. Enforce the tenant filter in one layer (a scoped query helper, a default scope, or row-level security), never by hand in each query.
**One-way or two-way:** One-way.
**Test that proves it:** Create two tenants with similar data. Every list, search and export for one tenant contains none of the other's rows.
**Source:** A common class of incident in multi-tenant software.
