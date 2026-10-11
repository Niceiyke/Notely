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

The desktop shell is configured in `src-tauri/`. Native file dialogs and real file-system saving are available.

## Cloud workspaces (optional)

1. Create a Supabase project and apply `supabase/migrations/20260615000000_cloud_workspaces.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and set the project's URL and anon key.
3. Restart Notely, open the cloud panel, create an account, and sign in. Create a workspace, then sync your open tabs. Sign in on another computer, select that workspace, and open its cloud documents.

Cloud documents are copies managed by Notely; syncing writes the currently open tabs into the selected workspace. RLS policies restrict groups and documents to their owner. Local filesystem files remain local until opened as tabs and explicitly synced.
