# Research: image embeddings from Rust, GPU with CPU fallback

**Ticket:** [QuantumFF/walltare#366](https://github.com/QuantumFF/walltare/issues/366)
(map [#362](https://github.com/QuantumFF/walltare/issues/362))
**Date:** 2026-09-29

## Question

What is the most practical way to compute image embeddings inside walltare's
Tauri/Rust backend on Linux, on a GPU when there is one and on the CPU
otherwise? Compare runtimes and models on file size, time per image, licence
and how GPU fallback is detected. Also cover aesthetic-score heads, preference
models that learn from a few hundred Comparisons, and near-duplicate detection
with typical thresholds. Constraint from the map: embeddings run offline, with
no network at rank time.

## Recommendation (TL;DR)

- **Runtime: `ort` 2.0.0-rc.13 (ONNX Runtime 1.28) with the WebGPU execution
  provider, falling back to the CPU.** WebGPU on Linux runs over Vulkan
  through Dawn, so one build covers NVIDIA, AMD and Intel GPUs without a CUDA
  or ROCm toolkit. pyke publishes a prebuilt `x86_64-unknown-linux-gnu+webgpu`
  binary. On the test machine WebGPU was about 8-10x faster than the CPU for
  CLIP ViT-B/32 when batched. CUDA was 3x faster again, but at library scale
  that gain is seconds, and it costs a multi-gigabyte CUDA + cuDNN dependency.
- **Model: CLIP ViT-B/32 image encoder, OpenAI weights, fp16 ONNX export
  (176 MB).** It is the cheapest encoder here (8.8 image GFLOPs, against about
  35 for SigLIP B/16). The fp16 file is half the size of fp32 with identical
  output (cosine 1.0000), and it stays fast on both GPU paths, where int8
  collapses. Its 512-d embedding is the input the MIT-licensed LAION aesthetic
  predictor V1 was trained on, so an off-the-shelf aesthetic score comes for a
  512→1 dot product. The one caveat is the model card (below): OpenAI's
  weights are MIT-licensed, but the card calls any deployed use "out of scope".
  If that matters, use SigLIP 2 B/16 (Apache-2.0). It costs about 4x more on
  the CPU and has no ready-made aesthetic head.
- **Score prediction:** regress each wallpaper's Score (μ) on its embedding
  with ridge regression, trained on the wallpapers that have Comparisons. Use
  the prediction as a starting Score for wallpapers with none. Whether it
  helps is a claim for the simulation harness.
- **Near-duplicates:** two tiers. pHash (the `image_hasher` crate, same `image`
  0.25 as walltare) catches re-encodes and resizes with no model. Embedding
  cosine catches crops and colour variants. Every threshold is specific to one
  model and one precision, so calibrate on a real library before shipping.

## Runtimes

| Runtime | Version (crates.io) | CPU | GPU on Linux | Loads ONNX | Fit |
|---|---|---|---|---|---|
| `ort` (ONNX Runtime) | 2.0.0-rc.13, 2026-07-28 | yes (MLAS) | CUDA/TensorRT, MIGraphX (AMD), OpenVINO, **WebGPU (Vulkan)** | yes, full operator set | **recommended** |
| `candle` | 0.11.0, 2026-06-26 | yes (+MKL) | CUDA only (features: `cuda`, `cudnn`, `metal`, `mkl`, `accelerate`, `nccl`) | no, native Rust models (`clip`, `siglip`, `mobileclip`, `dinov2` in candle-transformers) | no AMD/Intel GPU |
| `burn` | 0.22.0-pre.4, 2026-09-22 | yes | CUDA, ROCm, Vulkan, WebGPU | via `burn-onnx` codegen, "limited set of ONNX operators" | pre-release; import coverage risk |
| `tract` | 0.23.8, 2026-09-21 | yes | CUDA, Metal | yes | no AMD/Intel GPU |
| `fastembed` | 7.1.0, 2026-09-22 | via ort | via ort (`webgpu` feature) | wraps ort | adds hf-hub downloading; ort directly is simpler |

Sources: crates.io API for versions; candle-core 0.11.0 feature list; candle
`candle-transformers/src/models` at tag 0.11.0; burn README; tract README;
fastembed-rs `Cargo.toml` and `src/models/image_embedding.rs`.

### ONNX Runtime execution providers on Linux

- **There is no Vulkan EP.** The ORT EP index lists none. Vulkan is reached
  through the **WebGPU EP**, whose docs say: "Platform: Linux, Backend used by
  Dawn: Vulkan" ([WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)).
- **The ROCm EP is gone.** "ROCm Execution Provider has been removed since
  1.23 release… Please Migrate your applications to use the MIGraphX
  Execution Provider" ([ROCm EP](https://onnxruntime.ai/docs/execution-providers/ROCm-ExecutionProvider.html)).
  `ort` has a `migraphx` feature.
- **CUDA:** ORT 1.28.x-1.30.x "require CUDA 13.0 and cuDNN 9.x"
  ([CUDA EP](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)).
  ort rc.13 "only ships CUDA 13 binaries"
  ([release notes](https://github.com/pykeio/ort/releases/tag/v2.0.0-rc.13)).

### ort prebuilt binaries for Linux x86_64 (rc.13)

From `ort-sys/build/download/dist.tsv` at tag v2.0.0-rc.13 (ORT 1.28.0):
`none` (CPU), `webgpu`, `nvrtx`, and `cuda13,tensorrt,nvrtx`. There is no
ROCm/MIGraphX prebuilt. rc.13 errors at link time "if `download-binaries` is
enabled and no binaries contain all of the requested EPs" (release notes).

`download-binaries` fetches from `cdn.pyke.io` **at build time**, into
`~/.cache/ort.pyke.io`. Nothing touches the network at run time, which
satisfies the map's rule. It does mean the Arch build (ADR 0037) needs network
access during `cargo build`, just as it already does for crates.

What building it here showed (`ort` rc.13, `default-features = false`,
features `std, download-binaries, tls-rustls, copy-dylibs, api-24, webgpu`):
ORT links statically into the binary (a 32 MB test binary), but Dawn is a
separate **`libwebgpu_dawn.so` (12 MB)** that the binary needs just to start.
`copy-dylibs` puts it next to the binary in `target/`. The package would
have to install it and set an rpath or `LD_LIBRARY_PATH`. Without it the
process fails at load time: "error while loading shared libraries:
libwebgpu_dawn.so".

### The Arch alternative: link the system ONNX Runtime

Arch `extra` ships ONNX Runtime 1.29.0 as `onnxruntime-cpu`, `-cuda`,
`-opt-cuda`, `-rocm` and `-opt-rocm`. Each has
`provides=("onnxruntime=1.29.0")` and `conflicts=("onnxruntime")`, and the ROCm
build uses `-Donnxruntime_USE_MIGRAPHX=ON`. All install
`/usr/lib/libonnxruntime.so` plus `pkgconfig/libonnxruntime.pc`. The CUDA
variant adds `libonnxruntime_providers_cuda.so` and depends on `cuda`, `cudnn`
and `nccl`. None of them builds the WebGPU EP. Sources: [package search](https://archlinux.org/packages/?q=onnxruntime),
[PKGBUILD](https://gitlab.archlinux.org/archlinux/packaging/packages/onnxruntime/-/blob/main/PKGBUILD),
[file lists](https://archlinux.org/packages/extra/x86_64/onnxruntime-cuda/files/).

So walltare's PKGBUILD could `depends=('onnxruntime')` and link it through
ort's `pkg-config` or `load-dynamic` feature. The user then picks CPU, CUDA or
ROCm by picking the package. An older `api-NN` feature can load a newer runtime:
"ort will still download the latest version of ONNX Runtime (v1.28), but it
will happily use an older version" ([multiversion](https://ort.pyke.io/setup/multiversion)).
The trade: no vendor-neutral GPU path, and the GPU variants pull in the whole
CUDA or ROCm stack. The prebuilt WebGPU binary gets a GPU with neither. Which
way to ship belongs to the map's open "shipping a model file with the Arch
install" item.

## How GPU fallback is detected (ort)

What the docs say ([ort EPs](https://ort.pyke.io/perf/execution-providers)):

- "If an EP does not support a certain operator in a graph, it will fall back
  to the next successfully registered EP, or to the CPU if all else fails."
- "ort will silently fail and fall back to executing on the CPU if all
  execution providers fail to register." `.error_on_failure()` on the EP
  turns a failed registration into an error.
- `is_available()` only reports whether ORT was *compiled* with the EP, and
  "registration could still fail".

What was measured here (Rust `ort` rc.13, WebGPU prebuilt; the Vulkan loader
was pointed at no driver with `VK_ICD_FILENAMES`/`VK_DRIVER_FILES`):

1. With `error_on_failure()`, `commit_from_file` returns `Err`: "Failed to get
   a WebGPU adapter: No supported adapters". Building a plain CPU session in the
   same process then works, at normal CPU speed. That is the fallback to use.
   A working sketch:
   ```rust
   let gpu = Session::builder()?
       .with_execution_providers([ep::WebGPU::default().build().error_on_failure()])
       .map_err(|e| e.to_string())
       .and_then(|mut b| b.commit_from_file(&path).map_err(|e| e.to_string()));
   let session = match gpu { Ok(s) => s, Err(_) => Session::builder()?.commit_from_file(&path)? };
   ```
2. Without `error_on_failure()`, the session silently ran on the CPU.
3. **In both no-GPU cases the process segfaulted at exit (status 139),** after
   `main` had returned. A CPU-only run under the same environment exited 0.
   So a failed Dawn/WebGPU initialisation leaves something that crashes
   during teardown. The trigger was an artificial one, forcing the loader to
   find no driver, and a real GPU-less machine may behave differently. Still,
   do the probe in a short-lived child process (for example `walltare
   --probe-gpu`) and cache the answer, rather than in the long-lived app
   process. It also deserves an upstream report.
4. **CUDA registers even when it can't run.** With `onnxruntime-gpu` 1.30 and
   no `libcudnn.so` on the library path, the session was created on
   `CUDAExecutionProvider`. It then failed on the first `run()`: "cuDNN is
   unavailable or disabled for CUDA Execution Provider: dlopen failed for
   libcudnn.so". A successful registration doesn't prove the GPU works. The
   probe has to run one warm-up inference before choosing the GPU.

## Models

| Model (image tower) | Licence (weights) | Image params | Image GFLOPs | Embedding | ONNX vision file fp32 / fp16 / int8 |
|---|---|---|---|---|---|
| CLIP ViT-B/32, OpenAI | MIT (repo); card: deployed use "out of scope" | 87.9 M | 8.8 | 512 | 352 / 176 / 89 MB |
| CLIP ViT-B/32, LAION-2B (OpenCLIP) | MIT; card repeats "out of scope" | 87.9 M | 8.8 | 512 | (safetensors 605 MB, text + image) |
| SigLIP B/16-224 | Apache-2.0 | 92.9 M | 35.4 | 768 | 372 / 186 / 99 MB |
| SigLIP 2 B/16-224 | Apache-2.0 | ~93 M (from the fp32 file size; 0.4 B with text) | ~35 (same ViT-B/16 as SigLIP) | 768 | 372 / 186 / 95 MB |
| DINOv2-S/14 | Apache-2.0 | ~22 M | n/a | 384 | 89 / 46 / 24 MB |
| CLIP ViT-L/14 (needed by aesthetic V2) | MIT | 304 M | 162.0 | 768 | not exported here |
| MobileCLIP / MobileCLIP2 | **apple-amlr: research only** | 11.4 M (S0) | n/a | 512 | excluded |

- Params and GFLOPs: OpenCLIP [`docs/model_profile.csv`](https://github.com/mlfoundations/open_clip/blob/main/docs/model_profile.csv).
- File sizes: Hugging Face API for `Xenova/clip-vit-base-patch32` (an export
  of `openai/clip-vit-base-patch32`), `Xenova/siglip-base-patch16-224`,
  `onnx-community/siglip2-base-patch16-224-ONNX` and
  `onnx-community/dinov2-small-ONNX`.
- OpenAI card: "**Any** deployed use case of the model - whether commercial or
  not - is currently out of scope" ([card](https://huggingface.co/openai/clip-vit-base-patch32)).
  The LAION card carries the same sentence ([card](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K)).
  The code licence is MIT ([openai/CLIP](https://github.com/openai/CLIP)).
  The sentence is guidance in the card, not a licence term. The maintainer
  should decide whether it matters for a local, non-commercial curator.
- SigLIP 2: Apache-2.0, no deployment restriction on the card
  ([card](https://huggingface.co/google/siglip2-base-patch16-224); paper
  [arXiv:2502.14786](https://arxiv.org/abs/2502.14786)).
- MobileCLIP: licensed "exclusively for Research Purposes… does not include…
  use in any commercial product or service"
  ([LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)).
  Not usable here.

### Measured time per image

The test machine: AMD Ryzen 5 7600X (6C/12T), NVIDIA RTX 3080 (driver
615.71), CUDA 13.4. It was not idle (a desktop session was running), so treat
the numbers as ±30%. Input was a random 224×224 tensor; the numbers exclude
decode and preprocessing. Each figure is the median of 10 runs at batch 1 or 4
runs at batch 16, after warm-up. CPU and WebGPU used Rust `ort` rc.13 (ORT
1.28 prebuilt); CUDA used Python `onnxruntime-gpu` 1.30 (same C++ runtime).
Cells read batch 1 / batch 16, in ms per image.

| Model | CPU | WebGPU (Vulkan) | CUDA |
|---|---|---|---|
| CLIP B/32 fp32 | 20.9 / 16.1 | 13.9 / 2.0 | 2.1 / 0.71 |
| CLIP B/32 fp16 | ~26 (b16, Python) | 6.9 / 1.65 | 1.6 / 0.36 |
| CLIP B/32 int8 | 15.1 / 10.4 | **88.6 / 23.4** | **13.1 / 11.0** |
| SigLIP 2 B/16 fp32 | 68.7 / 78.6 | 15.2 / 8.7 | 4.4 / 3.2 |
| SigLIP B/16 int8 | 80 / 87 (Python) | 132.9 / 76.5 | 39.0 / 44.7 |
| DINOv2-S fp32 | 36.4 / 27.0 | 8.9 / 3.3 | 2.3 / 1.1 |

What the table shows:

- **int8 is a CPU-only format.** It is 1.5x faster on the CPU, but 10-30x
  slower on CUDA and WebGPU than fp32 (the quantised ops fall off the GPU).
  It also moves the embedding: on 4 real screenshots the fp32 and int8
  embeddings agreed only to cosine 0.940-0.950. fp16 agreed to 1.0000.
  That drift is the size of a near-duplicate threshold, so all embeddings in
  one library must come from the same file.
- **The fp16 export takes float32 input** (`tensor(float)`) and casts
  internally, so the calling code is identical to fp32. It runs everywhere at
  near-fp32 CPU speed and full GPU speed. It is the one file to ship.
- **At library scale:** 10,000 wallpapers at CLIP B/32 cost about 3-4 min on
  the CPU, about 20 s on WebGPU and about 7 s on CUDA, before decode. SigLIP 2
  B/16 on the CPU is about 13 min.
- Batching matters on the GPU (WebGPU CLIP: 13.9 → 2.0 ms). Embed in batches
  of about 16 from the pre-generation pass, not one image per request.

### Preprocessing for wallpapers

- CLIP: resize the short edge to 224 (bicubic), centre-crop 224×224, and
  normalise with mean `[0.4815, 0.4578, 0.4082]` and std
  `[0.2686, 0.2613, 0.2758]` (`preprocessor_config.json` of the export).
  SigLIP resizes straight to 224×224 (squash, no crop) with mean and std 0.5.
- **The centre crop keeps only 56% of a 16:9 wallpaper's width.** For
  near-duplicate detection that is fine. For Score prediction the discarded
  sides may matter. Options: squash like SigLIP, or average the embeddings of
  2-3 crops (2-3x the cost). This needs testing, not a decision here.
- **Embed from the Small thumbnail (400 px wide JPEG, `thumbnails.rs`), not
  the source.** That skips the full source decode ADR 0049 has to cap and
  serialise. A 16:9 Small thumbnail is 400×225, just above 224. Wider than
  about 16:9 its short edge falls under 224, so use Medium (1920 px) for
  those.

## Aesthetic-score heads

- **LAION-Aesthetics Predictor V1** (MIT): "A linear estimator on top of clip".
  It is a 512→1 linear head for ViT-B/32 (`sa_0_4_vit_b_32_linear.pth`,
  3 KB), with 768→1 heads for L/14 and B/16. The notebook computes embeddings
  with `open_clip.create_model_and_transforms('ViT-L-14',
  pretrained='openai')`, meaning **OpenAI weights**
  ([repo](https://github.com/LAION-AI/aesthetic-predictor)). Each CLIP
  training run has its own embedding space, so the head does not transfer
  to LAION-trained OpenCLIP or SigLIP embeddings. That is the main reason to
  prefer OpenAI B/32.
- **Improved aesthetic predictor (V2)** (Apache-2.0): an MLP (768→1024→128→64→16→1
  with dropout) on `clip.load("ViT-L/14")` embeddings, L2-normalised first
  ([repo](https://github.com/christophschuhmann/improved-aesthetic-predictor),
  `simple_inference.py`). It needs ViT-L/14: 162 image GFLOPs, 18x B/32,
  which by that ratio puts it at roughly 300 ms/image on this CPU. That is an
  estimate, not a measurement. Too heavy as the default.
- Either head predicts "how much people like on average an image", not this
  curator. Use it as one input to the Score prediction (a feature, or a
  fallback when there are too few Comparisons), not as a Score. The AGPL-3.0
  `aesthetic-predictor-v2-5` is incompatible with walltare's MIT licence;
  avoid it.

## Preference model from a few hundred Comparisons

walltare already turns Comparisons into a Score (μ) with an uncertainty (σ) per
wallpaper. Two shapes fit on top of embeddings:

1. **Ridge regression of Score on embedding.** Train on the wallpapers that
   have Comparisons, weighting each by 1/σ², then predict for the rest. It
   reuses the rating the app already solved and has a closed-form solution
   (512×512 solve). The closest recent evidence: Ryu & Yanaka (2026) fit
   ridge regression on frozen features for personalised aesthetics with 10- or
   100-image support sets per user. They reached Spearman ≈ 0.59 on photos
   (PARA) and 0.57 on artworks (LAPIS), and the vision-only DINOv3 "yields
   the lowest correlations across nearly all attributes"
   ([arXiv:2604.11374](https://arxiv.org/html/2604.11374v1)). That argues for
   a language-aligned encoder (CLIP/SigLIP) over DINO for Score prediction.
   Their labels are per-image ratings, not Comparisons.
2. **Bradley-Terry on embedding differences:** P(i beats j) = σ(w·(eᵢ − eⱼ)),
   logistic regression over the Comparisons themselves (Bradley & Terry 1952,
   *Biometrika* 39:324). This uses the votes directly, but it re-derives what
   TrueSkill already did and needs an iterative solver.

With 512 dimensions and a few hundred labelled wallpapers, both need strong
L2 regularisation. A PCA to about 64 dimensions is the usual extra guard.
Pick the ridge penalty by held-out Comparison accuracy. Under `CONTEXT.md` the
output is a *prediction*, which can give an Unrated wallpaper a starting
Score. By the map's rule, any claim that this means fewer votes has to come
from the simulation harness.

## Near-duplicate detection

| Method | Catches | Typical threshold | Source |
|---|---|---|---|
| 64-bit pHash (DCT), Hamming | re-encode, resize, light blur/compression | ≤ 10 (imagededup default); T = 22 separates "same source" in pHash's own tests | [imagededup](https://idealo.github.io/imagededup/user_guide/finding_duplicates/), [pHash design](https://www.phash.org/docs/design.html) |
| CNN / CLIP embedding cosine | crops, margins, aspect changes, colour filters | ≥ 0.9 (imagededup CNN default); SemDeDup on CLIP ViT-B/16: cos ≥ 0.97 (ε = 0.03) for "the same image but with… different margins, crops, aspect ratios, and color filters", cos ≥ 0.999 for pixel-level duplicates | imagededup; [SemDeDup, arXiv:2303.09540](https://arxiv.org/html/2303.09540) |
| SSCD (copy-detection descriptor) | adversarial copies | cos > 0.75 = copy at 90% precision (its own descriptor, not CLIP) | [sscd-copy-detection](https://github.com/facebookresearch/sscd-copy-detection) (MIT; TorchScript only, no ONNX) |

- `image_hasher` 3.1.1 (MIT OR Apache-2.0) implements mean, gradient,
  DCT/pHash, blockhash and double-gradient hashes, and depends on
  `image >=0.25, <0.26`, the same `image` walltare uses
  ([docs](https://docs.rs/image_hasher/latest/image_hasher/)). Its default
  algorithm is `Gradient`; pHash needs `.preproc_dct()` with a mean or
  gradient algorithm.
- Suggested shape: pHash first (free, no model, catches the common "same file
  at another resolution" case), then CLIP cosine for the rest. Wallpaper
  collections hold many different images with near-identical composition
  (plain gradients, dark minimal scenes), so CLIP cosine at 0.9 will flag
  distinct wallpapers. Start at 0.95 or higher, and **calibrate on a real
  library** before choosing the number. The published thresholds belong to
  other models and datasets.

## Not verified / open

- **Near-duplicate thresholds on real wallpapers were not measured.** A
  calibration script was written, comparing each wallpaper's nearest
  neighbour with edited copies (400 px JPEG, 80% crop, brightness) under CLIP,
  DINOv2 and pHash. Running it on the maintainer's `~/Wallpapers` was not
  permitted in this session. The local database also had no Comparisons, so
  Score prediction could not be tried on real votes.
- AMD and Intel GPUs under WebGPU were not tested; only the RTX 3080 exposed
  a Vulkan device here. Nor was a software Vulkan driver (lavapipe), which
  WebGPU might pick up and which would be slower than ORT's CPU path.
- The exit segfault after a failed WebGPU init was reproduced only by forcing
  the Vulkan loader to find no driver.
- ViT-L/14 and the V2 aesthetic head were not timed.

## Sources

- ort docs: [execution providers](https://ort.pyke.io/perf/execution-providers), [linking](https://ort.pyke.io/setup/linking), [prebuilt binaries](https://ort.pyke.io/misc/prebuilt-binaries), [multiversion](https://ort.pyke.io/setup/multiversion); [rc.13 release notes](https://github.com/pykeio/ort/releases/tag/v2.0.0-rc.13); `Cargo.toml` and `ort-sys/build/download/dist.tsv` at tag v2.0.0-rc.13.
- ONNX Runtime docs: [EP index](https://onnxruntime.ai/docs/execution-providers/), [WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html), [ROCm EP](https://onnxruntime.ai/docs/execution-providers/ROCm-ExecutionProvider.html), [CUDA EP](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).
- Arch: [onnxruntime packages](https://archlinux.org/packages/?q=onnxruntime), [PKGBUILD](https://gitlab.archlinux.org/archlinux/packaging/packages/onnxruntime/-/blob/main/PKGBUILD), [onnxruntime-cpu files](https://archlinux.org/packages/extra/x86_64/onnxruntime-cpu/files/), [onnxruntime-cuda files](https://archlinux.org/packages/extra/x86_64/onnxruntime-cuda/files/).
- Other runtimes: [candle](https://github.com/huggingface/candle), [burn](https://github.com/tracel-ai/burn), [tract](https://github.com/sonos/tract), [fastembed-rs](https://github.com/Anush008/fastembed-rs).
- Models: [openai/clip-vit-base-patch32](https://huggingface.co/openai/clip-vit-base-patch32), [openai/CLIP](https://github.com/openai/CLIP), [laion/CLIP-ViT-B-32-laion2B-s34B-b79K](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K), [google/siglip2-base-patch16-224](https://huggingface.co/google/siglip2-base-patch16-224), [apple/ml-mobileclip LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS), [OpenCLIP model_profile.csv](https://github.com/mlfoundations/open_clip/blob/main/docs/model_profile.csv).
- Aesthetics: [LAION-AI/aesthetic-predictor](https://github.com/LAION-AI/aesthetic-predictor), [christophschuhmann/improved-aesthetic-predictor](https://github.com/christophschuhmann/improved-aesthetic-predictor).
- Preference: Bradley, R. A. & Terry, M. E. (1952), "Rank Analysis of Incomplete Block Designs: I", *Biometrika* 39(3/4):324-345; Ryu & Yanaka (2026), [arXiv:2604.11374](https://arxiv.org/abs/2604.11374).
- Duplicates: [imagededup](https://idealo.github.io/imagededup/user_guide/finding_duplicates/), [pHash design](https://www.phash.org/docs/design.html), [SemDeDup](https://arxiv.org/abs/2303.09540), [SSCD](https://github.com/facebookresearch/sscd-copy-detection), [image_hasher](https://docs.rs/image_hasher/latest/image_hasher/).
