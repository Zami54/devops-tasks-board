import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTask, deleteTask, getProjects, getTasks, updateTask } from './api.js'
import {
  COLUMNS, PRIORITIES, computeStats, filterTasks, nextStatus, priorityLabel, sortTasks,
} from './tasks.js'

// Petites icônes SVG intégrées : aucune police ni bibliothèque d'icônes
// téléchargée (moins de dépendances, et compatible avec la CSP stricte).
const ICONS = {
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
}

function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  )
}

function Stats({ stats }) {
  return (
    <dl className="stats">
      <div><dt>Tâches</dt><dd>{stats.total}</dd></div>
      <div><dt>En cours</dt><dd>{stats.doing}</dd></div>
      <div><dt>Terminées</dt><dd>{stats.done}</dd></div>
      <div className="stats-progress">
        <dt>Avancement</dt>
        <dd>{stats.progress} %</dd>
        <div className="bar" role="progressbar" aria-label="Avancement global"
          aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${stats.progress}%` }} />
        </div>
      </div>
    </dl>
  )
}

function AddTaskForm({ projects, onCreate, busy }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState('medium')

  const selectedProject = projectId || projects[0]?.id || ''

  async function submit(event) {
    event.preventDefault()
    const ok = await onCreate({
      title: title.trim(),
      description: description.trim(),
      project_id: Number(selectedProject),
      priority,
    })
    if (ok) { setTitle(''); setDescription('') }
  }

  return (
    <form className="add-form" onSubmit={submit} aria-labelledby="add-title">
      <h2 id="add-title">Nouvelle tâche</h2>
      <div className="field grow">
        <label htmlFor="task-title">Titre</label>
        <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)}
          maxLength={120} required placeholder="Ex. : Ajouter un scan de dépendances" />
      </div>
      <div className="field grow">
        <label htmlFor="task-description">Description <span className="optional">(facultatif)</span></label>
        <input id="task-description" value={description} onChange={(e) => setDescription(e.target.value)}
          maxLength={500} placeholder="Détail, critère de fin…" />
      </div>
      <div className="field">
        <label htmlFor="task-project">Projet</label>
        <select id="task-project" value={selectedProject} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="task-priority">Priorité</label>
        <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy || !title.trim() || !projects.length}>
        <Icon name="plus" /> Ajouter
      </button>
    </form>
  )
}

function Toolbar({ filters, setFilters, projects, onRefresh }) {
  const update = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))
  return (
    <div className="toolbar" role="search">
      <div className="field grow search">
        <label htmlFor="search" className="sr-only">Rechercher une tâche</label>
        <Icon name="search" />
        <input id="search" type="search" placeholder="Rechercher…" value={filters.search} onChange={update('search')} />
      </div>
      <div className="field">
        <label htmlFor="filter-project" className="sr-only">Filtrer par projet</label>
        <select id="filter-project" value={filters.projectId} onChange={update('projectId')}>
          <option value="all">Tous les projets</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-priority" className="sr-only">Filtrer par priorité</label>
        <select id="filter-priority" value={filters.priority} onChange={update('priority')}>
          <option value="all">Toutes priorités</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="sort" className="sr-only">Trier</label>
        <select id="sort" value={filters.sort} onChange={update('sort')}>
          <option value="recent">Plus récentes</option>
          <option value="priority">Par priorité</option>
          <option value="title">Par titre</option>
        </select>
      </div>
      <button className="btn btn-ghost" type="button" onClick={onRefresh} aria-label="Recharger les tâches">
        <Icon name="refresh" />
      </button>
    </div>
  )
}

function TaskCard({ task, onMove, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const previous = nextStatus(task.status, -1)
  const next = nextStatus(task.status, 1)
  const columnLabel = (status) => COLUMNS.find((c) => c.status === status)?.label

  return (
    <li className={`card priority-${task.priority}`}>
      <div className="card-meta">
        <span className="project">
          <span className="dot" style={{ backgroundColor: task.project_color }} aria-hidden="true" />
          {task.project_name}
        </span>
        <span className={`badge badge-${task.priority}`}>{priorityLabel(task.priority)}</span>
      </div>
      <h3 className="card-title">{task.title}</h3>
      {task.description && <p className="card-text">{task.description}</p>}
      <div className="card-actions">
        <button className="btn-icon" type="button" disabled={!previous}
          onClick={() => onMove(task, previous)}
          aria-label={previous ? `Déplacer « ${task.title} » vers ${columnLabel(previous)}` : 'Déjà dans la première colonne'}>
          <Icon name="left" />
        </button>
        <button className="btn-icon" type="button" disabled={!next}
          onClick={() => onMove(task, next)}
          aria-label={next ? `Déplacer « ${task.title} » vers ${columnLabel(next)}` : 'Déjà dans la dernière colonne'}>
          <Icon name="right" />
        </button>
        <span className="spacer" />
        {confirming ? (
          <>
            <button className="btn-text danger" type="button" onClick={() => onDelete(task)}>Supprimer</button>
            <button className="btn-text" type="button" onClick={() => setConfirming(false)}>Annuler</button>
          </>
        ) : (
          <button className="btn-icon" type="button" onClick={() => setConfirming(true)}
            aria-label={`Supprimer « ${task.title} »`}>
            <Icon name="trash" />
          </button>
        )}
      </div>
    </li>
  )
}

function Column({ column, tasks, onMove, onDelete }) {
  return (
    <section className={`column column-${column.status}`} aria-labelledby={`col-${column.status}`}>
      <header className="column-head">
        <h2 id={`col-${column.status}`}>{column.label}</h2>
        <span className="count" aria-label={`${tasks.length} tâche(s)`}>{tasks.length}</span>
      </header>
      {tasks.length ? (
        <ul className="cards">
          {tasks.map((task) => <TaskCard key={task.id} task={task} onMove={onMove} onDelete={onDelete} />)}
        </ul>
      ) : (
        <p className="empty">Aucune tâche</p>
      )}
    </section>
  )
}

export default function App() {
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState({ search: '', projectId: 'all', priority: 'all', sort: 'recent' })

  const load = useCallback(async () => {
    setError('')
    try {
      const [p, t] = await Promise.all([getProjects(), getTasks()])
      setProjects(p)
      setTasks(t)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => sortTasks(filterTasks(tasks, filters), filters.sort), [tasks, filters])
  const stats = useMemo(() => computeStats(tasks), [tasks])

  async function run(action, message) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      setNotice(message)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = (task) => run(() => createTask(task), `Tâche « ${task.title} » ajoutée.`)
  const handleMove = (task, status) => run(() => updateTask(task.id, { status }), 'Tâche déplacée.')
  const handleDelete = (task) => run(() => deleteTask(task.id), `Tâche « ${task.title} » supprimée.`)

  return (
    <div className="app">
      <a className="skip-link" href="#board">Aller au tableau</a>
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" className="logo" aria-hidden="true">
            <rect width="32" height="32" rx="7" />
            <rect x="6" y="8" width="5" height="16" rx="1.5" className="l1" />
            <rect x="13.5" y="8" width="5" height="11" rx="1.5" className="l2" />
            <rect x="21" y="8" width="5" height="7" rx="1.5" className="l3" />
          </svg>
          <div>
            <h1>DevOps Tasks Board</h1>
            <p>Du poste de développement au CLOUD</p>
          </div>
        </div>
        <Stats stats={stats} />
      </header>

      <main className="content">
        <AddTaskForm projects={projects} onCreate={handleCreate} busy={busy} />
        <Toolbar filters={filters} setFilters={setFilters} projects={projects} onRefresh={load} />

        <div className="messages" aria-live="polite">
          {error && <p className="alert" role="alert">{error}</p>}
          {!error && notice && <p className="sr-only">{notice}</p>}
        </div>

        {loading ? (
          <p className="loading">Chargement des tâches…</p>
        ) : (
          <div className="board" id="board" tabIndex={-1}>
            {COLUMNS.map((column) => (
              <Column key={column.status} column={column}
                tasks={visible.filter((t) => t.status === column.status)}
                onMove={handleMove} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        {visible.length} tâche(s) affichée(s) sur {tasks.length}
      </footer>
    </div>
  )
}
