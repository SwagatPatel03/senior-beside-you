---
topic: retries
title: Retries, quick fixes and brute force
applies-to: retry, flaky, timeout, error, quick fix, workaround, deadline, hotfix, try again, catch, ignore, sleep
---

## R-retries-01: "Just retry it five times"
**How it shows up:** The error rate drops, but the real cause stays. Weeks later the system fails harder, or retries create duplicates.
**Why it happens:** Retrying hides the symptom. If the operation is not idempotent, each retry may repeat a side effect such as a charge or an email.
**What a senior decides up front:** First find out why it fails: read the error and check whether it is temporary (a timeout) or permanent (bad input, a bug). Retry only temporary errors, only idempotent operations, with backoff and a limit, and log every retry so the cause stays visible.
**One-way or two-way:** Two-way, but it hides problems.
**Test that proves it:** Make the operation fail once with a timeout and once with bad input. The first is retried. The second fails at once with a clear error.
**Source:** Widely described in reliability engineering guidance.

## R-retries-02: Catching an error and carrying on
**How it shows up:** The app looks healthy while data quietly goes missing, because errors are caught and ignored.
**Why it happens:** An empty `catch` or `except: pass` makes a deadline go away.
**What a senior decides up front:** Never swallow an error silently. Handle the specific error you expect, and log or re-raise everything else.
**One-way or two-way:** Two-way.
**Test that proves it:** Force the error. It is logged with context, and the caller learns it failed.
**Source:** Common anti-pattern in code review guides.

## R-retries-03: Fixing a flaky test with a sleep
**How it shows up:** The test passes more often, the suite gets slower, and the race condition it was warning about reaches production.
**Why it happens:** A wait hides a timing dependency instead of removing it.
**What a senior decides up front:** Treat a flaky test as a possible real race. Wait for a condition rather than a fixed time, and check whether the code has the same race.
**One-way or two-way:** Two-way.
**Test that proves it:** Run the test 50 times in a row. It passes every time, without a fixed sleep.
**Source:** Common guidance on flaky tests.

## R-retries-04: Turning off a check to make the build pass
**How it shows up:** A failing test is skipped, a linter rule is disabled, or a security check is bypassed "for now", and nobody turns it back on.
**Why it happens:** Deadline pressure.
**What a senior decides up front:** If a check must be skipped, record it as a decision with a reason and a date to revisit, and tell the user what is no longer being checked.
**One-way or two-way:** Two-way, if it is recorded.
**Test that proves it:** The ledger has an entry for every skipped check, and each has a revisit date.
**Source:** Common in postmortems where a disabled check would have caught the problem.
