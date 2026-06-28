# Marginalia

**A grounded literature analysis desk.** Upload research papers (PDF or pasted text) and get research summaries, research gaps, a literature matrix, theme clusters, a critical appraisal, future-work proposals, and a topic-suggestion engine — all generated **only** from the papers you provide. Every claim the app makes is tagged with a clickable citation pin back to the exact paper and page it came from.

It also includes a live paper-discovery search (via Crossref) so you can search the open literature by topic and build a reading list, separate from your private library.

![License: MIT](https://img.shields.io/badge/license-MIT-8B3A2F)
![Node](https://img.shields.io/badge/node-%3E%3D18-3D5A4A)

---

## Why this exists

Most AI summarisation tools blend in outside knowledge when they answer, which makes them unreliable for academic work. You can't tell what came from your paper and what the model already "knew" about the topic. Marginalia is built around one rule: **the model is only allowed to use the text you uploaded.** If something isn't in your papers, it says so instead of guessing.

## Features

- **Upload PDFs or paste text** — text is extracted client-side, page by page
- **Research summaries** — a structured comparison table (paper type, problem, gap addressed, dataset, features, model, results, limitations) plus a full prose summary per paper
- **Research gaps** — split into author-stated gaps and comparative gaps (visible only by reading across papers)
- **Literature matrix** — side-by-side comparison table across your whole library, exportable to CSV
- **Themes** — recurring themes clustered across the corpus
- **Critical appraisal** — a supervisor-style read on each paper's methodological strengths and weaknesses
- **Topic suggestions** — concrete next-research directions, each justified by a real gap in your specific corpus
- **Future work** — proposals tied directly to limitations the authors themselves stated
- **Ask** — a chat that answers strictly from your uploaded papers
- **Find papers** — live search against Crossref (150M+ works) with year, sort, and type filters, plus a reading list with direct links
- **Citation pins** — every generated claim links back to its source paper and page

## How grounding works

Every generation request sends the model:
1. A strict system instruction that forbids using outside knowledge and requires every claim to carry an inline marker like `[[P1:p4]]`
2. The full text of your uploaded papers, tagged by paper ID and page

Those markers are rendered in the interface as small citation pins you can click to jump straight to the source paper. This is enforced by prompting, not by a separate fact-checking pass — it is a strong default, not a mathematical guarantee. See [Limitations](#limitations) below. Full details in [docs/PROMPTING.md](docs/PROMPTING.md).

---

## Architecture

```
Browser (React app)
   │
   │  POST /api/claude  { prompt, system }
   ▼
Serverless function (api/claude.js)
   │
   │  holds GEMINI_API_KEY server-side only
   ▼
Google Gemini API (generativelanguage.googleapis.com)
```

The frontend never sees or stores your Gemini API key. It calls your own backend endpoint, which attaches the key and forwards the request. This is required because browsers cannot safely hold a secret API key — anyone could open dev tools and steal it.

Paper discovery calls Crossref's public API directly from the browser (no key required, no proxy needed).

### Why Gemini

This project uses Google's Gemini API (`gemini-2.5-flash`) because it has a genuine, ongoing free tier (roughly 1,500 requests/day as of writing) rather than a one-time trial credit. That makes it the practical choice for a personal tool you'll use occasionally over a long period without worrying about a bill. The backend is a single small file (`api/claude.js`) — swapping in a different provider later just means changing that one file's request/response shape; the frontend doesn't need to know which provider is behind it.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A free [GitHub](https://github.com) account
- A free [Vercel](https://vercel.com) account (for deployment) — Vercel signup can use your GitHub account directly
- A free [Gemini API key](https://aistudio.google.com/apikey) — sign in with a Google account, no credit card required

### 1. Get the code onto your machine

If you received this as a folder, open a terminal in that folder. Otherwise, clone it once it's on GitHub (see [Publishing to GitHub](#publishing-to-github) below):

```bash
git clone https://github.com/<your-username>/marginalia.git
cd marginalia
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API key locally

```bash
cp .env.example .env
```

Open `.env` and replace the placeholder with your real key:

```
GEMINI_API_KEY=your-real-key-here
```

This file is already listed in `.gitignore` — it will never be committed.

### 4. Run it locally

The frontend and the backend function need to run together. The simplest way:

```bash
npm install -g vercel   # one-time global install
vercel dev
```

`vercel dev` serves both the React app and the `/api/claude` function on one local server (usually `http://localhost:3000`). Open that URL in your browser.

> Alternative without the Vercel CLI: run `npm run dev` (Vite only, on port 5173) in one terminal. The "Ask" and "Generate" buttons won't work without a running `/api/claude` endpoint, but you can still preview the upload/library UI. For full functionality locally, `vercel dev` is the recommended path.

---



## Tech stack

- [React](https://react.dev/) + [Vite](https://vitejs.dev/) — frontend
- [pdf.js](https://mozilla.github.io/pdf.js/) — client-side PDF text extraction (loaded from CDN)
- [Vercel Serverless Functions](https://vercel.com/docs/functions) — backend proxy for the Gemini API key
- [Crossref REST API](https://api.crossref.org) — paper discovery (no key required)
- [Google Gemini API](https://ai.google.dev/) — analysis and generation (`gemini-2.5-flash`)

## Limitations

- **Grounding is enforced by instruction, not by a guarantee.** The model is told strictly not to use outside knowledge, and in practice this holds up well, but no LLM-based system can be mathematically guaranteed never to drift. Treat outputs as a strong first draft to verify, not a final citation-checked source.
- **Long papers may be truncated.** Each request has a context limit; very long papers or very large libraries may not fit entirely in a single call. If you hit issues with a big library, generate one component at a time rather than using "Generate all".
- **PDF extraction quality depends on the PDF.** Scanned/image-only PDFs with no embedded text layer won't extract — paste the text manually instead, or run OCR first.
- **Crossref does not have an abstract for every paper.** Some discovery results will show only title, authors, and a link.
- **Free-tier rate limits.** Gemini's free tier (used by default here) has a daily request cap. If you hit it, requests will fail until the limit resets — generating components one at a time uses fewer calls than "Generate all" at once.

## Troubleshooting

- **A feature returns a 404 from `/api/claude`** — this means the serverless function isn't deployed/registered, usually because the file was only partially edited (missing the `export default async function handler(...)` wrapper) or the latest commit wasn't actually pushed before deploying. Check the file's full contents on GitHub and confirm the deployed commit matches.
- **A feature returns a 500 with a message about a missing API key** — your environment variable name doesn't match what the code reads (`GEMINI_API_KEY`), or it wasn't added before the last deploy. Add/rename it in Vercel → Settings → Environment Variables, then redeploy.
- **PDF upload says "could not read file"** — open the browser console (right-click → Inspect → Console) and try again; the real error will now be logged there. Most often this means the PDF has no embedded text layer (it's a scanned image) — paste the text manually instead.

## Cost

Gemini's free tier (used by default) has no cost for normal personal use — see the [Why Gemini](#why-gemini) section above. There is no subscription anywhere in this stack; Vercel's free Hobby tier covers this deployment, and Gemini's free tier covers typical usage. Check current limits at [ai.google.dev/pricing](https://ai.google.dev/pricing).

## License

MIT — see [LICENSE](LICENSE). Use it, modify it, share it.
