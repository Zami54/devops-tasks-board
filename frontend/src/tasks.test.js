import { describe, expect, test } from 'vitest'
import { computeStats, filterTasks, nextStatus, sortTasks } from './tasks.js'

const tasks = [
  { id: 1, project_id: 1, title: 'Dockeriser le backend', description: '', status: 'done', priority: 'high', created_at: '2026-10-01' },
  { id: 2, project_id: 2, title: 'Écran Kanban', description: 'trois colonnes', status: 'doing', priority: 'low', created_at: '2026-10-03' },
  { id: 3, project_id: 1, title: 'Sondes Kubernetes', description: '', status: 'todo', priority: 'medium', created_at: '2026-10-02' },
]

describe('filterTasks', () => {
  test('filtre par projet', () => {
    expect(filterTasks(tasks, { projectId: '1' }).map((t) => t.id)).toEqual([1, 3])
  })
  test('filtre par priorité', () => {
    expect(filterTasks(tasks, { priority: 'low' }).map((t) => t.id)).toEqual([2])
  })
  test('recherche sans tenir compte des accents ni de la casse', () => {
    expect(filterTasks(tasks, { search: 'ecran' }).map((t) => t.id)).toEqual([2])
    expect(filterTasks(tasks, { search: 'COLONNES' }).map((t) => t.id)).toEqual([2])
  })
})

describe('sortTasks', () => {
  test('par priorité, de la plus haute à la plus basse', () => {
    expect(sortTasks(tasks, 'priority').map((t) => t.priority)).toEqual(['high', 'medium', 'low'])
  })
  test('par date, la plus récente d\'abord', () => {
    expect(sortTasks(tasks, 'recent').map((t) => t.id)).toEqual([2, 3, 1])
  })
  test('ne modifie pas le tableau d\'origine', () => {
    sortTasks(tasks, 'title')
    expect(tasks[0].id).toBe(1)
  })
})

test('nextStatus déplace entre colonnes sans sortir du tableau', () => {
  expect(nextStatus('todo', 1)).toBe('doing')
  expect(nextStatus('done', 1)).toBeNull()
  expect(nextStatus('todo', -1)).toBeNull()
})

test('computeStats calcule l\'avancement', () => {
  expect(computeStats(tasks)).toEqual({ total: 3, doing: 1, done: 1, progress: 33 })
  expect(computeStats([]).progress).toBe(0)
})
