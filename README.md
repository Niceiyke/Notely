# Notely

A small personal text editor built with React, TypeScript, Vite, and CodeMirror 6.

## Current MVP

- Create, open, save, and close documents
- Multiple tabs with unsaved indicators
- Find and replace all
- Syntax highlighting for JavaScript, TypeScript, Markdown, and Python
- Word wrap toggle
- Dark and light themes
- Line and character status

## Run locally

```bash
npm install
npm run dev
```

## Desktop app with Tauri

Install Rust and the Windows WebView2 runtime, then run:

```bash
npm run tauri:dev
```

To build an installable desktop bundle:

```bash
npm run tauri:build
```

The desktop shell is now configured in `src-tauri/`. Native file dialogs and real file-system saving are the next native integration step.
