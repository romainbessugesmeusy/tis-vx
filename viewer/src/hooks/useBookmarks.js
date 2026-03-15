import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'tis-bookmarks'

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { folders: [], bookmarks: [] }
    const parsed = JSON.parse(raw)
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    }
  } catch {
    return { folders: [], bookmarks: [] }
  }
}

function writeStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('Failed to save bookmarks:', e)
  }
}

function generateId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useBookmarks() {
  const [state, setState] = useState(readStorage)

  // Sync to localStorage on every state change
  useEffect(() => {
    writeStorage(state)
  }, [state])

  const createFolder = useCallback((name) => {
    const folder = { id: generateId(), name, createdAt: Date.now() }
    setState(prev => ({ ...prev, folders: [...prev.folders, folder] }))
    return folder
  }, [])

  const renameFolder = useCallback((folderId, name) => {
    setState(prev => ({
      ...prev,
      folders: prev.folders.map(f => f.id === folderId ? { ...f, name } : f),
    }))
  }, [])

  const deleteFolder = useCallback((folderId) => {
    setState(prev => ({
      folders: prev.folders.filter(f => f.id !== folderId),
      bookmarks: prev.bookmarks.filter(b => b.folderId !== folderId),
    }))
  }, [])

  const addBookmark = useCallback((bookmark) => {
    const entry = { ...bookmark, id: generateId(), createdAt: Date.now() }
    setState(prev => ({ ...prev, bookmarks: [...prev.bookmarks, entry] }))
    return entry
  }, [])

  const removeBookmark = useCallback((bookmarkId) => {
    setState(prev => ({
      ...prev,
      bookmarks: prev.bookmarks.filter(b => b.id !== bookmarkId),
    }))
  }, [])

  const isBookmarked = useCallback((type, route, context) => {
    return state.bookmarks.some(b => {
      if (b.type !== type) return false
      if (type === 'tool') return b.context?.code === context?.code
      if (type === 'torque') {
        return b.context?.component === context?.component
          && b.context?.value === context?.value
          && b.context?.sourcePage === context?.sourcePage
      }
      if (type === 'epc-part') {
        return b.context?.diagramId === context?.diagramId && b.context?.ref === context?.ref
      }
      return b.route === route
    })
  }, [state.bookmarks])

  const exportFolder = useCallback((folderId) => {
    const folder = state.folders.find(f => f.id === folderId)
    if (!folder) return
    const bookmarks = state.bookmarks.filter(b => b.folderId === folderId)
    const payload = { folder, bookmarks, exportedAt: Date.now(), version: 1 }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${folder.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [state])

  const importFolder = useCallback((json) => {
    try {
      const payload = typeof json === 'string' ? JSON.parse(json) : json
      if (!payload.folder?.name || !Array.isArray(payload.bookmarks)) {
        throw new Error('Invalid bookmark file')
      }
      const newFolderId = generateId()
      const folder = { id: newFolderId, name: payload.folder.name, createdAt: Date.now() }
      const bookmarks = payload.bookmarks.map(b => ({
        ...b,
        id: generateId(),
        folderId: newFolderId,
      }))
      setState(prev => ({
        folders: [...prev.folders, folder],
        bookmarks: [...prev.bookmarks, ...bookmarks],
      }))
      return { success: true, folderName: folder.name, count: bookmarks.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }, [])

  return {
    folders: state.folders,
    bookmarks: state.bookmarks,
    createFolder,
    renameFolder,
    deleteFolder,
    addBookmark,
    removeBookmark,
    isBookmarked,
    exportFolder,
    importFolder,
  }
}
