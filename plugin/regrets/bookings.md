---
topic: bookings
title: Bookings, reservations and limited capacity
applies-to: booking, reservation, appointment, slot, class, seat, ticket, table, room, capacity, waitlist, inventory, stock
---

## R-bookings-01: Two people book the last slot at the same moment
**How it shows up:** Two members tap "book" on the last spot at the same time and both get a confirmation. The class has 21 people for 20 places. It is rare in testing and common on launch day.
**Why it happens:** The code checks whether the slot is free, then inserts the booking in a separate step. Between the check and the insert, a second request passes the same check.
**What a senior decides up front:** The database enforces capacity, not the application. For one-per-slot, use a unique constraint on the slot for active bookings. For a capacity of N, lock the slot row (`SELECT ... FOR UPDATE`) or use an atomic conditional update such as `UPDATE slots SET taken = taken + 1 WHERE id = ? AND taken < capacity`, and check that one row changed.
**One-way or two-way:** One-way, because it lives in the data model and every booking path must go through it.
**Test that proves it:** Fire two booking requests for the last place in parallel. Exactly one succeeds and the other gets a clear "slot taken" message.
**Source:** The check-then-act race condition, described in most database and concurrency guides and in many ticketing and booking postmortems.

## R-bookings-02: Cancelled bookings still block the slot, or free it twice
**How it shows up:** A member cancels, but the slot still shows as full. Or a cancellation is processed twice and the slot shows a free place that does not exist.
**Why it happens:** Capacity is stored as a counter that is changed in several places, so it drifts away from the real bookings.
**What a senior decides up front:** Bookings have a status (confirmed, cancelled, no-show). Capacity is derived from confirmed bookings, or the counter is changed only in the same transaction as the status change, and a status change happens only once.
**One-way or two-way:** One-way for the data model.
**Test that proves it:** Book, cancel, cancel again. The slot gains exactly one free place.
**Source:** Common inventory drift bug in booking and e-commerce systems.

## R-bookings-03: Held places that are never released
**How it shows up:** People start booking, abandon the payment page, and the slot looks full while nobody is coming.
**Why it happens:** A place is held while the user pays, but nothing releases the hold if they leave.
**What a senior decides up front:** Holds have an expiry time stored with them, and capacity counts only unexpired holds and confirmed bookings. A cleanup job is a convenience, not the source of truth.
**One-way or two-way:** One-way if payments are involved, because the hold model shapes the booking table.
**Test that proves it:** Create a hold, move the clock past its expiry, and book the same place successfully.
**Source:** Common in ticketing and checkout systems with a payment step.

## R-bookings-04: Slot times stored without a timezone
**How it shows up:** Classes shift by an hour after a daylight saving change, or a member travelling abroad sees the wrong time.
**Why it happens:** Slot times are stored as local times without a zone, or the server's timezone is assumed.
**What a senior decides up front:** See the time topic. A recurring class is stored as a local time plus the gym's timezone name, and each concrete slot is stored as a UTC instant.
**One-way or two-way:** One-way, because existing rows are hard to fix later.
**Test that proves it:** Create a weekly 9:00 class that spans a daylight saving change. It stays at 9:00 local time on both sides.
**Source:** See the time topic.
