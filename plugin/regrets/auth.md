---
topic: auth
title: Logins, passwords and sessions
applies-to: login, signup, register, password, auth, session, token, jwt, oauth, account, otp, reset, user
---

## R-auth-01: Building password storage by hand
**How it shows up:** A database leak exposes every password, because they were stored in plain text or with a fast hash such as MD5 or SHA-256.
**Why it happens:** Hashing looks simple, so people write it themselves.
**What a senior decides up front:** Use the framework's or a trusted provider's authentication, or a slow password hash made for the purpose (Argon2id, bcrypt or scrypt) through a maintained library. Never invent the scheme.
**One-way or two-way:** One-way, because existing hashes cannot be converted without the passwords.
**Test that proves it:** Read a user row in the database. The password column holds a slow hash in a standard format, never the password.
**Source:** OWASP Password Storage Cheat Sheet, and many public breach reports.

## R-auth-02: Password reset links that never expire or can be reused
**How it shows up:** An old reset email in someone's inbox still lets a person take over the account months later.
**Why it happens:** Reset tokens are stored without an expiry and are not marked as used.
**What a senior decides up front:** Reset tokens are random, stored only as a hash, expire within an hour or so, work only once, and are cancelled when the password changes. Changing the password ends other sessions.
**One-way or two-way:** Two-way, but costly after an incident.
**Test that proves it:** Use a reset link twice. The second use fails. Use one after its expiry. It fails.
**Source:** OWASP Forgot Password Cheat Sheet.

## R-auth-03: No limit on login or one-time-code attempts
**How it shows up:** Someone guesses a six-digit OTP in a few minutes, or a login page is used to test leaked passwords.
**Why it happens:** Each attempt is checked, but the number of attempts is not.
**What a senior decides up front:** Rate limit login, OTP and reset endpoints per account and per IP address, and lock or slow down after repeated failures.
**One-way or two-way:** Two-way.
**Test that proves it:** Send 20 wrong OTPs for one account. Later attempts are refused even with the right code until the limit resets.
**Source:** OWASP Authentication Cheat Sheet.

## R-auth-04: Tokens stored where page scripts can read them
**How it shows up:** One cross-site scripting bug lets an attacker read every visitor's login token from local storage.
**Why it happens:** The token is put in `localStorage` because it is convenient.
**What a senior decides up front:** For browser apps, keep the session in an `HttpOnly`, `Secure`, `SameSite` cookie, or follow the auth provider's recommended storage. Decide this before the frontend is built around it.
**One-way or two-way:** One-way in practice, because the whole frontend depends on it.
**Test that proves it:** In the browser console on a logged-in page, `document.cookie` and `localStorage` do not show the session token.
**Source:** OWASP Session Management Cheat Sheet.
