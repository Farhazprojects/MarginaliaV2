// electron/main.cjs
//
// Electron main process. Starts the local Express server (frontend +
// API proxy), then opens a native window pointed at it. This is what
// turns the web app into a double-clickable Mac application.

const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { startServer } = require("../server/local-server.js");

const PORT = 4317;
let mainWindow;

async function createWindow() {
  await startServer(PORT);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Marginalia",
    backgroundColor: "#FAF8F3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Use the system default menu bar (Cmd+Q, Cmd+W, copy/paste etc. still work)
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));
}

function buildMenuTemplate() {
  const isMac = process.platform === "darwin";
  return [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
