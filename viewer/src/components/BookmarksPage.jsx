import { useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useBookmarkContext } from './BookmarkDialog'

const TYPE_LABELS = {
  'manual': 'Manual',
  'epc-diagram': 'Diagram',
  'epc-part': 'Part',
  'tool': 'Tool',
  'torque': 'Torque',
}

function BookmarksPage() {
  const {
    folders, bookmarks,
    renameFolder, deleteFolder, removeBookmark,
    exportFolder, importFolder,
  } = useBookmarkContext()

  const [expandedFolders, setExpandedFolders] = useState(() => new Set(folders.map(f => f.id)))
  const [editingFolderId, setEditingFolderId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  const toggleFolder = useCallback((id) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const startRename = useCallback((folder) => {
    setEditingFolderId(folder.id)
    setEditingName(folder.name)
  }, [])

  const saveRename = useCallback(() => {
    if (editingFolderId && editingName.trim()) {
      renameFolder(editingFolderId, editingName.trim())
    }
    setEditingFolderId(null)
    setEditingName('')
  }, [editingFolderId, editingName, renameFolder])

  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') saveRename()
    if (e.key === 'Escape') {
      setEditingFolderId(null)
      setEditingName('')
    }
  }, [saveRename])

  const confirmDelete = useCallback((folderId) => {
    deleteFolder(folderId)
    setDeletingFolderId(null)
  }, [deleteFolder])

  const handleImport = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = importFolder(reader.result)
      setImportResult(result)
      setTimeout(() => setImportResult(null), 4000)
      if (result.success) {
        setExpandedFolders(prev => new Set([...prev, ...folders.map(f => f.id)]))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [importFolder, folders])

  const folderBookmarks = useCallback((folderId) => {
    return bookmarks.filter(b => b.folderId === folderId)
  }, [bookmarks])

  if (folders.length === 0 && bookmarks.length === 0) {
    return (
      <div className="bookmarks-page">
        <div className="bookmarks-header">
          <h1>Bookmarks</h1>
          <button className="bookmarks-import-btn" onClick={handleImport}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
        <div className="bookmarks-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No bookmarks yet</p>
          <p className="bookmarks-empty-hint">
            Bookmark pages, parts, tools, and torque specs while browsing. Look for the bookmark icon in the header or next to items.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bookmarks-page">
      <div className="bookmarks-header">
        <h1>Bookmarks</h1>
        <button className="bookmarks-import-btn" onClick={handleImport}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {importResult && (
        <div className={`bookmarks-import-result ${importResult.success ? 'success' : 'error'}`}>
          {importResult.success
            ? `Imported "${importResult.folderName}" with ${importResult.count} bookmark${importResult.count !== 1 ? 's' : ''}`
            : `Import failed: ${importResult.error}`
          }
        </div>
      )}

      <div className="bookmarks-folders">
        {folders.map(folder => {
          const items = folderBookmarks(folder.id)
          const isExpanded = expandedFolders.has(folder.id)
          const isEditing = editingFolderId === folder.id
          const isDeleting = deletingFolderId === folder.id

          return (
            <div key={folder.id} className="bookmarks-folder">
              <div className="bookmarks-folder-header">
                <button
                  className="bookmarks-folder-toggle"
                  onClick={() => toggleFolder(folder.id)}
                  aria-expanded={isExpanded}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={`bookmarks-folder-chevron ${isExpanded ? 'open' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {isEditing ? (
                  <input
                    className="bookmarks-folder-name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={saveRename}
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                  />
                ) : (
                  <span className="bookmarks-folder-name" onClick={() => toggleFolder(folder.id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    {folder.name}
                    <span className="bookmarks-folder-count">{items.length}</span>
                  </span>
                )}

                <div className="bookmarks-folder-actions">
                  <button
                    className="bookmarks-action-btn"
                    onClick={() => startRename(folder)}
                    title="Rename"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="bookmarks-action-btn"
                    onClick={() => exportFolder(folder.id)}
                    title="Export"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </button>
                  {isDeleting ? (
                    <span className="bookmarks-delete-confirm">
                      <button className="bookmarks-confirm-yes" onClick={() => confirmDelete(folder.id)}>Delete</button>
                      <button className="bookmarks-confirm-no" onClick={() => setDeletingFolderId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="bookmarks-action-btn bookmarks-action-delete"
                      onClick={() => setDeletingFolderId(folder.id)}
                      title="Delete folder"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="bookmarks-folder-items">
                  {items.length === 0 ? (
                    <div className="bookmarks-folder-empty">No bookmarks in this folder</div>
                  ) : (
                    items.map(bookmark => (
                      <div key={bookmark.id} className="bookmark-item">
                        <Link to={bookmark.route} className="bookmark-item-link">
                          <span className="bookmark-item-type" data-type={bookmark.type}>
                            {TYPE_LABELS[bookmark.type] || bookmark.type}
                          </span>
                          <span className="bookmark-item-title">{bookmark.title}</span>
                          {bookmark.note && (
                            <span className="bookmark-item-note">{bookmark.note}</span>
                          )}
                        </Link>
                        <button
                          className="bookmark-item-remove"
                          onClick={() => removeBookmark(bookmark.id)}
                          title="Remove bookmark"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BookmarksPage
