// server/local-server.js
//
// Runs inside the Electron app. Serves the built React frontend and
// proxies /api/claude requests to Gemini, the same way the Vercel
// function (api/claude.js) does for the web deployment.
//
// The API key is read from a local config file in the OS's per-user
// app-data directory — never hardcoded, never committed to git.

const express = require("express");
const path = require("path");
const fs = require("fs");
const { app: electronApp } = require("electron");

const CONFIG_DIR = electronApp.getPath("userData"); // e.g. ~/Library/Application Support/Marginalia
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getApiKey() {
  return readConfig().geminiApiKey || process.env.GEMINI_API_KEY || null;
}

function setApiKey(key) {
  const config = readConfig();
  config.geminiApiKey = key;
  writeConfig(config);
}

function createServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" })); // papers can be long

  // Serve the built frontend
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));

  // Whether a key is already saved — frontend checks this on load
  app.get("/api/has-key", (req, res) => {
    res.json({ hasKey: !!getApiKey() });
  });

  // Save / update the API key from the in-app settings screen
  app.post("/api/set-key", (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "A valid API key is required." });
    }
    setApiKey(apiKey.trim());
    res.json({ ok: true });
  });

  // Main proxy: forwards to Gemini, same contract as api/claude.js
  app.post("/api/claude", async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error: "No Gemini API key saved yet. Open Settings in the app and add your key.",
      });
    }

    const { prompt, system } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Request body must include a 'prompt' string." });
    }

    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            generationConfig: { maxOutputTokens: 4000 },
          }),
        }
      );
      const raw = await upstream.json();
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: raw?.error?.message || "Gemini API request failed.",
        });
      }
      const text = raw?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      return res.json({ content: [{ type: "text", text }] });
    } catch (err) {
      return res.status(500).json({ error: "Unexpected error calling Gemini API." });
    }
  });

  // Client-side routing fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });

  return app;
}

function startServer(port = 4317) {
  return new Promise((resolve) => {
    const app = createServer();
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { startServer, getApiKey, setApiKey };
