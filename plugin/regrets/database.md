---
topic: database
title: Database queries, schema and migrations
applies-to: database, query, orm, sql, list, dashboard, feed, search, table, migration, schema, index, model, report
---

## R-database-01: A database query inside a loop (the N+1 problem)
**How it shows up:** A page that lists 20 bookings is fast in development and takes 8 seconds in production with 2,000, because it runs one query per row to fetch each member's name.
**Why it happens:** An ORM loads related records lazily, one row at a time, when code touches them inside a loop. The code looks innocent.
**What a senior decides up front:** Load related data in one query, using a join or the ORM's eager loading (`select_related`, `prefetch_related`, `include`, `with`). Watch the query count in development, and add a test that fixes the number of queries for list pages.
**One-way or two-way:** Two-way, but it is easy to spread across many pages before anyone notices.
**Test that proves it:** Render the list with 1 row and with 100 rows. The number of queries is the same.
**Source:** Widely documented in the guides of every major ORM.

## R-database-02: Uniqueness checked only in application code
**How it shows up:** Two accounts end up with the same email, or two orders have the same number.
**Why it happens:** The code checks "does this exist?" before inserting, and two requests pass the check together.
**What a senior decides up front:** Anything that must be unique has a unique constraint in the database. The application check is only for a friendly message.
**One-way or two-way:** One-way, because duplicates must be cleaned up before a constraint can be added later.
**Test that proves it:** Insert the same value from two parallel requests. One fails with a clean error.
**Source:** The same check-then-act race as R-bookings-01.

## R-database-03: Missing indexes on columns used for filtering
**How it shows up:** Lookups that took milliseconds take seconds once the table has a few million rows.
**Why it happens:** Indexes were not added for the columns used in `WHERE`, `JOIN` and `ORDER BY`, and small development data hides it.
**What a senior decides up front:** Add indexes for foreign keys and for the main filters each screen uses. Check slow queries with `EXPLAIN` before launch.
**One-way or two-way:** Two-way, but adding an index to a huge live table needs care.
**Test that proves it:** Run `EXPLAIN` on the main list query. It uses an index, not a full table scan.
**Source:** Standard database performance guidance.

## R-database-04: A migration that locks a big table
**How it shows up:** A deploy that adds a column or an index freezes the app for minutes.
**Why it happens:** Some schema changes lock the whole table while they rewrite it.
**What a senior decides up front:** For big tables, use non-blocking forms (for example `CREATE INDEX CONCURRENTLY` in Postgres), add columns as nullable first, and fill data in batches. Test migrations on a copy with realistic size.
**One-way or two-way:** Two-way, but a mistake causes an outage.
**Test that proves it:** Run the migration on a large copy while sending traffic. Requests keep succeeding.
**Source:** Common in deployment postmortems.
