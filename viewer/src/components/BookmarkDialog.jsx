import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useBookmarks } from '../hooks/useBookmarks'

const BookmarkContext = createContext(null)

export function useBookmarkContext() {
  return useContext(BookmarkContext)
}

export function BookmarkProvider({ children }) {
  const bookmarks = useBookmarks()
  const [dialogData, setDialogData] = useState(null) // null = closed, object = open with prefill

  const openBookmarkDialog = useCallback((prefill) => {
    setDialogData(prefill)
  }, [])

  const closeBookmarkDialog = useCallback(() => {
    setDialogData(null)
  }, [])

  return (
    <BookmarkContext.Provider value={{ ...bookmarks, openBookmarkDialog, closeBookmarkDialog }}>
      {children}
      {dialogData && (
        <BookmarkDialog
          prefill={dialogData}
          folders={bookmarks.folders}
          onSave={(bookmark, folderId, folderName) => {
            let targetFolderId = folderId
            if (!targetFolderId && folderName) {
              const folder = bookmarks.createFolder(folderName)
              targetFolderId = folder.id
            }
            if (targetFolderId) {
              bookmarks.addBookmark({ ...bookmark, folderId: targetFolderId })
            }
            closeBookmarkDialog()
          }}
          onClose={closeBookmarkDialog}
        />
      )}
    </BookmarkContext.Provider>
  )
}

function BookmarkDialog({ prefill, folders, onSave, onClose }) {
  const [title, setTitle] = useState(prefill.title || '')
  const [note, setNote] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState(folders[0]?.id || '')
  const [isCreatingFolder, setIsCreatingFolder] = useState(folders.length === 0)
  const [newFolderName, setNewFolderName] = useState('')
  const dialogRef = useRef(null)
  const folderInputRef = useRef(null)

  useEffect(() => {
    if (isCreatingFolder && folderInputRef.current) {
      folderInputRef.current.focus()
    }
  }, [isCreatingFolder])

  // Close on Escape
  useEffect(() => {
    const handle = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onClose])

  // Focus trap and backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  const handleSave = useCallback(() => {
    const bookmark = {
      type: prefill.type,
      title: title.trim() || prefill.title || 'Untitled',
      note: note.trim(),
      route: prefill.route,
      context: prefill.context,
    }
    if (isCreatingFolder) {
      const name = newFolderName.trim()
      if (!name) return
      onSave(bookmark, null, name)
    } else {
      if (!selectedFolderId) return
      onSave(bookmark, selectedFolderId, null)
    }
  }, [prefill, title, note, selectedFolderId, isCreatingFolder, newFolderName, onSave])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
  }, [handleSave])

  const canSave = isCreatingFolder ? newFolderName.trim().length > 0 : !!selectedFolderId

  return (
    <div className="bookmark-dialog-backdrop" onClick={handleBackdropClick}>
      <div className="bookmark-dialog" ref={dialogRef} onKeyDown={handleKeyDown}>
        <div className="bookmark-dialog-header">
          <h3>Add Bookmark</h3>
          <button className="bookmark-dialog-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="bookmark-dialog-body">
          <div className="bookmark-dialog-type-badge" data-type={prefill.type}>
            {prefill.type === 'manual' && 'Manual Page'}
            {prefill.type === 'epc-diagram' && 'Diagram'}
            {prefill.type === 'epc-part' && 'Part'}
            {prefill.type === 'tool' && 'Tool'}
            {prefill.type === 'torque' && 'Torque Spec'}
          </div>

          <label className="bookmark-dialog-field">
            <span className="bookmark-dialog-label">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bookmark-dialog-input"
              autoFocus
            />
          </label>

          <label className="bookmark-dialog-field">
            <span className="bookmark-dialog-label">Folder</span>
            {!isCreatingFolder ? (
              <div className="bookmark-dialog-folder-row">
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="bookmark-dialog-select"
                >
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="bookmark-dialog-new-folder-btn"
                  onClick={() => setIsCreatingFolder(true)}
                  title="New folder"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="bookmark-dialog-folder-row">
                <input
                  ref={folderInputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="bookmark-dialog-input"
                />
                {folders.length > 0 && (
                  <button
                    type="button"
                    className="bookmark-dialog-new-folder-btn"
                    onClick={() => setIsCreatingFolder(false)}
                    title="Choose existing folder"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </label>

          <label className="bookmark-dialog-field">
            <span className="bookmark-dialog-label">Note <span className="bookmark-dialog-optional">(optional)</span></span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bookmark-dialog-textarea"
              rows={3}
              placeholder="Add a note..."
            />
          </label>
        </div>

        <div className="bookmark-dialog-footer">
          <button className="bookmark-dialog-cancel" onClick={onClose}>Cancel</button>
          <button
            className="bookmark-dialog-save"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default BookmarkDialog
