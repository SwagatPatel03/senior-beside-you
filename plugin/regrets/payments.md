---
topic: payments
title: Payments, money and payment webhooks
applies-to: payment, checkout, stripe, razorpay, paypal, order, subscription, billing, invoice, refund, wallet, credit, price, cart, membership
---

## R-payments-01: Payment webhooks arrive twice, late, or out of order
**How it shows up:** A customer is given two months of membership for one payment, an order ships twice, or a refund event arrives before the payment event and crashes the handler.
**Why it happens:** Payment providers deliver webhooks at least once and retry when they do not get a fast success reply. The handler assumes each event arrives exactly once and in order.
**What a senior decides up front:** Store each event's id with a unique constraint and skip events already processed (idempotency). Make the handler change state based on the payment's current status, not on the order of events. Reply with success quickly and do slow work afterwards.
**One-way or two-way:** One-way, because the payments table needs the event id and status model from the start.
**Test that proves it:** Send the same webhook event twice, and send a refund before its payment. The membership is granted once, and nothing crashes.
**Source:** Stated in the webhook documentation of major payment providers, which say events can be delivered more than once and out of order.

## R-payments-02: Trusting the price or amount sent by the browser
**How it shows up:** Someone edits the request and buys a yearly plan for 1 rupee.
**Why it happens:** The checkout reads the amount from the client instead of computing it on the server.
**What a senior decides up front:** The server computes every amount from its own price list and the item ids. The client sends only what was chosen, never what it costs.
**One-way or two-way:** Two-way, but it is a security hole until fixed.
**Test that proves it:** Send a checkout request with a changed amount. The charge uses the server's price.
**Source:** A classic web security mistake, covered in OWASP guidance on business logic flaws.

## R-payments-03: Money stored as floating point numbers
**How it shows up:** Totals end in .00000001, refunds do not match charges, and reports are off by a few paise.
**Why it happens:** Floating point cannot represent most decimal fractions exactly.
**What a senior decides up front:** Store money as integers in the smallest unit (paise, cents) or as a fixed decimal type, together with a currency code.
**One-way or two-way:** One-way, because changing the type later means migrating every amount.
**Test that proves it:** Add 0.1 and 0.2 of a currency unit in the money module. The result is exactly 0.3.
**Source:** Widely documented; most payment provider APIs use integer minor units for this reason.

## R-payments-04: Fulfilling before the payment is confirmed
**How it shows up:** Users get the product when they reach the success page, even if the payment later fails or is reversed.
**Why it happens:** The redirect back from the payment page is treated as proof of payment.
**What a senior decides up front:** Only a verified server-side confirmation (a signed webhook or a server call to the provider) grants access. The success page only shows status. Webhook signatures are always verified.
**One-way or two-way:** One-way for the order state model.
**Test that proves it:** Visit the success page without paying. Nothing is granted. Send an unsigned webhook. It is rejected.
**Source:** Payment provider integration guides warn against relying on the client redirect.
