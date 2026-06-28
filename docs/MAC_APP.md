# Running Marginalia as a Mac app

This turns the same app into a double-clickable `Marginalia.app` you can keep in your Applications folder and your Dock — no terminal needed after the first build.

You do this once, on your own Mac. It compiles a `.app` for the Mac you build it on.

## 1. Prerequisites

- [Node.js](https://nodejs.org/) 18 or later — check with `node -v` in Terminal
- That's it. No Vercel account needed for this path — the desktop app runs its own local server instead of calling Vercel.

## 2. Install dependencies

Open Terminal, go into the project folder, and run:

```bash
cd marginalia
npm install
```

This installs Electron and electron-builder in addition to the web dependencies — it's a larger install than the web-only version, that's expected.

## 3. Build the Mac app

```bash
npm run desktop:build
```

This does two things in sequence:
1. Builds the React frontend (`vite build` → `dist/`)
2. Packages everything — frontend, local server, Electron shell — into a `.dmg` installer using `electron-builder`

When it finishes, look in the new `release/` folder for `Marginalia-1.0.0.dmg` (or similar — the exact filename includes the version number).

## 4. Install it

1. Double-click the `.dmg` file in `release/`
2. Drag **Marginalia** into the **Applications** folder shown in the window that opens
3. Eject the `.dmg`, then open **Marginalia** from your Applications folder (or Spotlight, or drag it to your Dock)

### If macOS blocks the app ("unidentified developer")

Since this isn't signed with an Apple Developer certificate, macOS Gatekeeper will likely show a warning the first time you open it. To allow it:

1. Right-click (or Control-click) **Marginalia** in Applications
2. Choose **Open**
3. Click **Open** again in the dialog that appears

You only need to do this once. After that, it opens normally by double-clicking.

## 5. First launch — add your API key

The first time Marginalia opens, it will ask for your Gemini API key. Get a free one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (sign in with a Google account, no credit card needed), paste it in, and click **Save key**.

This key is saved in a local config file at:

```
~/Library/Application Support/Marginalia/config.json
```

It is **never** sent anywhere except directly to Google when you generate content. It is not bundled into the app, not committed to git, and not visible to anyone else using this Mac with a different user account.

To change the key later, click the gear icon in the top-left of the sidebar.

## How it works under the hood

The `.app` bundles:
- The built React frontend (same UI as the web version)
- A small local Express server that serves that frontend and proxies requests to Gemini — this replaces the Vercel serverless function used in the web deployment
- An Electron shell that opens a native window pointed at that local server (running on `127.0.0.1`, not exposed to your network)

Everything runs entirely on your machine. The only outbound network calls are to `generativelanguage.googleapis.com` (for analysis) and `api.crossref.org` (for the paper-discovery search).

## Rebuilding after you change the code

If you edit `src/App.jsx` or anything else and want a fresh `.app`:

```bash
npm run desktop:build
```

This rebuilds the frontend and repackages the app from scratch — your saved API key isn't affected, since it lives outside the app bundle in Application Support.

## Updating without rebuilding (quick local testing)

While actively making changes, it's faster to skip the `.dmg` packaging step:

```bash
npm run desktop:start
```

This builds the frontend and launches Electron directly, without creating an installer. Good for testing; use `desktop:build` when you want a real `.app` to keep using.
