# How grounding is enforced

This document explains exactly what is sent to the model for each feature, so the grounding claims in the main README are verifiable rather than just asserted.

## The core rule

Every single request to Claude in this app is prefixed with the same instruction (see `GROUNDING_RULE` in `src/App.jsx`):

- Only use information explicitly present in the supplied paper text
- Never use outside knowledge of the topic, even if the model "knows" the field well
- Never invent citations, numbers, authors, or findings
- If something isn't answerable from the supplied text, say so explicitly
- Tag every factual claim with an inline marker in the exact form `[[PAPERID:pXX]]`, e.g. `[[P1:p4]]`
- Never invent a paper ID that wasn't actually supplied

The "supervisor" persona (used for critical appraisal and topic suggestions) is layered on top of this same rule — the model is told it may apply judgement (e.g. "this sample size is small for this design"), but that judgement must still trace back to specific, supplied text. It is not given license to import opinions about the topic from its training data.

## How the corpus is built

When you upload a PDF, `pdf.js` extracts text page by page in the browser. When you paste text, it's chunked into ~3000-character "pages" so that page-style citations still mean something. Every request that needs paper content builds a corpus block like:

```
===== PAPER P1: "filename.pdf" =====
[Page 1]
...extracted text...

[Page 2]
...extracted text...

===== PAPER P2: "another-paper.pdf" =====
...
```

This corpus block, plus the grounding rule, plus a task-specific instruction (e.g. "build a literature matrix"), is the entire prompt. Nothing else is added.

## Per-feature prompt shape

| Feature | What's asked for | Output format |
|---|---|---|
| Summaries | 5-paragraph prose summary + one structured table row, per paper | `<SUMMARY>...</SUMMARY><ROW>{json}</ROW>` |
| Research gaps | Gaps that are either author-stated or visible by comparison | JSON array |
| Literature matrix | One row per paper across fixed fields, `"Not stated"` where absent | JSON array |
| Themes | Recurring themes with which papers fall under each | JSON array |
| Critical appraisal | Strengths and weaknesses per paper | JSON array |
| Topic suggestions | Concrete next-research directions justified by a real gap | JSON array |
| Future work | Proposals tied to stated limitations | JSON array |
| Ask | Free-text question answered only from the corpus | Plain text with inline citation markers |

JSON outputs are requested with an explicit instruction to return *only* JSON, no markdown fences or commentary — `stripFences()` in the code strips any fences defensively in case the model adds them anyway.

## What this does and doesn't guarantee

This is prompt-based grounding, not a retrieval-augmented pipeline with a verifier step. In practice, instructing a capable model this explicitly and supplying it with the actual source text produces reliably grounded output — but there is no second pass that checks every citation marker against the source text before showing it to you. If you're using this for something where citation accuracy is critical (e.g. a real systematic review for publication), spot-check the page references against the original PDFs before relying on them.
