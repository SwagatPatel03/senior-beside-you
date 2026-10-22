---
topic: file-uploads
title: File uploads and user files
applies-to: upload, file, image, avatar, photo, attachment, document, pdf, csv import, media, storage, s3
---

## R-file-uploads-01: No limit on upload size or count
**How it shows up:** One user uploads a 4 GB video and the server runs out of memory or disk, or the storage bill jumps.
**Why it happens:** The upload handler accepts whatever arrives and often reads it fully into memory.
**What a senior decides up front:** Set a maximum size at every layer: the web server or proxy, the framework, and the storage rule. Limit the number of files per user. Stream large files to storage instead of holding them in memory. For big files, upload directly to object storage with a pre-signed URL that carries a size limit.
**One-way or two-way:** Two-way to add, but the damage happens before you notice.
**Test that proves it:** Upload a file one byte over the limit. It is refused early with a clear message, and memory use stays flat.
**Source:** OWASP File Upload Cheat Sheet.

## R-file-uploads-02: Trusting the file name, extension or type sent by the browser
**How it shows up:** A file named `photo.jpg.php` is uploaded and then run by the server, or a file name such as `../../config` overwrites something.
**Why it happens:** The code keeps the user's file name and trusts the content type in the request.
**What a senior decides up front:** Generate your own storage name. Check the real file type from its content against an allow-list. Store uploads outside the web root or in object storage, and serve them with a safe content type and `Content-Disposition`.
**One-way or two-way:** Two-way, but it is a security hole until fixed.
**Test that proves it:** Upload a file named `../x.php` with an image content type. It is stored under a generated name and is never run.
**Source:** OWASP File Upload Cheat Sheet.

## R-file-uploads-03: Uploaded files readable by anyone with the link
**How it shows up:** Private documents can be found by guessing or sharing URLs.
**Why it happens:** Files are put in a public bucket for convenience.
**What a senior decides up front:** Private files live in private storage and are served through short-lived signed URLs after a permission check. Decide which files are public before building.
**One-way or two-way:** One-way in practice, because links spread and cannot be recalled.
**Test that proves it:** Request another user's private file URL while logged out. It is refused.
**Source:** Many public data exposure incidents involve misconfigured public storage buckets.

## R-file-uploads-04: Processing uploads inside the request
**How it shows up:** Resizing a large image or parsing a big spreadsheet times out the request, and the user uploads again, making it worse.
**Why it happens:** Heavy processing runs before the response is sent.
**What a senior decides up front:** Accept and store the file quickly, then process it in a background job and show the status. See the background-jobs topic.
**One-way or two-way:** Two-way.
**Test that proves it:** Upload the largest allowed file. The request returns quickly, and the result appears when processing ends.
**Source:** Common in image and import pipelines.
