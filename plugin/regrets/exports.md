---
topic: exports
title: Exports, reports and downloads
applies-to: export, csv, excel, xlsx, report, download, dump, statement, invoice list, analytics
---

## R-exports-01: Loading every row into memory before writing the file
**How it shows up:** The export works in development with 50 rows and crashes the demo server with a month of real data.
**Why it happens:** The code fetches all rows into a list, builds the whole file as a string, and then sends it.
**What a senior decides up front:** Stream: read rows in batches or with a server-side cursor and write each row to the response or file as it arrives. Set a maximum date range or row count.
**One-way or two-way:** Two-way, but it fails at the worst moment.
**Test that proves it:** Export 1 million generated rows. Memory use stays roughly flat.
**Source:** Common failure in reporting features.

## R-exports-02: Spreadsheet formula injection
**How it shows up:** A user's name like `=HYPERLINK(...)` becomes a live formula when an admin opens the export in Excel.
**Why it happens:** User-entered text is written into CSV cells as-is.
**What a senior decides up front:** Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with a single quote, or the export uses a library that does this.
**One-way or two-way:** Two-way.
**Test that proves it:** Export a record whose name is `=1+1`. Excel shows the text `=1+1`, not `2`.
**Source:** OWASP's page on CSV injection.

## R-exports-03: The export ignores the user's permissions
**How it shows up:** A branch manager's export contains every branch's customers.
**Why it happens:** The export query is written fresh and misses the filters that the normal screens apply.
**What a senior decides up front:** The export reuses the same permission-filtered query as the screen it comes from. Never write a second, unfiltered query.
**One-way or two-way:** Two-way, but a data leak until fixed.
**Test that proves it:** Export as a user limited to one branch. Only that branch's rows appear.
**Source:** A frequent cause of internal data leaks; see the permissions topic.

## R-exports-04: Long exports inside a web request
**How it shows up:** Big exports time out at the proxy after 30 to 60 seconds, and users click again, starting more exports.
**Why it happens:** The whole export runs while the browser waits.
**What a senior decides up front:** Small exports stream directly. Large ones run as a background job that stores the file and notifies the user with a download link that expires.
**One-way or two-way:** Two-way.
**Test that proves it:** Request the largest allowed export. The response returns quickly and the file arrives later.
**Source:** Common in reporting systems behind proxies with request timeouts.

## R-exports-05: Dates and numbers formatted inconsistently
**How it shows up:** The finance team's spreadsheet reads 03/04 as the 4th of March for some rows and the 3rd of April for others, or amounts are rounded.
**Why it happens:** Values are formatted using the server's locale or a mix of formats.
**What a senior decides up front:** Export dates in ISO 8601 with a stated timezone, and amounts as plain numbers with a separate currency column. See the time topic.
**One-way or two-way:** Two-way, but people build processes on the first format you ship.
**Test that proves it:** Export a record dated 3 April at 23:30 in the user's timezone. The file shows 2026-04-03 and names the timezone.
**Source:** Common in finance and reporting handovers.
