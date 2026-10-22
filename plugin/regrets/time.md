---
topic: time
title: Time, dates and timezones
applies-to: booking, schedule, calendar, reminder, deadline, report, export, subscription, billing, expiry, cron, recurring, timestamp, date, timezone
---

## R-time-01: Timestamps stored in local time or without a zone
**How it shows up:** Times are off by a few hours for some users, reports put events on the wrong day, and the bug appears only when a user or server is in another country.
**Why it happens:** The code stores what the server's clock says, or a naive datetime with no zone, and different parts of the system assume different zones.
**What a senior decides up front:** Store instants in UTC in a type that keeps the zone (for example `timestamptz` in Postgres). Convert to local time only at the edges, when showing or reading user input. Store each user's or location's timezone as a name such as "Asia/Kolkata", never as a fixed offset.
**One-way or two-way:** One-way, because existing data is ambiguous once it is stored without a zone.
**Test that proves it:** Run the test suite with the server timezone set to something unusual, such as `TZ=Pacific/Kiritimati`. Nothing changes.
**Source:** One of the most widely documented classes of bugs in software, covered in many "falsehoods programmers believe about time" lists.

## R-time-02: Daylight saving changes break recurring events
**How it shows up:** A weekly 9:00 class becomes 8:00 or 10:00 after the clocks change. A daily job runs twice or not at all on the change day.
**Why it happens:** The recurrence is stored as "every 7 days in UTC" instead of "every Monday at 9:00 in this timezone".
**What a senior decides up front:** Store recurring rules as local time plus a timezone name, and compute each occurrence's UTC instant from them. Schedule jobs in UTC, or make them safe to run twice.
**One-way or two-way:** One-way for stored recurrences.
**Test that proves it:** Generate occurrences across a daylight saving change for a zone that has one, such as "Europe/London". The local time stays the same.
**Source:** Common in calendar and scheduling systems.

## R-time-03: "Today" and "this month" computed in the wrong timezone
**How it shows up:** A daily report for India misses the first five and a half hours of the day. A user's streak breaks at the wrong time of night.
**Why it happens:** Day and month boundaries are computed in UTC or the server's zone instead of the user's.
**What a senior decides up front:** Every "day", "week" or "month" in the product names whose timezone it is in. Queries convert those boundaries to UTC instants before filtering.
**One-way or two-way:** Two-way for queries, one-way if daily totals are stored.
**Test that proves it:** A record created at 00:30 local time in UTC+5:30 appears in that local day's report.
**Source:** Common in reporting and analytics bugs.

## R-time-04: Comparing dates as text, or using the client's clock
**How it shows up:** A coupon is still valid after it expired because the user changed their phone's clock. Sorting by date puts "10/02" before "9/30".
**Why it happens:** Expiry checks run in the browser, or dates are stored and compared as formatted strings.
**What a senior decides up front:** Anything that matters (expiry, access, billing) is checked on the server with the server's clock. Dates are stored as date or timestamp types, never as formatted text.
**One-way or two-way:** One-way for stored formats.
**Test that proves it:** Call the server endpoint with an expired coupon and any client-side date. It is refused.
**Source:** Common in trial, coupon and access-expiry bugs.
