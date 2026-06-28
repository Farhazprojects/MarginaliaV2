// api/claude.js
//
// Serverless function (Vercel) that proxies requests to the Gemini API.
// The API key lives only here, as a server environment variable — it is
// never sent to or stored in the browser.
//
// Required environment variable (set in Vercel project settings, or in a
// local .env file when running `vercel dev`):
//   GEMINI_API_KEY=your-key-here
//
// Get a free key at https://aistudio.google.com/apikey

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing GEMINI_API_KEY. Add it in your Vercel project's Environment Variables (see README) and redeploy.",
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
          generationConfig: { maxOutputTokens: 8000 },
        }),
      }
    );

    const raw = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: raw?.error?.message || "Gemini API request failed.",
      });
    }

    // Reshape Gemini's response into the same {content:[{type:"text",text}]}
    // shape the frontend expects, so the frontend code stays provider-agnostic.
    const text = raw?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: "Unexpected server error calling Gemini API." });
  }
}
