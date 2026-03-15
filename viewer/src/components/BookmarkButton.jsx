import { useCallback } from 'react'
import { useBookmarkContext } from './BookmarkDialog'

const IconBookmarkOutline = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
)

const IconBookmarkFilled = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
)

/**
 * Inline bookmark button for individual items (tools, torque, parts).
 * Shows filled icon if the item is already bookmarked.
 */
function BookmarkButton({ type, title, route, context, className = '' }) {
  const { isBookmarked, openBookmarkDialog } = useBookmarkContext()
  const bookmarked = isBookmarked(type, route, context)

  const handleClick = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    openBookmarkDialog({ type, title, route, context })
  }, [type, title, route, context, openBookmarkDialog])

  return (
    <button
      className={`bookmark-btn ${bookmarked ? 'bookmarked' : ''} ${className}`}
      onClick={handleClick}
      title={bookmarked ? 'Bookmarked' : 'Add bookmark'}
      aria-label={bookmarked ? 'Bookmarked' : 'Add bookmark'}
    >
      {bookmarked ? <IconBookmarkFilled /> : <IconBookmarkOutline />}
    </button>
  )
}

export default BookmarkButton
