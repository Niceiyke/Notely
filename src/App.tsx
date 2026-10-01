import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { FilePlus2, FolderOpen, Save, Search, Moon, Sun, WrapText, X, FileText, Replace, Check, Settings } from 'lucide-react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir, mkdir, remove, rename } from '@tauri-apps/plugin-fs'
import { isTauri as tauriIsTauri } from '@tauri-apps/api/core'
import * as prettier from 'prettier/standalone'
import * as babelPlugin from 'prettier/plugins/babel'
import * as typescriptPlugin from 'prettier/plugins/typescript'
import * as estreePlugin from 'prettier/plugins/estree'
import * as markdownPlugin from 'prettier/plugins/markdown'
import * as postcssPlugin from 'prettier/plugins/postcss'
import * as htmlPlugin from 'prettier/plugins/html'

type DocumentTab = { id: number; name: string; content: string; dirty: boolean; path?: string }

const isTauri = () => tauriIsTauri()
const starter = `Welcome to Notely.\n\nA small, focused text editor for your notes.\n\nStart typing, or open a file from your computer.`

function languageFor(name: string, content = '') {
  // Untitled documents do not have an extension, so make a conservative
  // guess from common code markers instead of leaving them as plain text.
  const looksLikeCode = /\b(import|export|const|let|var|function|interface|type)\b|=>/.test(content)
  if (/\.json$/i.test(name)) return javascript()
  if (/\.(js|jsx|ts|tsx)$/i.test(name) || (/\.txt$/i.test(name) && looksLikeCode)) {
    return javascript({ jsx: true, typescript: true })
  }
  if (/\.(css|scss)$/i.test(name)) return css()
  if (/\.go$/i.test(name)) return go()
  if (/\.rs$/i.test(name)) return rust()
  if (/\.md$/i.test(name)) return markdown()
  if (/\.py$/i.test(name) || (/\.txt$/i.test(name) && /\b(def|class|from .* import|print\s*\()/.test(content))) return python()
  return []
}

function searchHighlighter(queryRef: { current: string }) {
  const mark = Decoration.mark({ class: 'cm-searchMatch' })
  return ViewPlugin.fromClass(class {
    decorations = Decoration.none
    constructor(view: EditorView) { this.decorations = this.build(view) }
    update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; transactions: readonly unknown[] }) {
      if (update.docChanged || update.selectionSet || update.transactions.length) this.decorations = this.build(update.view)
    }
    build(view: EditorView) {
      const query = queryRef.current
      if (!query) return Decoration.none
      const text = view.state.doc.toString(); const ranges = []
      let from = 0; let index = text.indexOf(query, from)
      while (index >= 0) {
        ranges.push(mark.range(index, index + query.length)); from = index + query.length
        index = text.indexOf(query, from)
      }
      return Decoration.set(ranges, true)
    }
  }, { decorations: value => value.decorations })
}

export default function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => {
    try {
      const saved = localStorage.getItem('notely-autosave')
      if (saved) {
        const restored = JSON.parse(saved) as DocumentTab[]
        if (Array.isArray(restored) && restored.length > 0) return restored
      }
    } catch { /* Ignore invalid saved data and use the welcome document. */ }
    return [{ id: 1, name: 'Welcome.txt', content: starter, dirty: false }]
  })
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem('notely-active-tab')
    return saved ? Number(saved) : 1
  })
  const [dark, setDark] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('notely-font-size') || 13))
  const [tabSize, setTabSize] = useState(() => Number(localStorage.getItem('notely-tab-size') || 2))
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchQueryRef = useRef(query)
  searchQueryRef.current = query
  const [replaceWith, setReplaceWith] = useState('')
  const [status, setStatus] = useState('Ready')
  const [recentFiles, setRecentFiles] = useState<string[]>(() => JSON.parse(localStorage.getItem('notely-recent-files') || '[]'))
  const [recentOpen, setRecentOpen] = useState(false)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [folderEntries, setFolderEntries] = useState<Array<{ name: string; path: string; parent: string; isDirectory: boolean; depth: number }>>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [explorerQuery, setExplorerQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: { path: string; name: string; isDirectory: boolean } } | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [editorError, setEditorError] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]

  const rememberFile = (path: string) => {
    setRecentFiles(current => {
      const next = [path, ...current.filter(item => item !== path)].slice(0, 8)
      localStorage.setItem('notely-recent-files', JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    localStorage.setItem('notely-font-size', String(fontSize))
    localStorage.setItem('notely-tab-size', String(tabSize))
  }, [fontSize, tabSize])

  const updateContent = (content: string) => setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, content, dirty: true } : tab))

  useEffect(() => {
    if (!editorRef.current || !active) return
    viewRef.current?.destroy()
    try {
      const state = EditorState.create({ doc: active.content, extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(), EditorState.tabSize.of(tabSize),
        syntaxHighlighting(defaultHighlightStyle), languageFor(active.name, active.content),
        searchHighlighter(searchQueryRef),
        ...(dark ? [oneDark] : []),
        keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]),
        ...(wrap ? [EditorView.lineWrapping] : []),
        EditorView.updateListener.of(update => {
          if (update.docChanged) updateContent(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const position = update.state.selection.main.head
            const line = update.state.doc.lineAt(position)
            setCursor({ line: line.number, column: position - line.from + 1 })
          }
        }),
        EditorView.theme({ '&': { height: '100%', fontSize: `${fontSize}px` }, '.cm-scroller': { overflow: 'auto' },  ...(wrap ? {} : { '.cm-content': { whiteSpace: 'pre' }, '.cm-line': { whiteSpace: 'pre' } }) }),
      ] })
      viewRef.current = new EditorView({ state, parent: editorRef.current })
      setEditorError(false)
    } catch (error) {
      console.error('CodeMirror failed to initialize:', error)
      setEditorError(true)
      setStatus('Basic editor mode')
    }
    return () => viewRef.current?.destroy()
  // Recreate only when changing document/theme/wrap, not each keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, dark, wrap, fontSize, tabSize])

  const newFile = () => {
    const id = Date.now()
    setTabs(current => [...current, { id, name: 'Untitled.txt', content: '', dirty: false }])
    setActiveId(id)
    setStatus('New document')
  }

  const openNativeFile = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, title: 'Open file' })
      if (!selected || Array.isArray(selected)) return
      const content = await readTextFile(selected)
      rememberFile(selected)
      const name = selected.split(/[\\/]/).pop() || 'Untitled.txt'
      const id = Date.now()
      setTabs(current => [...current, { id, name, path: selected, content, dirty: false }])
      setActiveId(id); setStatus(`Opened ${name}`)
    } catch (error) {
      console.error('Native open failed:', error)
      setStatus(`Open failed: ${String(error)}`)
    }
  }

  const loadExplorer = async (root: string) => {
    const result: Array<{ name: string; path: string; parent: string; isDirectory: boolean; depth: number }> = []
    const walk = async (parent: string, depth: number) => {
      const entries = await readDir(parent)
      for (const entry of entries.sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
        if (!entry.name) continue
        const path = `${parent.replace(/[\\/]$/, '')}/${entry.name}`
        result.push({ name: entry.name, path, parent, isDirectory: Boolean(entry.isDirectory), depth })
        if (entry.isDirectory) await walk(path, depth + 1)
      }
    }
    await walk(root, 0)
    setFolderEntries(result)
  }

  const openFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: 'Open folder' })
      if (!selected || Array.isArray(selected)) return
      setFolderPath(selected); setSelectedFolder(selected); setExpandedFolders(new Set([selected])); await loadExplorer(selected)
      setStatus(`Opened folder ${selected.split(/[\\/]/).pop() || selected}`)
    } catch (error) { setStatus(`Open folder failed: ${String(error)}`) }
  }

  const refreshExplorer = async () => { if (folderPath) await loadExplorer(folderPath); setStatus('Explorer refreshed') }
  const toggleFolder = (path: string) => { setSelectedFolder(path); setExpandedFolders(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next }) }
  const openFolderEntry = async (entry: { path?: string; isDirectory?: boolean }) => { if (entry.path && entry.isDirectory) setSelectedFolder(entry.path); else if (entry.path) await openRecentFile(entry.path) }
  const newExplorerFile = async () => { const parent = selectedFolder || folderPath; if (!parent) return; const name = window.prompt(`New file in ${parent.split(/[\\/]/).pop()}`); if (!name) return; await writeTextFile(`${parent}/${name}`, ''); await refreshExplorer() }
  const newExplorerFolder = async () => { const parent = selectedFolder || folderPath; if (!parent) return; const name = window.prompt(`New folder in ${parent.split(/[\\/]/).pop()}`); if (!name) return; await mkdir(`${parent}/${name}`); await refreshExplorer() }
  const renameExplorerEntry = async (entry: { path: string; name: string }) => { const name = window.prompt('Rename', entry.name); if (!name || name === entry.name) return; await rename(entry.path, `${entry.path.slice(0, entry.path.length - entry.name.length)}${name}`); await refreshExplorer() }
  const deleteExplorerEntry = async (entry: { path: string; name: string }) => { if (!window.confirm(`Delete ${entry.name}?`)) return; await remove(entry.path, { recursive: true }); await refreshExplorer() }

  const openRecentFile = async (path: string) => {
    try {
      const content = await readTextFile(path)
      const name = path.split(/[\\/]/).pop() || 'Untitled.txt'
      const id = Date.now()
      setTabs(current => [...current, { id, name, path, content, dirty: false }])
      setActiveId(id); setRecentOpen(false); rememberFile(path); setStatus(`Opened ${name}`)
    } catch (error) {
      setStatus(`Recent file unavailable: ${String(error)}`)
      setRecentFiles(current => current.filter(item => item !== path))
    }
  }

  const openFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const id = Date.now()
      setTabs(current => [...current, { id, name: file.name, content: String(reader.result ?? ''), dirty: false }])
      setActiveId(id); setStatus(`Opened ${file.name}`)
    }
    reader.readAsText(file)
  }

  const saveFile = async () => {
    if (!active) return
    if (isTauri() && active.path) {
      try {
        await writeTextFile(active.path, active.content)
        rememberFile(active.path)
        setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, dirty: false } : tab))
        setStatus(`Saved ${active.name}`)
      } catch (error) {
        console.error('Native save failed:', error)
        setStatus(`Save failed: ${String(error)}`)
      }
      return
    }
    if (isTauri()) return saveFileAs()
    const blob = new Blob([active.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = active.name; anchor.click(); URL.revokeObjectURL(url)
    setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, dirty: false } : tab))
    setStatus(`Saved ${active.name}`)
  }

  const saveFileAs = async () => {
    if (!active) return
    if (isTauri()) {
      try {
        const selected = await saveDialog({ defaultPath: active.name, title: 'Save file as' })
        if (!selected) return
        await writeTextFile(selected, active.content)
        rememberFile(selected)
        const name = selected.split(/[\\/]/).pop() || active.name
        setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, name, path: selected, dirty: false } : tab))
        setStatus(`Saved ${name}`)
      } catch (error) {
        console.error('Native Save As failed:', error)
        setStatus(`Save As failed: ${String(error)}`)
      }
      return
    }
    const requestedName = window.prompt('Save file as', active.name)
    const name = requestedName?.trim()
    if (!name) return
    const blob = new Blob([active.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
    setTabs(current => current.map(tab => tab.id === activeId ? { ...tab, name, dirty: false } : tab))
    setStatus(`Saved ${name}`)
  }

  // Keep a recovery copy in the browser so a refresh does not lose work.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem('notely-autosave', JSON.stringify(tabs))
      localStorage.setItem('notely-active-tab', String(activeId))
      setStatus(current => current === 'Ready' || current === 'Auto-saved' ? 'Auto-saved' : current)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [tabs, activeId])

  // Refresh search decorations whenever the query changes.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: [] })
  }, [query])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (tabs.some(tab => tab.dirty)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [tabs])

  // Desktop-style keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); void formatDocument(); return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'n') { event.preventDefault(); newFile() }
      if (key === 'o') { event.preventDefault(); isTauri() ? openNativeFile() : fileInputRef.current?.click() }
      if (key === 's') { event.preventDefault(); event.shiftKey ? saveFileAs() : saveFile() }
      if (key === 'f') { event.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const closeTab = (id: number) => {
    const tab = tabs.find(item => item.id === id)
    if (!tab) return
    if (tab.dirty && !window.confirm(`${tab.name} has unsaved changes. Close it anyway?`)) return
    if (tabs.length === 1) return
    const next = tabs.filter(item => item.id !== id)
    setTabs(next); if (id === activeId) setActiveId(next[Math.max(0, next.length - 1)].id)
  }

  const formatDocument = async () => {
    if (!active) return
    const parser = /\.json$/i.test(active.name) ? 'json' : /\.(ts|tsx)$/i.test(active.name) ? 'typescript' : /\.(js|jsx)$/i.test(active.name) ? 'babel' : /\.md$/i.test(active.name) ? 'markdown' : /\.(css|scss)$/i.test(active.name) ? 'css' : /\.html?$/i.test(active.name) ? 'html' : null
    if (!parser) return setStatus('Formatting supports JSON, JavaScript, TypeScript, CSS, HTML, and Markdown')
    const content = viewRef.current?.state.doc.toString() ?? active.content
    try {
      const formatted = await prettier.format(content, {
        parser,
        plugins: [babelPlugin, typescriptPlugin, estreePlugin, markdownPlugin, postcssPlugin, htmlPlugin],
        semi: true,
        singleQuote: true,
      })
      if (viewRef.current) viewRef.current.dispatch({ changes: { from: 0, to: content.length, insert: formatted } })
      else updateContent(formatted)
      setStatus(`Formatted ${active.name}`)
    } catch (error) {
      console.error('Format failed:', error)
      setStatus(`Format failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const currentContent = () => viewRef.current?.state.doc.toString() ?? active.content

  const selectMatch = (from: number, to: number) => {
    viewRef.current?.dispatch({ selection: { anchor: from, head: to } })
    viewRef.current?.focus()
  }

  const findNext = () => {
    if (!query) return setStatus('Type something to find')
    const content = currentContent()
    const start = viewRef.current?.state.selection.main.to ?? 0
    const index = content.indexOf(query, start) >= 0 ? content.indexOf(query, start) : content.indexOf(query)
    if (index < 0) return setStatus('No matches found')
    selectMatch(index, index + query.length)
    setStatus(`Found match at ${index + 1}`)
  }

  const findAll = () => {
    if (!query) return setStatus('Type something to find')
    const content = currentContent()
    const count = content.split(query).length - 1
    setStatus(`${count} match${count === 1 ? '' : 'es'} found`)
    if (count > 0) findNext()
  }

  const replaceOne = () => {
    if (!query) return setStatus('Type something to find')
    const content = currentContent()
    const selected = viewRef.current?.state.selection.main
    const index = selected && content.slice(selected.from, selected.to) === query ? selected.from : content.indexOf(query)
    if (index < 0) return setStatus('No matches found')
    const next = content.slice(0, index) + replaceWith + content.slice(index + query.length)
    if (viewRef.current) viewRef.current.dispatch({ changes: { from: 0, to: content.length, insert: next } })
    else updateContent(next)
    setStatus('1 replacement made')
  }

  const replaceAll = () => {
    if (!query) return setStatus('Type something to find')
    const content = currentContent()
    const count = content.split(query).length - 1
    const next = content.split(query).join(replaceWith)
    if (viewRef.current) viewRef.current.dispatch({ changes: { from: 0, to: content.length, insert: next } })
    else updateContent(next)
    setStatus(`${count} replacement${count === 1 ? '' : 's'} made`)
  }

  const lines = active.content.split('\n').length
  return <div className={`app ${dark ? 'dark' : 'light'}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><FileText size={17} /></span><strong>Notely</strong><span className="version">personal editor</span></div>
      <nav className="toolbar">
        <button title="New file" onClick={newFile}><FilePlus2 size={17} /><span>New</span></button>
        <button title="Open file" onClick={() => isTauri() ? openNativeFile() : fileInputRef.current?.click()}><FolderOpen size={17} /><span>Open</span></button>
        {isTauri() && <button title="Open folder" onClick={() => void openFolder()}><FolderOpen size={17} /><span>Folder</span></button>}
        {isTauri() && <div className="recent-wrap"><button title="Recent files" className={recentOpen ? 'selected' : ''} onClick={() => setRecentOpen(value => !value)}>Recent</button>{recentOpen && <div className="recent-menu">{recentFiles.length === 0 ? <span>No recent files</span> : recentFiles.map(path => <button key={path} onClick={() => void openRecentFile(path)}>{path}</button>)}</div>}</div>}
        <button title="Save file (Ctrl+S)" onClick={saveFile}><Save size={17} /><span>Save</span></button>
        <button title="Save As (Ctrl+Shift+S)" onClick={saveFileAs}><Save size={17} /><span>Save As</span></button>
        <button title="Format document (Shift+Alt+F)" onClick={() => void formatDocument()}><span>Format</span></button>
        <span className="divider" />
        <button className={searchOpen ? 'selected' : ''} title="Find and replace" onClick={() => setSearchOpen(value => !value)}><Search size={17} /><span>Find</span></button>
      </nav>
      <div className="actions"><button title="Toggle word wrap" className={wrap ? 'selected' : ''} onClick={() => setWrap(value => !value)}><WrapText size={17} /></button><button title="Toggle theme" onClick={() => setDark(value => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button title="Editor settings" className={settingsOpen ? 'selected' : ''} onClick={() => setSettingsOpen(value => !value)}><Settings size={17} /></button></div>
      <input ref={fileInputRef} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = '' }} />
    </header>
    {settingsOpen && <aside className="settings-panel"><div className="settings-title">Editor settings</div><label>Font size <output>{fontSize}px</output><input type="range" min="10" max="24" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></label><label>Tab size <select value={tabSize} onChange={event => setTabSize(Number(event.target.value))}><option value={2}>2 spaces</option><option value={4}>4 spaces</option><option value={8}>8 spaces</option></select></label><label className="settings-check"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} /> Word wrap</label></aside>}
    {folderPath && <aside className="file-sidebar"><div className="sidebar-title"><span>EXPLORER</span><span><button title="New file" onClick={() => void newExplorerFile()}>＋</button><button title="New folder" onClick={() => void newExplorerFolder()}>▱</button><button title="Refresh" onClick={() => void refreshExplorer()}>↻</button><button onClick={() => setFolderPath(null)}>×</button></span></div><input className="explorer-search" placeholder="Filter files" value={explorerQuery} onChange={event => setExplorerQuery(event.target.value)} /><div className="folder-name">{folderPath.split(/[\\/]/).pop() || folderPath}</div>{folderEntries.filter(entry => !explorerQuery || entry.name.toLowerCase().includes(explorerQuery.toLowerCase())).filter(entry => { let parent = entry.parent; while (parent !== folderPath) { if (!expandedFolders.has(parent)) return false; parent = parent.replace(/[\\/]?[^\\/]+$/, '') } return true }).map(entry => <div className="file-row" key={entry.path} onContextMenu={event => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, entry }) }}><button className="file-entry" style={{ paddingLeft: `${8 + entry.depth * 14}px` }} onClick={() => entry.isDirectory ? toggleFolder(entry.path) : void openFolderEntry(entry)}>{entry.isDirectory ? (expandedFolders.has(entry.path) ? '▾' : '▸') : <FileText size={14} />}{entry.name}</button><button className="file-action" onClick={() => void renameExplorerEntry(entry)}>✎</button><button className="file-action" onClick={() => void deleteExplorerEntry(entry)}>×</button></div>)}</aside>}
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><button onClick={() => { if (!contextMenu.entry.isDirectory) void openFolderEntry(contextMenu.entry); setContextMenu(null) }}>Open</button><button onClick={() => { void renameExplorerEntry(contextMenu.entry); setContextMenu(null) }}>Rename</button><button onClick={() => { void deleteExplorerEntry(contextMenu.entry); setContextMenu(null) }}>Delete</button></div>}
    <div className="tabs">{tabs.map(tab => <div key={tab.id} className={`tab ${tab.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(tab.id)}><FileText size={14} /><span>{tab.name}{tab.dirty ? ' •' : ''}</span>{tabs.length > 1 && <button onClick={event => { event.stopPropagation(); closeTab(tab.id) }}><X size={14} /></button>}</div>)}</div>
    {searchOpen && <div className="searchbar"><Search size={16} /><input autoFocus placeholder="Find" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') findNext() }} /><button onClick={findNext}>Find next</button><button onClick={findAll}>Find all</button><Replace size={16} /><input placeholder="Replace with" value={replaceWith} onChange={event => setReplaceWith(event.target.value)} /><button onClick={replaceOne}>Replace</button><button onClick={replaceAll}>Replace all</button><button className="icon-button" onClick={() => setSearchOpen(false)}><X size={16} /></button></div>}
    <main className="editor-wrap">{editorError ? <textarea className="plain-editor" value={active.content} onChange={event => updateContent(event.target.value)} spellCheck={false} /> : <div ref={editorRef} className="editor" />}</main>
    <footer className="statusbar"><span>{status}</span><span className="status-right"><span>Ln {cursor.line}, Col {cursor.column}</span><span>{lines} {lines === 1 ? 'line' : 'lines'}</span><span>{active.content.length} characters</span><span>UTF-8</span><span>{wrap ? 'Wrap: on' : 'Wrap: off'}</span><span><Check size={13} /> Recovery on</span></span></footer>
  </div>
}

