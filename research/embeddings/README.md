# Embedding measurements for #374

Throwaway scripts behind "Embeddings: worth it, and what they feed". They read the
app's database read-only and never write to it. Python in a `uv` venv with
`torch open_clip_torch imagehash pillow numpy`; `sa_0_4_vit_b_32_linear.pth` is the
LAION aesthetic predictor V1 head (github.com/LAION-AI/aesthetic-predictor).

- `compute.py`: pHash, CLIP B/32 embedding and LAION score per wallpaper, from the
  Small thumbnail and the source, into `data.json`.
- `pairs.py`: every pair's Hamming and cosine; `sheet.py` draws a contact sheet of them.
- `synth.py`: synthetic variants (re-encode, crops, colour edits, flip) scored against the library.
- `revisit.py`: the revisit check. Held-out correlation of a 1/σ²-weighted ridge
  against μ. Revisit Score prediction if Pearson r ≥ 0.6 once the library has about
  8 Comparisons per wallpaper.

Results as of 2026-09-29 (121 wallpapers, 0 Comparisons) are on the ticket.
Don't commit `data.json` or contact sheets: they describe a private library.
