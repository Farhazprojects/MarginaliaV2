import React, { useState, useRef, useCallback, useEffect } from "react";

/* ---------- Claude API call (via our own backend proxy at /api/claude) ---------- */
async function callClaude(prompt, system) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return text;
}

function stripFences(s) {
  return s.replace(/```json|```/g, "").trim();
}

/* ---------- Crossref discovery (real bibliographic data, no key needed) ---------- */
async function searchCrossref({ query, yearFrom, yearTo, sort, type }) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("rows", "25");
  if (sort === "date") {
    params.set("sort", "published");
    params.set("order", "desc");
  } else if (sort === "citations") {
    params.set("sort", "is-referenced-by-count");
    params.set("order", "desc");
  } // relevance = default, no sort param needed
  const filters = [];
  if (yearFrom) filters.push(`from-pub-date:${yearFrom}-01-01`);
  if (yearTo) filters.push(`until-pub-date:${yearTo}-12-31`);
  if (type === "journal-article") filters.push("type:journal-article");
  if (filters.length) params.set("filter", filters.join(","));

  const res = await fetch(`https://api.crossref.org/works?${params.toString()}`);
  if (!res.ok) throw new Error("Crossref request failed");
  const data = await res.json();
  let items = (data.message?.items || []).map((it) => ({
    doi: it.DOI,
    title: (it.title || [])[0] || "Untitled",
    authors: (it.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).join(", "),
    year: it["published-print"]?.["date-parts"]?.[0]?.[0] || it["published-online"]?.["date-parts"]?.[0]?.[0] || it.created?.["date-parts"]?.[0]?.[0] || null,
    venue: (it["container-title"] || [])[0] || "",
    citedBy: it["is-referenced-by-count"] || 0,
    type: it.type || "",
    url: it.URL,
    abstract: it.abstract ? it.abstract.replace(/<[^>]+>/g, "").trim() : "",
  }));
  if (type === "review") {
    items = items.filter((it) => /review/i.test(it.title));
  }
  return items;
}

/* ---------- PDF text extraction via pdf.js ---------- */
let pdfjsLoadPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return pdfjsLoadPromise;
}

async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    pages.push({ page: i, text });
  }
  return pages;
}

/* ---------- Export helpers ---------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsvCell(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function rowsToCsv(rows, cols) {
  const header = cols.map(([, label]) => toCsvCell(label)).join(",");
  const lines = rows.map((r) => cols.map(([k]) => toCsvCell(r[k])).join(","));
  return [header, ...lines].join("\n");
}

function stripCiteMarkers(text) {
  return String(text || "").replace(/\[\[([^\]]+)\]\]/g, (m, inner) => `[${inner.replace(":", " ")}]`);
}

/* ---------- ID helper ---------- */
let idCounter = 1;
const nextId = () => `P${idCounter++}`;

/* ---------- Icons (inline, minimal) ---------- */
const Icon = {
  pin: (props) => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M12 2a6 6 0 0 0-6 6c0 4.2 6 12 6 12s6-7.8 6-12a6 6 0 0 0-6-6z" />
      <circle cx="12" cy="8" r="2" />
    </svg>
  ),
  doc: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M7 2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v5h5" />
    </svg>
  ),
  upload: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  ),
  paste: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="6" y="4" width="12" height="17" rx="1.5" />
      <path d="M9 4V2.6A.6.6 0 0 1 9.6 2h4.8a.6.6 0 0 1 .6.6V4" />
    </svg>
  ),
  trash: (props) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
    </svg>
  ),
  spark: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  ),
  send: (props) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 11l18-8-8 18-2-8-8-2z" />
    </svg>
  ),
  check: (props) => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  gear: (props) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

/* ---------- Citation chip: the signature element ---------- */
function CitePin({ refs, papers, onJump }) {
  if (!refs || refs.length === 0) return null;
  return (
    <span className="cite-pin-group">
      {refs.map((r, i) => {
        const paper = papers.find((p) => p.id === r.paperId);
        const label = paper ? paper.shortName : r.paperId;
        return (
          <button
            key={i}
            className="cite-pin"
            onClick={() => onJump && onJump(r.paperId)}
            title={paper ? paper.title : r.paperId}
          >
            <Icon.pin />
            {label}
            {r.section ? <span className="cite-pin-sec">§{r.section}</span> : null}
          </button>
        );
      })}
    </span>
  );
}

/* Renders text containing [[P1:Intro]] or [[P1]] style markers into prose + CitePins */
function CitedText({ text, papers, onJump }) {
  if (!text) return null;
  const parts = String(text).split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[([^\]:]+)(?::([^\]]+))?\]\]$/);
        if (m) {
          return (
            <CitePin
              key={i}
              refs={[{ paperId: m[1], section: m[2] }]}
              papers={papers}
              onJump={onJump}
            />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/* ---------- Empty state ---------- */
function EmptyState({ icon, title, body }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
    </div>
  );
}

/* ---------- Main App ---------- */
export default function App() {
  const [papers, setPapers] = useState([]); // {id, title, shortName, pages:[{page,text}], fullText, status}
  const [activeTab, setActiveTab] = useState("summary");
  const [activePaperFilter, setActivePaperFilter] = useState("all");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [loadingTask, setLoadingTask] = useState(null); // string label or null
  const [error, setError] = useState(null);

  const [hasApiKey, setHasApiKey] = useState(null); // null = checking, true/false once known
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keySaveError, setKeySaveError] = useState(null);

  useEffect(() => {
    fetch("/api/has-key")
      .then((r) => (r.status === 404 ? { hasKey: true } : r.json())) // 404 = web deploy, key already set server-side
      .then((d) => {
        setHasApiKey(!!d.hasKey);
        if (!d.hasKey) setSettingsOpen(true);
      })
      .catch(() => setHasApiKey(true)); // fail open rather than blocking the whole app
  }, []);

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;
    setSavingKey(true);
    setKeySaveError(null);
    try {
      const res = await fetch("/api/set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save key");
      setHasApiKey(true);
      setApiKeyInput("");
      setSettingsOpen(false);
    } catch (e) {
      setKeySaveError(e.message);
    }
    setSavingKey(false);
  }

  const [components, setComponents] = useState({
    summary: {}, // paperId -> summary text (grounded, with section refs)
    summaryRows: null, // array of table rows (one per paper)
    gaps: null, // array
    matrix: null, // array of rows
    themes: null, // array
    future: null, // array
    appraisal: null, // array of critical appraisal entries
    topics: null, // array of suggested research topics
  });

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const fileInputRef = useRef(null);
  const scrollRefs = useRef({});

  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryFilters, setDiscoveryFilters] = useState({ yearFrom: "", yearTo: "", sort: "relevance", type: "any" });
  const [discoveryResults, setDiscoveryResults] = useState(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState(null);
  const [readingList, setReadingList] = useState([]);

  async function runDiscoverySearch() {
    if (!discoveryQuery.trim()) return;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    try {
      const results = await searchCrossref({
        query: discoveryQuery.trim(),
        yearFrom: discoveryFilters.yearFrom || null,
        yearTo: discoveryFilters.yearTo || null,
        sort: discoveryFilters.sort,
        type: discoveryFilters.type,
      });
      setDiscoveryResults(results);
    } catch (e) {
      setDiscoveryError("Search failed — Crossref may be temporarily unavailable. Try again.");
    }
    setDiscoveryLoading(false);
  }

  function addToReadingList(paper) {
    setReadingList((prev) => (prev.find((p) => p.doi === paper.doi) ? prev : [...prev, paper]));
  }
  function removeFromReadingList(doi) {
    setReadingList((prev) => prev.filter((p) => p.doi !== doi));
  }

  const corpusReady = papers.length > 0;

  /* ---- Build a grounded corpus string for prompts, paper by paper, page tagged ---- */
  function buildCorpusBlock(paperList) {
    return paperList
      .map((p) => {
        const pageBlocks = p.pages
          .map((pg) => `[Page ${pg.page}]\n${pg.text}`)
          .join("\n\n");
        return `===== PAPER ${p.id}: "${p.title}" =====\n${pageBlocks}`;
      })
      .join("\n\n");
  }

  const GROUNDING_RULE = `You act as an experienced academic supervisor and research methodologist reviewing a student's literature. You bring genuine domain judgement: you know what counts as a methodological weakness, an overclaim, a well supported result, or a real gap in a field. However, you are also a strict, grounded research analysis assistant: you may ONLY use information that is explicitly present in the supplied paper text below to make any factual claim about what a paper says, found, or did. Your supervisory judgement (e.g. "this sample size is small for this design", "this conclusion is broader than the data supports") is allowed and encouraged, but it must always be anchored to and clearly follow from the specific text supplied, never from outside knowledge of the topic. Do not invent citations, numbers, authors, findings, or papers that were not supplied. If something is not answerable from the supplied text, say so explicitly rather than guessing. Every factual claim must be traceable to a specific paper and, where possible, a page number, using inline markers in the exact form [[PAPERID:pXX]] right after the claim, e.g. "the model achieved 92% accuracy [[P1:p4]]". Use the PAPERID exactly as given (e.g. P1, P2). Never fabricate a PAPERID that wasn't provided. Output must be valid, complete, parseable as instructed — no markdown fences, no preamble, no commentary outside the requested format.`;

  /* ---------- File handling ---------- */
  async function handleFiles(fileList) {
    const allFiles = Array.from(fileList);
    const files = allFiles.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    if (files.length === 0 && allFiles.length > 0) {
      setError("That file doesn't look like a PDF. Please choose a .pdf file.");
      return;
    }

    for (const file of files) {
      const id = nextId();
      const shortName = file.name.replace(/\.pdf$/i, "").slice(0, 28);
      setPapers((prev) => [
        ...prev,
        { id, title: file.name, shortName, pages: [], fullText: "", status: "extracting" },
      ]);
      try {
        const pages = await extractPdfText(file);
        const fullText = pages.map((p) => p.text).join(" ");
        setPapers((prev) =>
          prev.map((p) => (p.id === id ? { ...p, pages, fullText, status: "ready" } : p))
        );
      } catch (e) {
        console.error("PDF extraction failed:", e);
        setPapers((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error" } : p)));
      }
    }
  }

  function addPastedPaper() {
    if (!pasteText.trim()) return;
    const id = nextId();
    const title = pasteTitle.trim() || `Pasted paper ${id}`;
    const shortName = title.slice(0, 28);
    // crude pagination by length so page refs still mean something (~3000 chars/page)
    const chunks = [];
    const text = pasteText.trim();
    const size = 3000;
    for (let i = 0; i < text.length; i += size) {
      chunks.push({ page: Math.floor(i / size) + 1, text: text.slice(i, i + size) });
    }
    setPapers((prev) => [
      ...prev,
      { id, title, shortName, pages: chunks, fullText: text, status: "ready" },
    ]);
    setPasteText("");
    setPasteTitle("");
    setPasteOpen(false);
  }

  function removePaper(id) {
    setPapers((prev) => prev.filter((p) => p.id !== id));
  }

  /* ---------- Generators ---------- */
  async function generateSummaries() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Summarising papers");
    setError(null);
    try {
      const results = {};
      const rows = [];
      for (const p of ready) {
        const prompt = `${GROUNDING_RULE}\n\nPaper to summarise:\n\n${buildCorpusBlock([p])}\n\nDo two things for this single paper.\n\nPART 1 — write a research summary in 5 short paragraphs covering: (1) research problem and motivation, (2) methodology/approach, (3) key findings/results, (4) limitations stated by the authors, (5) stated contributions. Use plain prose, no headers. Cite page-level markers [[${p.id}:pXX]] after specific claims, especially numeric results.\n\nPART 2 — output one structured table row as JSON with these exact keys: "paperType" (e.g. "Systematic review", "New model / method proposal", "Empirical study", "Case study", "Survey", "Theoretical/conceptual paper" — pick the best fit or state what it actually is if none fit), "title", "author" (as stated, or "Not stated"), "problem" (the problem the authors say they are solving), "gapAddressed" (the gap in prior literature this paper claims to address; "Not stated" if none given), "dataset" (or "Not stated"/"None — no dataset used" if applicable), "features" (key features/variables used, or "None stated" if the paper does not use features in this sense), "model" (model/method used, or "None" if not applicable), "results" (key results achieved), "limitations" (authors' own stated limitations, or "Not stated").\n\nRespond in EXACTLY this format, nothing else, no markdown fences:\n<SUMMARY>\n(part 1 prose here)\n</SUMMARY>\n<ROW>\n(part 2 JSON object here, single line)\n</ROW>`;
        const out = await callClaude(prompt);
        const summaryMatch = out.match(/<SUMMARY>([\s\S]*?)<\/SUMMARY>/);
        const rowMatch = out.match(/<ROW>([\s\S]*?)<\/ROW>/);
        results[p.id] = summaryMatch ? summaryMatch[1].trim() : out.trim();
        if (rowMatch) {
          try {
            const row = JSON.parse(stripFences(rowMatch[1].trim()));
            rows.push({ paperId: p.id, ...row });
          } catch (e) {
            rows.push({ paperId: p.id, title: p.title, error: "Could not parse table row" });
          }
        }
      }
      setComponents((c) => ({ ...c, summary: { ...c.summary, ...results }, summaryRows: rows }));
    } catch (e) {
      setError("Could not generate summaries. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateAppraisal() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Running critical appraisal");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nAs an experienced supervisor, critically appraise each paper. For each, identify real methodological or argumentative weaknesses that are visible from the text itself: e.g. small or unrepresentative sample, missing baseline comparisons, conclusions broader than the data supports, unclear methodology, lack of statistical detail, potential bias, or weak validation. Do not invent generic criticisms — every point must tie to something actually stated or actually missing in that paper's text. If a paper is methodologically solid, say so plainly rather than forcing a criticism.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"paperId":"P1","strengths":["short strength point", ...],"weaknesses":["short weakness point", ...],"refs":[{"paperId":"P1","section":"p4"}]}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, appraisal: parsed }));
    } catch (e) {
      setError("Could not run critical appraisal. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateTopics() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Suggesting research topics");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nAct as a research supervisor advising a student on what to work on next, based only on this corpus. Suggest concrete, specific research topics or thesis directions that a student could realistically pursue, each one clearly justified by a gap, limitation, or under-explored angle that genuinely exists in this corpus — not generic topics in the general field. For each, note roughly how feasible it looks given what these papers show (e.g. data availability, method maturity) and what makes it a worthwhile angle rather than a repeat of existing work.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"topic":"specific proposed topic/title","justification":"why this is a real opening, grounded in the corpus","feasibilityNote":"short note on feasibility/practicality based on what the corpus shows","refs":[{"paperId":"P1","section":"p6"}]}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, topics: parsed }));
    } catch (e) {
      setError("Could not suggest topics. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateGaps() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Identifying research gaps");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nIdentify research gaps that are EITHER (a) explicitly stated as limitations/future work by the papers' authors, OR (b) clearly visible by comparing what different papers do and do not cover against each other. Do not invent gaps unsupported by the text.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"gap": "short gap statement", "explanation": "1-2 sentence grounded explanation", "type": "stated"|"comparative", "refs": [{"paperId":"P1","section":"p4"}]}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, gaps: parsed }));
    } catch (e) {
      setError("Could not identify research gaps. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateMatrix() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Building literature matrix");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nBuild a literature matrix, one row per paper, comparing them on: author/year if stated, objective, method, dataset/sample, key findings, limitations. Use "Not stated" if the paper text does not specify a field — never invent it.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"paperId":"P1","title":"...","authorYear":"...","objective":"...","method":"...","dataset":"...","findings":"...","limitations":"..."}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, matrix: parsed }));
    } catch (e) {
      setError("Could not build the literature matrix. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateThemes() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Clustering themes");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nIdentify the major recurring themes across this set of papers based only on their content. Group papers under each theme.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"theme":"short theme name","description":"1-2 sentence grounded description of how this theme appears across papers","papers":[{"paperId":"P1","section":"p2"}]}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, themes: parsed }));
    } catch (e) {
      setError("Could not cluster themes. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateFuture() {
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setLoadingTask("Proposing future work");
    setError(null);
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nPropose future research directions. Base every proposal directly on gaps, limitations, or explicit future-work statements found in the papers — do not introduce directions unconnected to the supplied text.\n\nRespond with ONLY a JSON array, no prose, no fences. Each item: {"direction":"short proposal","rationale":"1-2 sentence grounded rationale tied to specific paper content","refs":[{"paperId":"P1","section":"p6"}]}`;
      const out = await callClaude(prompt);
      const parsed = JSON.parse(stripFences(out));
      setComponents((c) => ({ ...c, future: parsed }));
    } catch (e) {
      setError("Could not propose future work. " + e.message);
    }
    setLoadingTask(null);
  }

  async function generateAll() {
    await generateSummaries();
    await generateGaps();
    await generateMatrix();
    await generateThemes();
    await generateFuture();
    await generateAppraisal();
    await generateTopics();
  }

  /* ---------- Chat ---------- */
  async function sendChat() {
    const q = chatInput.trim();
    if (!q) return;
    const ready = papers.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setChatInput("");
    setChatMessages((m) => [...m, { role: "user", text: q }]);
    setLoadingTask("Answering");
    try {
      const prompt = `${GROUNDING_RULE}\n\nCorpus:\n\n${buildCorpusBlock(ready)}\n\nQuestion: ${q}\n\nAnswer using only the corpus above. If the answer is not contained in the corpus, say plainly that the uploaded papers do not cover this. Cite [[PAPERID:pXX]] inline after each claim.`;
      const out = await callClaude(prompt);
      setChatMessages((m) => [...m, { role: "assistant", text: out.trim() }]);
    } catch (e) {
      setChatMessages((m) => [...m, { role: "assistant", text: "Something went wrong answering that. Try again." }]);
    }
    setLoadingTask(null);
  }

  function jumpToPaper(paperId) {
    setActiveTab("library");
    setTimeout(() => {
      const el = scrollRefs.current[paperId];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  /* ---------- Render helpers ---------- */
  const readyCount = papers.filter((p) => p.status === "ready").length;
  const anyGenerated =
    Object.keys(components.summary).length > 0 ||
    components.gaps ||
    components.matrix ||
    components.themes ||
    components.future;

  return (
    <div className="app-root">
      <style>{CSS}</style>

      {/* Sidebar: paper library / card catalog */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon.pin />
          </div>
          <div style={{ flex: 1 }}>
            <div className="brand-name">Marginalia</div>
            <div className="brand-sub">grounded literature desk</div>
          </div>
          <button className="icon-btn settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <Icon.gear />
          </button>
        </div>

        <div className="add-papers">
          <button className="btn-outline" onClick={() => fileInputRef.current?.click()}>
            <Icon.upload /> Upload PDFs
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button className="btn-outline" onClick={() => setPasteOpen((v) => !v)}>
            <Icon.paste /> Paste text
          </button>
        </div>

        {pasteOpen && (
          <div className="paste-box">
            <input
              className="paste-title"
              placeholder="Paper title (optional)"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
            />
            <textarea
              className="paste-area"
              placeholder="Paste the full paper text here…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
            />
            <button className="btn-primary btn-small" onClick={addPastedPaper}>
              Add to library
            </button>
          </div>
        )}

        <div className="library-list">
          {papers.length === 0 && (
            <div className="library-empty">
              No papers yet. Upload PDFs or paste text to begin — nothing is generated until you add at least one source.
            </div>
          )}
          {papers.map((p) => (
            <div className="library-item" key={p.id} ref={(el) => (scrollRefs.current[p.id] = el)}>
              <div className="library-item-top">
                <span className="library-id">{p.id}</span>
                <span className="library-title" title={p.title}>
                  {p.title}
                </span>
                <button className="icon-btn" onClick={() => removePaper(p.id)} title="Remove">
                  <Icon.trash />
                </button>
              </div>
              <div className="library-status">
                {p.status === "extracting" && <span className="status extracting">Extracting text…</span>}
                {p.status === "ready" && (
                  <span className="status ready">
                    <Icon.check /> {p.pages.length} page{p.pages.length !== 1 ? "s" : ""} indexed
                  </span>
                )}
                {p.status === "error" && <span className="status err">Could not read file</span>}
              </div>
            </div>
          ))}
        </div>

        {readyCount > 0 && (
          <button className="btn-primary generate-all" onClick={generateAll} disabled={!!loadingTask}>
            <Icon.spark /> {anyGenerated ? "Regenerate all components" : "Generate all components"}
          </button>
        )}

        <div className="ground-note">
          Every claim here is pinned to a source paper and page. Nothing is added from outside the uploaded text.
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <nav className="tabs">
          {[
            ["summary", "Summaries"],
            ["gaps", "Research gaps"],
            ["matrix", "Literature matrix"],
            ["themes", "Themes"],
            ["appraisal", "Critical appraisal"],
            ["topics", "Topic suggestions"],
            ["future", "Future work"],
            ["ask", "Ask"],
            ["discovery", "Find papers"],
            ["library", "Library"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={"tab" + (activeTab === key ? " tab-active" : "")}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {loadingTask && (
          <div className="loading-strip">
            <span className="spinner" /> {loadingTask}…
          </div>
        )}
        {error && <div className="error-strip">{error}</div>}

        <div className="panel">
          {!corpusReady && activeTab !== "library" && activeTab !== "discovery" && (
            <EmptyState
              icon={<Icon.doc />}
              title="No papers in the library yet"
              body="Upload one or more PDFs, or paste text, from the panel on the left. Every component on this page is built strictly from what you add — nothing here is invented."
            />
          )}

          {corpusReady && activeTab === "summary" && (
            <SummaryPanel papers={papers} summaries={components.summary} rows={components.summaryRows} onGenerate={generateSummaries} onJump={jumpToPaper} loading={loadingTask === "Summarising papers"} />
          )}

          {corpusReady && activeTab === "gaps" && (
            <GapsPanel gaps={components.gaps} papers={papers} onGenerate={generateGaps} onJump={jumpToPaper} loading={loadingTask === "Identifying research gaps"} />
          )}

          {corpusReady && activeTab === "matrix" && (
            <MatrixPanel matrix={components.matrix} onGenerate={generateMatrix} loading={loadingTask === "Building literature matrix"} />
          )}

          {corpusReady && activeTab === "themes" && (
            <ThemesPanel themes={components.themes} papers={papers} onGenerate={generateThemes} onJump={jumpToPaper} loading={loadingTask === "Clustering themes"} />
          )}

          {corpusReady && activeTab === "appraisal" && (
            <AppraisalPanel appraisal={components.appraisal} papers={papers} onGenerate={generateAppraisal} onJump={jumpToPaper} loading={loadingTask === "Running critical appraisal"} />
          )}

          {corpusReady && activeTab === "topics" && (
            <TopicsPanel topics={components.topics} papers={papers} onGenerate={generateTopics} onJump={jumpToPaper} loading={loadingTask === "Suggesting research topics"} />
          )}

          {corpusReady && activeTab === "future" && (
            <FuturePanel future={components.future} papers={papers} onGenerate={generateFuture} onJump={jumpToPaper} loading={loadingTask === "Proposing future work"} />
          )}

          {corpusReady && activeTab === "ask" && (
            <AskPanel
              papers={papers}
              messages={chatMessages}
              input={chatInput}
              setInput={setChatInput}
              onSend={sendChat}
              onJump={jumpToPaper}
              loading={loadingTask === "Answering"}
            />
          )}

          {activeTab === "discovery" && (
            <DiscoveryPanel
              query={discoveryQuery}
              setQuery={setDiscoveryQuery}
              filters={discoveryFilters}
              setFilters={setDiscoveryFilters}
              results={discoveryResults}
              loading={discoveryLoading}
              error={discoveryError}
              onSearch={runDiscoverySearch}
              readingList={readingList}
              onAdd={addToReadingList}
              onRemove={removeFromReadingList}
            />
          )}

          {activeTab === "library" && <LibraryDetailPanel papers={papers} scrollRefs={scrollRefs} />}
        </div>
      </main>

      {settingsOpen && (
        <SettingsModal
          apiKeyInput={apiKeyInput}
          setApiKeyInput={setApiKeyInput}
          onSave={saveApiKey}
          saving={savingKey}
          error={keySaveError}
          canDismiss={hasApiKey === true}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SettingsModal({ apiKeyInput, setApiKeyInput, onSave, saving, error, canDismiss, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-title">
          {canDismiss ? "Settings" : "Add your Gemini API key"}
        </div>
        <div className="modal-sub">
          {canDismiss
            ? "Update the API key used for generation. It's stored locally on this Mac, never sent anywhere except directly to Google."
            : "Marginalia needs your own free Gemini API key to generate summaries, gaps, and the rest. It's stored locally on this Mac only — never uploaded or shared."}
        </div>
        <input
          className="modal-input"
          type="password"
          placeholder="AIza..."
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          autoFocus
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          {canDismiss && (
            <button className="btn-outline btn-small" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn-primary btn-small" onClick={onSave} disabled={saving || !apiKeyInput.trim()}>
            {saving ? "Saving…" : "Save key"}
          </button>
        </div>
        <a
          className="modal-link"
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get a free API key from aistudio.google.com →
        </a>
      </div>
    </div>
  );
}

/* ---------- Panels ---------- */

function PanelHeader({ title, sub, onGenerate, loading, hasContent }) {
  return (
    <div className="panel-header">
      <div>
        <div className="panel-title">{title}</div>
        <div className="panel-sub">{sub}</div>
      </div>
      <button className="btn-primary btn-small" onClick={onGenerate} disabled={loading}>
        <Icon.spark /> {hasContent ? "Regenerate" : "Generate"}
      </button>
    </div>
  );
}

const SUMMARY_TABLE_COLS = [
  ["paperId", "ID"],
  ["paperType", "Paper Type"],
  ["title", "Title"],
  ["author", "Author"],
  ["problem", "Problem Solved"],
  ["gapAddressed", "Gap Addressed"],
  ["dataset", "Dataset"],
  ["features", "Features"],
  ["model", "Model"],
  ["results", "Results"],
  ["limitations", "Limitations"],
];

function SummaryPanel({ papers, summaries, rows, onGenerate, onJump, loading }) {
  const ready = papers.filter((p) => p.status === "ready");
  const has = Object.keys(summaries).length > 0;

  function exportCsv() {
    if (!rows) return;
    downloadFile("summary-table.csv", rowsToCsv(rows, SUMMARY_TABLE_COLS), "text/csv");
  }
  function exportMarkdown() {
    const parts = ready.map((p) => {
      const row = (rows || []).find((r) => r.paperId === p.id);
      const head = row
        ? `### ${p.id} — ${row.title || p.title}\n\n| Field | Value |\n|---|---|\n` +
          SUMMARY_TABLE_COLS.filter(([k]) => k !== "paperId" && k !== "title")
            .map(([k, label]) => `| ${label} | ${(row[k] || "—").toString().replace(/\|/g, "/")} |`)
            .join("\n")
        : `### ${p.id} — ${p.title}`;
      const prose = summaries[p.id] ? `\n\n${stripCiteMarkers(summaries[p.id])}` : "";
      return `${head}${prose}`;
    });
    downloadFile("summaries.md", parts.join("\n\n---\n\n"), "text/markdown");
  }

  return (
    <div>
      <PanelHeader
        title="Research summaries"
        sub="A comparison table per paper, plus a full grounded summary below — problem, method, findings, limitations, contributions."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={has}
      />

      {has && (
        <div className="export-row">
          <button className="btn-outline btn-small" onClick={exportCsv} disabled={!rows}>Export table CSV</button>
          <button className="btn-outline btn-small" onClick={exportMarkdown}>Export summaries Markdown</button>
        </div>
      )}

      {!has && !loading && (
        <EmptyState icon={<Icon.doc />} title="No summaries yet" body="Click Generate to summarise each paper in your library, strictly from its own text." />
      )}

      {rows && rows.length > 0 && (
        <div className="matrix-scroll" style={{ marginBottom: 28 }}>
          <table className="matrix-table">
            <thead>
              <tr>
                {SUMMARY_TABLE_COLS.map(([k, label]) => (
                  <th key={k}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {SUMMARY_TABLE_COLS.map(([k]) => (
                    <td key={k} className={k === "paperId" ? "matrix-id" : ""}>
                      {row[k] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="summary-list">
        {ready.map((p) =>
          summaries[p.id] ? (
            <div className="summary-card" key={p.id}>
              <div className="summary-card-head">
                <span className="cite-pin static">
                  <Icon.pin /> {p.id}
                </span>
                <span className="summary-card-title">{p.title}</span>
              </div>
              <p className="summary-text">
                <CitedText text={summaries[p.id]} papers={papers} onJump={onJump} />
              </p>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

function GapsPanel({ gaps, papers, onGenerate, onJump, loading }) {
  return (
    <div>
      <PanelHeader
        title="Research gaps"
        sub="Gaps explicitly stated by authors, or visible by comparing papers against each other."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!gaps}
      />
      {!gaps && !loading && (
        <EmptyState icon={<Icon.doc />} title="No gaps identified yet" body="Click Generate to surface gaps grounded in your uploaded papers." />
      )}
      <div className="gap-list">
        {(gaps || []).map((g, i) => (
          <div className="gap-card" key={i}>
            <div className="gap-card-top">
              <span className={"gap-type " + g.type}>{g.type === "stated" ? "Author-stated" : "Comparative"}</span>
              <CitePin refs={g.refs} papers={papers} onJump={onJump} />
            </div>
            <div className="gap-title">{g.gap}</div>
            <div className="gap-explanation">{g.explanation}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixPanel({ matrix, onGenerate, loading }) {
  const cols = [
    ["paperId", "ID"],
    ["authorYear", "Author / Year"],
    ["objective", "Objective"],
    ["method", "Method"],
    ["dataset", "Dataset / Sample"],
    ["findings", "Key Findings"],
    ["limitations", "Limitations"],
  ];
  return (
    <div>
      <PanelHeader
        title="Literature matrix"
        sub="Side-by-side comparison across all papers. 'Not stated' means the paper text does not specify that field."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!matrix}
      />
      {!matrix && !loading && (
        <EmptyState icon={<Icon.doc />} title="No matrix yet" body="Click Generate to build a comparison table across all papers in your library." />
      )}
      {matrix && (
        <div className="export-row">
          <button className="btn-outline btn-small" onClick={() => downloadFile("literature-matrix.csv", rowsToCsv(matrix, cols), "text/csv")}>
            Export CSV
          </button>
        </div>
      )}
      {matrix && (
        <div className="matrix-scroll">          <table className="matrix-table">
            <thead>
              <tr>
                {cols.map(([k, label]) => (
                  <th key={k}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => (
                <tr key={i}>
                  {cols.map(([k]) => (
                    <td key={k} className={k === "paperId" ? "matrix-id" : ""}>
                      {row[k] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ThemesPanel({ themes, papers, onGenerate, onJump, loading }) {
  return (
    <div>
      <PanelHeader
        title="Literature themes"
        sub="Recurring themes clustered from across the uploaded papers."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!themes}
      />
      {!themes && !loading && (
        <EmptyState icon={<Icon.doc />} title="No themes yet" body="Click Generate to cluster recurring themes across your library." />
      )}
      <div className="theme-grid">
        {(themes || []).map((t, i) => (
          <div className="theme-card" key={i}>
            <div className="theme-name">{t.theme}</div>
            <div className="theme-desc">{t.description}</div>
            <div className="theme-papers">
              <CitePin refs={t.papers} papers={papers} onJump={onJump} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FuturePanel({ future, papers, onGenerate, onJump, loading }) {
  return (
    <div>
      <PanelHeader
        title="Proposed future work"
        sub="Directions tied directly to gaps and limitations named in the papers."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!future}
      />
      {!future && !loading && (
        <EmptyState icon={<Icon.doc />} title="No proposals yet" body="Click Generate to propose future work grounded in your papers' own limitations and stated next steps." />
      )}
      <div className="future-list">
        {(future || []).map((f, i) => (
          <div className="future-card" key={i}>
            <div className="future-num">{String(i + 1).padStart(2, "0")}</div>
            <div className="future-body">
              <div className="future-direction">{f.direction}</div>
              <div className="future-rationale">{f.rationale}</div>
              <CitePin refs={f.refs} papers={papers} onJump={onJump} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AppraisalPanel({ appraisal, papers, onGenerate, onJump, loading }) {
  return (
    <div>
      <PanelHeader
        title="Critical appraisal"
        sub="A supervisor's read on each paper's methodological strengths and weaknesses, grounded in its own text."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!appraisal}
      />
      {!appraisal && !loading && (
        <EmptyState icon={<Icon.doc />} title="No appraisal yet" body="Click Generate for a grounded critique of each paper's methodology and claims." />
      )}
      <div className="appraisal-list">
        {(appraisal || []).map((a, i) => {
          const paper = papers.find((p) => p.id === a.paperId);
          return (
            <div className="appraisal-card" key={i}>
              <div className="appraisal-head">
                <span className="cite-pin static"><Icon.pin /> {a.paperId}</span>
                <span className="appraisal-title">{paper ? paper.title : a.paperId}</span>
              </div>
              <div className="appraisal-cols">
                <div className="appraisal-col">
                  <div className="appraisal-col-label strength">Strengths</div>
                  <ul>{(a.strengths || []).map((s, j) => <li key={j}>{s}</li>)}</ul>
                </div>
                <div className="appraisal-col">
                  <div className="appraisal-col-label weakness">Weaknesses</div>
                  <ul>{(a.weaknesses || []).map((w, j) => <li key={j}>{w}</li>)}</ul>
                </div>
              </div>
              <CitePin refs={a.refs} papers={papers} onJump={onJump} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopicsPanel({ topics, papers, onGenerate, onJump, loading }) {
  return (
    <div>
      <PanelHeader
        title="Topic suggestions"
        sub="Supervisor-style suggestions for what to work on next — each one tied to a real opening in your corpus."
        onGenerate={onGenerate}
        loading={loading}
        hasContent={!!topics}
      />
      {!topics && !loading && (
        <EmptyState icon={<Icon.doc />} title="No suggestions yet" body="Click Generate for thesis/research directions grounded in the gaps and limitations of your library." />
      )}
      <div className="topics-list">
        {(topics || []).map((t, i) => (
          <div className="topic-card" key={i}>
            <div className="topic-name">{t.topic}</div>
            <div className="topic-justification">{t.justification}</div>
            <div className="topic-feasibility"><strong>Feasibility:</strong> {t.feasibilityNote}</div>
            <CitePin refs={t.refs} papers={papers} onJump={onJump} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscoveryPanel({ query, setQuery, filters, setFilters, results, loading, error, onSearch, readingList, onAdd, onRemove }) {
  return (
    <div>
      <div className="panel-header">
        <div>
          <div className="panel-title">Find papers</div>
          <div className="panel-sub">Searches live bibliographic data from Crossref (150M+ works) by topic. This is real, separate from your uploaded library — nothing here is invented.</div>
        </div>
      </div>

      <div className="discovery-search-row">
        <input
          className="chat-input"
          placeholder="Enter a topic, e.g. explainable AI phishing detection"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
        />
        <button className="btn-primary btn-small" onClick={onSearch} disabled={loading || !query.trim()}>
          {loading ? <span className="spinner" /> : <Icon.send />}
        </button>
      </div>

      <div className="discovery-filters">
        <label>
          From year
          <input type="number" placeholder="e.g. 2018" value={filters.yearFrom} onChange={(e) => setFilters((f) => ({ ...f, yearFrom: e.target.value }))} />
        </label>
        <label>
          To year
          <input type="number" placeholder="e.g. 2026" value={filters.yearTo} onChange={(e) => setFilters((f) => ({ ...f, yearTo: e.target.value }))} />
        </label>
        <label>
          Sort by
          <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
            <option value="relevance">Relevance</option>
            <option value="date">Most recent</option>
            <option value="citations">Most cited</option>
          </select>
        </label>
        <label>
          Type
          <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="any">Any</option>
            <option value="journal-article">Journal article</option>
            <option value="review">Review (title match)</option>
          </select>
        </label>
      </div>

      {error && <div className="error-strip" style={{ margin: "12px 0", borderRadius: 8 }}>{error}</div>}

      {!results && !loading && (
        <EmptyState icon={<Icon.doc />} title="Search for a topic" body="Try something specific, like a method plus a domain — e.g. “transformer models crop disease detection”." />
      )}

      <div className="discovery-grid">
        {(results || []).map((r) => {
          const inList = readingList.find((p) => p.doi === r.doi);
          return (
            <div className="discovery-card" key={r.doi || r.title}>
              <div className="discovery-card-title">{r.title}</div>
              <div className="discovery-card-meta">
                {r.authors || "Authors not listed"} {r.year ? `· ${r.year}` : ""} {r.venue ? `· ${r.venue}` : ""}
              </div>
              {r.abstract && <div className="discovery-card-abstract">{r.abstract.slice(0, 220)}{r.abstract.length > 220 ? "…" : ""}</div>}
              <div className="discovery-card-foot">
                <span className="discovery-cited">{r.citedBy} citations</span>
                <div className="discovery-card-actions">
                  {r.url && <a className="btn-outline btn-small" href={r.url} target="_blank" rel="noopener noreferrer">Open / download</a>}
                  <button
                    className={"btn-primary btn-small" + (inList ? " in-list" : "")}
                    onClick={() => (inList ? onRemove(r.doi) : onAdd(r))}
                  >
                    {inList ? "In reading list ✓" : "Add to reading list"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {readingList.length > 0 && (
        <div className="reading-list-section">
          <div className="panel-title" style={{ fontSize: 17, marginBottom: 10 }}>Reading list ({readingList.length})</div>
          <div className="reading-list">
            {readingList.map((p) => (
              <div className="reading-item" key={p.doi}>
                <div className="reading-item-text">
                  <div className="reading-item-title">{p.title}</div>
                  <div className="reading-item-meta">{p.authors || "Authors not listed"} {p.year ? `· ${p.year}` : ""}</div>
                </div>
                <div className="reading-item-actions">
                  {p.url && <a className="btn-outline btn-small" href={p.url} target="_blank" rel="noopener noreferrer">Open</a>}
                  <button className="icon-btn" onClick={() => onRemove(p.doi)} title="Remove"><Icon.trash /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AskPanel({ papers, messages, input, setInput, onSend, onJump, loading }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  return (
    <div className="ask-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Ask the library</div>
          <div className="panel-sub">Answers come only from your uploaded papers. If it's not in there, you'll be told plainly.</div>
        </div>
      </div>
      <div className="chat-window">
        {messages.length === 0 && (
          <EmptyState icon={<Icon.doc />} title="Ask anything about your papers" body="Try: “What methods did P1 and P2 use?” or “Do any papers report sample size?”" />
        )}
        {messages.map((m, i) => (
          <div key={i} className={"chat-msg " + m.role}>
            <div className="chat-msg-role">{m.role === "user" ? "You" : "Marginalia"}</div>
            <div className="chat-msg-text">
              <CitedText text={m.text} papers={papers} onJump={onJump} />
            </div>
          </div>
        ))}
        {loading && <div className="chat-msg assistant"><div className="chat-msg-role">Marginalia</div><div className="chat-msg-text"><span className="spinner" /> reading the papers…</div></div>}
        <div ref={endRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Ask a question grounded in your papers…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
        />
        <button className="btn-primary btn-small" onClick={onSend} disabled={loading || !input.trim()}>
          <Icon.send />
        </button>
      </div>
    </div>
  );
}

function LibraryDetailPanel({ papers, scrollRefs }) {
  if (papers.length === 0) {
    return <EmptyState icon={<Icon.doc />} title="Library is empty" body="Add PDFs or pasted text from the left panel." />;
  }
  return (
    <div>
      <div className="panel-header">
        <div>
          <div className="panel-title">Library</div>
          <div className="panel-sub">Every source currently indexed for analysis.</div>
        </div>
      </div>
      <div className="lib-detail-list">
        {papers.map((p) => (
          <div className="lib-detail-card" key={p.id} ref={(el) => (scrollRefs.current[p.id] = el)}>
            <div className="lib-detail-head">
              <span className="cite-pin static"><Icon.pin /> {p.id}</span>
              <span className="lib-detail-title">{p.title}</span>
              <span className={"status " + p.status}>{p.status === "ready" ? `${p.pages.length} pages` : p.status}</span>
            </div>
            {p.status === "ready" && (
              <div className="lib-detail-preview">{p.fullText.slice(0, 400)}…</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- CSS (design tokens applied) ---------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root{
  --bg:#FAF8F3;
  --ink:#1C1B19;
  --terracotta:#8B3A2F;
  --green:#3D5A4A;
  --rule:#D8D2C4;
  --muted:#6B6862;
  --card:#FFFFFF;
}
*{box-sizing:border-box;}
.app-root{
  display:flex;
  min-height:100vh;
  background:var(--bg);
  color:var(--ink);
  font-family:'Inter',sans-serif;
}

/* Sidebar */
.sidebar{
  width:300px;
  min-width:300px;
  border-right:1px solid var(--rule);
  padding:20px 16px;
  display:flex;
  flex-direction:column;
  gap:14px;
  background:var(--bg);
}
.brand{display:flex;align-items:center;gap:10px;}
.brand-mark{
  width:32px;height:32px;border-radius:6px;
  background:var(--terracotta);color:#fff;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
}
.brand-name{font-family:'Source Serif 4',serif;font-weight:700;font-size:18px;line-height:1.1;}
.brand-sub{font-size:11px;color:var(--muted);letter-spacing:.02em;}

.add-papers{display:flex;gap:8px;}
.btn-outline{
  flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
  border:1px solid var(--rule);background:var(--card);color:var(--ink);
  padding:8px 10px;border-radius:7px;font-size:12.5px;font-weight:500;cursor:pointer;
  transition:border-color .15s,background .15s;
}
.btn-outline:hover{border-color:var(--terracotta);background:#FFF8F5;}

.paste-box{display:flex;flex-direction:column;gap:6px;background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:10px;}
.paste-title{border:1px solid var(--rule);border-radius:5px;padding:6px 8px;font-size:12.5px;font-family:'Inter';}
.paste-area{border:1px solid var(--rule);border-radius:5px;padding:6px 8px;font-size:12.5px;font-family:'JetBrains Mono',monospace;resize:vertical;}

.library-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;min-height:80px;}
.library-empty{font-size:12px;color:var(--muted);line-height:1.5;padding:14px 4px;border:1px dashed var(--rule);border-radius:8px;}
.library-item{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:9px 10px;}
.library-item-top{display:flex;align-items:center;gap:6px;}
.library-id{font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--ink);color:var(--bg);padding:1px 5px;border-radius:4px;flex-shrink:0;}
.library-title{flex:1;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.icon-btn{background:none;border:none;color:var(--muted);cursor:pointer;padding:2px;display:flex;}
.icon-btn:hover{color:var(--terracotta);}
.library-status{margin-top:4px;}
.status{font-size:11px;display:inline-flex;align-items:center;gap:4px;color:var(--muted);}
.status.ready{color:var(--green);}
.status.err{color:var(--terracotta);}

.generate-all{width:100%;}

.ground-note{font-size:11px;color:var(--muted);line-height:1.5;border-top:1px solid var(--rule);padding-top:12px;}

/* Buttons */
.btn-primary{
  display:flex;align-items:center;justify-content:center;gap:6px;
  background:var(--ink);color:var(--bg);border:none;border-radius:7px;
  padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;
  transition:background .15s;
}
.btn-primary:hover{background:var(--terracotta);}
.btn-primary:disabled{opacity:.5;cursor:default;}
.btn-small{padding:7px 12px;font-size:12.5px;}

/* Main */
.main{flex:1;display:flex;flex-direction:column;min-width:0;}
.tabs{display:flex;gap:2px;padding:14px 24px 0;border-bottom:1px solid var(--rule);overflow-x:auto;}
.tab{
  background:none;border:none;padding:10px 14px;font-size:13px;font-weight:500;
  color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;
}
.tab:hover{color:var(--ink);}
.tab-active{color:var(--ink);border-bottom-color:var(--terracotta);font-weight:600;}

.loading-strip{
  display:flex;align-items:center;gap:8px;padding:8px 24px;background:#FFF8F5;
  font-size:12.5px;color:var(--terracotta);border-bottom:1px solid var(--rule);
}
.error-strip{padding:8px 24px;background:#FCEFEC;color:var(--terracotta);font-size:12.5px;border-bottom:1px solid var(--rule);}

.spinner{
  width:13px;height:13px;border-radius:50%;
  border:2px solid var(--rule);border-top-color:var(--terracotta);
  animation:spin .7s linear infinite;display:inline-block;
}
@keyframes spin{to{transform:rotate(360deg);}}

.panel{flex:1;overflow-y:auto;padding:24px 28px 48px;}

.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;}
.panel-title{font-family:'Source Serif 4',serif;font-weight:700;font-size:22px;}
.panel-sub{font-size:13px;color:var(--muted);margin-top:3px;max-width:520px;line-height:1.5;}

.empty-state{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:60px 20px;color:var(--muted);max-width:420px;margin:0 auto;}
.empty-icon{color:var(--rule);margin-bottom:4px;}
.empty-title{font-family:'Source Serif 4',serif;font-weight:600;font-size:16px;color:var(--ink);}
.empty-body{font-size:13px;line-height:1.6;}

/* Citation pin — signature element */
.cite-pin-group{display:inline-flex;gap:4px;flex-wrap:wrap;vertical-align:middle;}
.cite-pin{
  display:inline-flex;align-items:center;gap:3px;
  font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:500;
  background:#F1ECE3;color:var(--green);border:1px solid var(--rule);
  border-radius:10px;padding:1px 7px 1px 5px;cursor:pointer;
  transform:translateY(-1px);
}
.cite-pin:hover{background:var(--green);color:#fff;border-color:var(--green);}
.cite-pin.static{cursor:default;background:var(--ink);color:var(--bg);border-color:var(--ink);}
.cite-pin-sec{opacity:.75;margin-left:2px;}

/* Summary */
.summary-list{display:flex;flex-direction:column;gap:14px;}
.summary-card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:18px 20px;}
.summary-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.summary-card-title{font-weight:600;font-size:14px;}
.summary-text{font-size:13.5px;line-height:1.75;white-space:pre-wrap;}

/* Gaps */
.gap-list{display:flex;flex-direction:column;gap:12px;}
.gap-card{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--terracotta);border-radius:8px;padding:14px 16px;}
.gap-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;}
.gap-type{font-size:10.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--terracotta);}
.gap-type.comparative{color:var(--green);}
.gap-title{font-weight:600;font-size:14px;margin-bottom:4px;}
.gap-explanation{font-size:13px;color:var(--muted);line-height:1.6;}

/* Matrix */
.matrix-scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:8px;}
.matrix-table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--card);}
.matrix-table th{
  text-align:left;font-family:'Source Serif 4',serif;font-weight:600;
  background:#F1ECE3;padding:10px 12px;border-bottom:1px solid var(--rule);white-space:nowrap;
}
.matrix-table td{padding:10px 12px;border-bottom:1px solid var(--rule);vertical-align:top;max-width:220px;line-height:1.5;}
.matrix-table tr:last-child td{border-bottom:none;}
.matrix-id{font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--green);}

/* Themes */
.theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
.theme-card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:16px;}
.theme-name{font-family:'Source Serif 4',serif;font-weight:700;font-size:15px;margin-bottom:6px;}
.theme-desc{font-size:12.5px;color:var(--muted);line-height:1.55;margin-bottom:10px;}

/* Future work */
.future-list{display:flex;flex-direction:column;}
.future-card{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--rule);}
.future-card:last-child{border-bottom:none;}
.future-num{font-family:'JetBrains Mono',monospace;color:var(--rule);font-size:22px;font-weight:600;flex-shrink:0;}
.future-direction{font-weight:600;font-size:14.5px;margin-bottom:4px;}
.future-rationale{font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:8px;}

/* Ask */
.ask-panel{display:flex;flex-direction:column;height:100%;}
.chat-window{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding:4px 0 16px;min-height:200px;}
.chat-msg{max-width:680px;}
.chat-msg.user{align-self:flex-end;}
.chat-msg-role{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;}
.chat-msg.user .chat-msg-role{text-align:right;}
.chat-msg-text{
  font-size:13.5px;line-height:1.7;padding:10px 14px;border-radius:10px;
  background:var(--card);border:1px solid var(--rule);
}
.chat-msg.user .chat-msg-text{background:var(--ink);color:var(--bg);border-color:var(--ink);}
.chat-input-row{display:flex;gap:8px;border-top:1px solid var(--rule);padding-top:14px;}
.chat-input{flex:1;border:1px solid var(--rule);border-radius:8px;padding:10px 14px;font-size:13.5px;font-family:'Inter';}
.chat-input:focus{outline:2px solid var(--terracotta);outline-offset:-1px;}

/* Library detail */
.lib-detail-list{display:flex;flex-direction:column;gap:12px;}
.lib-detail-card{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:14px 16px;}
.lib-detail-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.lib-detail-title{font-weight:600;font-size:13.5px;flex:1;}
.lib-detail-preview{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;line-height:1.6;}

/* Exports */
.export-row{display:flex;gap:8px;margin-bottom:16px;}

/* Appraisal */
.appraisal-list{display:flex;flex-direction:column;gap:14px;}
.appraisal-card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:16px 18px;}
.appraisal-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;}
.appraisal-title{font-weight:600;font-size:14px;}
.appraisal-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:10px;}
.appraisal-col-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;}
.appraisal-col-label.strength{color:var(--green);}
.appraisal-col-label.weakness{color:var(--terracotta);}
.appraisal-col ul{margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:var(--ink);}
@media (max-width:600px){.appraisal-cols{grid-template-columns:1fr;}}

/* Topics */
.topics-list{display:flex;flex-direction:column;gap:12px;}
.topic-card{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--green);border-radius:8px;padding:14px 16px;}
.topic-name{font-family:'Source Serif 4',serif;font-weight:700;font-size:15px;margin-bottom:6px;}
.topic-justification{font-size:13px;line-height:1.6;margin-bottom:6px;}
.topic-feasibility{font-size:12.5px;color:var(--muted);line-height:1.6;margin-bottom:8px;}

/* Discovery */
.discovery-search-row{display:flex;gap:8px;margin-bottom:14px;}
.discovery-filters{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid var(--rule);}
.discovery-filters label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--muted);font-weight:500;}
.discovery-filters input,.discovery-filters select{
  border:1px solid var(--rule);border-radius:6px;padding:6px 8px;font-size:12.5px;font-family:'Inter';width:120px;
}
.discovery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:30px;}
.discovery-card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:16px;display:flex;flex-direction:column;}
.discovery-card-title{font-family:'Source Serif 4',serif;font-weight:600;font-size:14.5px;line-height:1.4;margin-bottom:6px;}
.discovery-card-meta{font-size:11.5px;color:var(--muted);margin-bottom:8px;}
.discovery-card-abstract{font-size:12.5px;line-height:1.55;color:var(--ink);margin-bottom:12px;flex:1;}
.discovery-card-foot{display:flex;flex-direction:column;gap:8px;margin-top:auto;}
.discovery-cited{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--green);}
.discovery-card-actions{display:flex;gap:6px;flex-wrap:wrap;}
.btn-primary.in-list{background:var(--green);}

.reading-list-section{border-top:1px solid var(--rule);padding-top:18px;}
.reading-list{display:flex;flex-direction:column;gap:8px;}
.reading-item{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:10px 14px;}
.reading-item-title{font-size:13px;font-weight:600;}
.reading-item-meta{font-size:11.5px;color:var(--muted);margin-top:2px;}
.reading-item-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}

.settings-btn{flex-shrink:0;}

/* Settings modal */
.modal-overlay{
  position:fixed;inset:0;background:rgba(28,27,25,0.45);
  display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;
}
.modal-card{
  background:var(--card);border-radius:12px;padding:26px 28px;max-width:420px;width:100%;
  box-shadow:0 20px 60px rgba(0,0,0,0.25);
}
.modal-title{font-family:'Source Serif 4',serif;font-weight:700;font-size:18px;margin-bottom:8px;}
.modal-sub{font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:16px;}
.modal-input{
  width:100%;border:1px solid var(--rule);border-radius:8px;padding:10px 12px;
  font-size:13.5px;font-family:'JetBrains Mono',monospace;margin-bottom:10px;
}
.modal-input:focus{outline:2px solid var(--terracotta);outline-offset:-1px;}
.modal-error{font-size:12.5px;color:var(--terracotta);margin-bottom:10px;line-height:1.5;}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px;}
.modal-link{font-size:12px;color:var(--green);text-decoration:underline;}

@media (max-width:760px){
  .app-root{flex-direction:column;}
  .sidebar{width:100%;min-width:0;border-right:none;border-bottom:1px solid var(--rule);}
}
`;
