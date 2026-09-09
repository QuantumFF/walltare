# ci: test the OpenCodeReview PR review workflow

This PR exists to fire the `.github/workflows/ocr-review.yml` workflow.

## What to check

1. The "OpenCodeReview PR Review" run starts on this PR (pull_request_target: opened).
2. The run completes and posts a review comment on this PR.
3. To test the re-review path, comment `/open-code-review` on this PR; it should start a second run without being cancelled by unrelated comments.

If the run fails, likely causes are missing repo secrets (`OCR_LLM_URL`, `OCR_LLM_AUTH_TOKEN`) or variables (`OCR_LLM_MODEL`, `OCR_LLM_USE_ANTHROPIC`).
