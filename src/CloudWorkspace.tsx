import { useEffect, useState } from 'react'
import { LogIn, LogOut, Cloud, Plus, RefreshCw } from 'lucide-react'
import { supabase, supabaseConfigured, type CloudDocument, type CloudGroup } from './lib/supabase'
import type { User } from '@supabase/supabase-js'

type Tab = { id: number; name: string; content: string; dirty: boolean; cloudId?: string }
type Props = { tabs: Tab[]; onOpen: (document: CloudDocument) => void; onSetCloudId: (tabId: number, cloudId: string) => void }

export default function CloudWorkspace({ tabs, onOpen, onSetCloudId }: Props) {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [groups, setGroups] = useState<CloudGroup[]>([])
  const [groupId, setGroupId] = useState('')
  const [documents, setDocuments] = useState<CloudDocument[]>([])
  const [newGroup, setNewGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const loadGroups = async () => {
    if (!supabase || !user) return
    const { data, error } = await supabase.from('notely_groups').select('id,name,updated_at').order('updated_at', { ascending: false })
    if (error) throw error
    const list = data as CloudGroup[]
    setGroups(list)
    const selected = list.some(group => group.id === groupId) ? groupId : list[0]?.id ?? ''
    setGroupId(selected)
    if (selected) await loadDocuments(selected)
    else setDocuments([])
  }
  const loadDocuments = async (id: string) => {
    if (!supabase) return
    const { data, error } = await supabase.from('notely_documents').select('id,group_id,name,content,updated_at').eq('group_id', id).order('updated_at', { ascending: false })
    if (error) throw error
    setDocuments(data as CloudDocument[])
  }
  useEffect(() => { if (user) void loadGroups().catch(error => setMessage(error.message)) }, [user])

  const signIn = async (create: boolean) => {
    if (!supabase) return
    setBusy(true); setMessage('')
    const result = create
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    setMessage(result.error?.message ?? (create ? 'Check your email to confirm your account.' : 'Signed in.'))
  }
  const createGroup = async () => {
    if (!supabase || !user || !newGroup.trim()) return
    setBusy(true)
    const { data, error } = await supabase.from('notely_groups').insert({ user_id: user.id, name: newGroup.trim() }).select('id,name,updated_at').single()
    setBusy(false)
    if (error) return setMessage(error.message)
    setNewGroup(''); setGroups(current => [data as CloudGroup, ...current]); setGroupId(data.id); setDocuments([]); setMessage('Workspace created.')
  }
  const sync = async () => {
    if (!supabase || !user || !groupId) return
    setBusy(true); setMessage('Syncing…')
    try {
      const rows = tabs.map(tab => { const id = tab.cloudId ?? crypto.randomUUID(); onSetCloudId(tab.id, id); return { id, user_id: user.id, group_id: groupId, name: tab.name, content: tab.content, updated_at: new Date().toISOString() } })
      const { error } = await supabase.from('notely_documents').upsert(rows, { onConflict: 'id' })
      if (error) throw error
      await supabase.from('notely_groups').update({ updated_at: new Date().toISOString() }).eq('id', groupId)
      await loadDocuments(groupId)
      setMessage(`Synced ${tabs.length} open document${tabs.length === 1 ? '' : 's'}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  if (!supabaseConfigured) return <aside className="cloud-panel"><strong>Cloud workspaces</strong><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable cloud sync.</p></aside>
  return <aside className="cloud-panel">
    <div className="cloud-heading"><strong><Cloud size={16}/> Cloud workspaces</strong>{user && <button onClick={() => void supabase!.auth.signOut()} title="Sign out"><LogOut size={15}/></button>}</div>
    {!user ? <form onSubmit={event => { event.preventDefault(); void signIn(false) }}>
      <input type="email" required placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} />
      <input type="password" required minLength={6} placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} />
      <button disabled={busy}><LogIn size={14}/> Sign in</button><button type="button" disabled={busy} onClick={() => void signIn(true)}>Create account</button>
    </form> : <>
      <div className="cloud-user">{user.email}</div>
      <div className="cloud-create"><input placeholder="New workspace name" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createGroup() }}/><button disabled={busy || !newGroup.trim()} onClick={() => void createGroup()} title="Create workspace"><Plus size={15}/></button></div>
      <select value={groupId} onChange={event => { setGroupId(event.target.value); void loadDocuments(event.target.value).catch(error => setMessage(error.message)) }}><option value="">Choose a workspace</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <button className="cloud-sync" disabled={busy || !groupId || tabs.length === 0} onClick={() => void sync()}><RefreshCw size={14}/> Sync open tabs to workspace</button>
      <div className="cloud-documents">{documents.length ? documents.map(document => <button key={document.id} onClick={() => onOpen(document)}><span>{document.name}</span><small>{new Date(document.updated_at).toLocaleDateString()}</small></button>) : <span className="cloud-empty">No synced documents</span>}</div>
    </>}
    {message && <div className="cloud-message" role="status">{message}</div>}
  </aside>
}
