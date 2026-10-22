---
topic: background-jobs
title: Background jobs, queues and scheduled tasks
applies-to: job, queue, worker, cron, scheduled, reminder, notification, email, sms, retry, celery, sidekiq, bullmq, sync, import
---

## R-background-jobs-01: Jobs that do damage when they run twice
**How it shows up:** A customer gets the same reminder three times, or is charged twice, after a worker restarts.
**Why it happens:** Most queues deliver a job at least once. A job that crashes after doing its work but before being marked done runs again.
**What a senior decides up front:** Every job is safe to run twice (idempotent). Record what was done with a unique key, such as "reminder sent for booking 42", and check it before acting.
**One-way or two-way:** One-way in practice, because every job written later copies the pattern.
**Test that proves it:** Run the same job twice. The effect happens once.
**Source:** The documentation of most job queues states at-least-once delivery.

## R-background-jobs-02: Retrying forever, all at once
**How it shows up:** An outside service goes down, every job fails and retries immediately, and the retry storm keeps it down.
**Why it happens:** Retries have no delay, no growing gap between attempts, and no limit.
**What a senior decides up front:** Retries use exponential backoff with random jitter and a maximum number of attempts. Jobs that keep failing go to a dead-letter queue that someone looks at.
**One-way or two-way:** Two-way.
**Test that proves it:** Make the job fail every time. It is tried a fixed number of times with growing gaps, then parked.
**Source:** Widely described in cloud provider guidance on retries and backoff.

## R-background-jobs-03: One bad job blocks the queue
**How it shows up:** One malformed record makes a job crash, it retries forever at the front of the queue, and nothing else gets processed.
**Why it happens:** No limit on attempts, and no separation between a bad input and a temporary failure.
**What a senior decides up front:** Separate errors that will never succeed (bad data) from ones that might (a timeout). Do not retry the first kind. Watch the queue length.
**One-way or two-way:** Two-way.
**Test that proves it:** Enqueue a bad job followed by a good one. The good one still runs.
**Source:** Known in queue systems as the "poison message" problem.

## R-background-jobs-04: Work that silently stops
**How it shows up:** The nightly sync stopped three weeks ago and nobody noticed.
**Why it happens:** Failures are logged but nothing alerts on them, and nothing checks that a scheduled job actually ran.
**What a senior decides up front:** Each scheduled job records its last success. Something alerts when a job fails repeatedly or has not succeeded within its expected window.
**One-way or two-way:** Two-way.
**Test that proves it:** Stop the job. An alert or a visible warning appears within one expected interval.
**Source:** Common in operations postmortems about scheduled tasks.
