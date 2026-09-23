# A source decode is capped, and large ones take turns

Every decode of a source goes through one helper in `thumbnails.rs` that sets
`image::Limits::max_alloc` to `MAX_DECODE_ALLOC` (1 GiB). That fits a 16K
RGBA PNG (17280x9720 is about 670 MB) and refuses a file whose header claims
more. The refusal is an ordinary `AppError::Image`, so it goes down the same
path as any undecodable source: counted by the pass and written down as a
failure note against that mtime (ADR 0034). An allocation that fails because
the machine ran out of memory aborts the process and cannot be caught, so the
limit has to reject the file before the decoder allocates, not after.

The cap alone is not enough, because serving runs 2 to 8 worker threads and
the pre-generation pass runs alongside them. Several 670 MB decodes at once
are each under the cap and together still exhaust memory. So a decode whose
header dimensions come to more than 256 MB of RGBA (64 megapixels) first takes
a permit from one process-wide counting semaphore with a single permit.
Decodes below that line never touch it, so an ordinary library decodes with
full parallelism, and an 8K source (33 MP) counts as small.

The gate reads the dimensions from the header, not the recorded ones
(ADR 0044). The header is what the decoder is about to believe. A recorded row
can be missing or stale after a re-export, and neither should let a large
decode past the gate. The header read is cheap next to the decode it guards.
