import { Routes, Route, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ContentViewer from './components/ContentViewer'
import ReferenceIndex from './components/ReferenceIndex'
import EPCBrowser from './components/EPCBrowser'
import DownloadManager from './components/DownloadManager'
import { useOffline } from './hooks/useOffline'

// Breakpoints
const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

// Swipe gesture constants
const EDGE_THRESHOLD = 30 // Distance from left edge to start detecting swipe
const SWIPE_THRESHOLD = 50 // Minimum swipe distance to trigger menu open

function App() {
  const location = useLocation()
  const [manifest, setManifest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth')
    return saved ? parseInt(saved, 10) : 320
  })
  
  // Mobile responsive state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  const [isTablet, setIsTablet] = useState(() => 
    window.innerWidth >= MOBILE_BREAKPOINT && window.innerWidth < TABLET_BREAKPOINT
  )
  
  // External navigation path for sidebar
  const [externalNavPath, setExternalNavPath] = useState(null)
  // Download Manager dropdown (top-right)
  const [showDownloadManager, setShowDownloadManager] = useState(false)
  const offlineDropdownRef = useRef(null)
  // Engine filter: null = All, 'Z20LET' = Turbo, 'Z22SE' = NA (only when manifest has multiple engines)
  const [selectedEngine, setSelectedEngine] = useState(() => {
    try {
      const s = localStorage.getItem('vx220-engine-filter')
      return s === 'Z20LET' || s === 'Z22SE' ? s : null
    } catch { return null }
  })
  
  // Swipe gesture tracking
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    isEdgeSwipe: false
  })
  
  const isResizing = useRef(false)
  const minWidth = 240
  const minContentWidth = 100 // Always keep at least 100px for content
  const columnThreshold = 450 // Switch to column layout when wider
  const { isOffline } = useOffline()

  // Update breakpoint state on window resize
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth
      setIsMobile(width < MOBILE_BREAKPOINT)
      setIsTablet(width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT)
      
      // Close mobile menu when resizing to desktop
      if (width >= TABLET_BREAKPOINT) {
        setIsMobileMenuOpen(false)
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Close mobile menu and offline dropdown on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false)
      }
      if (e.key === 'Escape' && showDownloadManager) {
        setShowDownloadManager(false)
      }
    }
    
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isMobileMenuOpen, showDownloadManager])

  // Close offline dropdown when clicking outside
  useEffect(() => {
    if (!showDownloadManager) return
    const handleClickOutside = (e) => {
      if (offlineDropdownRef.current && !offlineDropdownRef.current.contains(e.target)) {
        setShowDownloadManager(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDownloadManager])

  // Prevent body scroll when mobile menu or offline drawer is open (mobile/tablet)
  useEffect(() => {
    const lock = isMobileMenuOpen || (showDownloadManager && (isMobile || isTablet))
    if (lock) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen, showDownloadManager, isMobile, isTablet])

  // Edge swipe gesture to open menu on mobile
  useEffect(() => {
    const showMobileMenu = window.innerWidth < TABLET_BREAKPOINT
    if (!showMobileMenu) return

    const handleTouchStart = (e) => {
      // Only detect swipes when menu is closed
      if (isMobileMenuOpen) return
      
      const touch = e.touches[0]
      const startX = touch.clientX
      
      // Check if touch started near the left edge
      if (startX <= EDGE_THRESHOLD) {
        swipeRef.current = {
          startX,
          startY: touch.clientY,
          isEdgeSwipe: true
        }
      } else {
        swipeRef.current.isEdgeSwipe = false
      }
    }

    const handleTouchMove = (e) => {
      if (!swipeRef.current.isEdgeSwipe || isMobileMenuOpen) return
      
      const touch = e.touches[0]
      const deltaX = touch.clientX - swipeRef.current.startX
      const deltaY = Math.abs(touch.clientY - swipeRef.current.startY)
      
      // Check if horizontal swipe is dominant (not scrolling vertically)
      if (deltaX > SWIPE_THRESHOLD && deltaX > deltaY * 1.5) {
        // Prevent default to stop browser's back gesture
        e.preventDefault()
        // Open the menu
        setIsMobileMenuOpen(true)
        swipeRef.current.isEdgeSwipe = false
      }
    }

    const handleTouchEnd = () => {
      swipeRef.current.isEdgeSwipe = false
    }

    // Use passive: false for touchmove to allow preventDefault
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isMobileMenuOpen])

  // Handle sidebar resize (desktop only)
  const handleMouseDown = useCallback((e) => {
    if (isMobile || isTablet) return // Disable resize on mobile/tablet
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [isMobile, isTablet])

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return
    // Allow expanding up to viewport width minus minimum content area
    const maxWidth = window.innerWidth - minContentWidth
    const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX))
    setSidebarWidth(newWidth)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('sidebarWidth', sidebarWidth.toString())
    }
  }, [sidebarWidth])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // Handle menu close (must be before early returns)
  const handleMenuClose = useCallback(() => {
    setIsMobileMenuOpen(false)
  }, [])

  // Handle navigation to a component from the homepage grid
  const handleNavigateToComponent = useCallback((path) => {
    // Set the external navigation path for the sidebar
    setExternalNavPath(path)
    // Open mobile menu if on mobile/tablet
    if (window.innerWidth < TABLET_BREAKPOINT) {
      setIsMobileMenuOpen(true)
    }
  }, [])

  // Handle external navigation completion (memoized to prevent unnecessary re-renders)
  const handleExternalNavComplete = useCallback(() => {
    setExternalNavPath(null)
  }, [])

  const handleEngineChange = useCallback((engine) => {
    setSelectedEngine(engine)
    try {
      if (engine) localStorage.setItem('vx220-engine-filter', engine)
      else localStorage.removeItem('vx220-engine-filter')
    } catch (_) {}
  }, [])

  useEffect(() => {
    fetch('/data/manifest.json')
      .then(res => res.json())
      .then(data => {
        setManifest(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load manifest:', err)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (!manifest) {
    return <div className="error">Failed to load manifest</div>
  }

  // On desktop, use resizable sidebar width; on mobile/tablet, always use column layout
  const isColumnLayout = (isMobile || isTablet) ? true : sidebarWidth >= columnThreshold
  const showMobileMenu = isMobile || isTablet

  return (
    <div className="app" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      <header className="header">
        {showMobileMenu && (
          <button 
            className="menu-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={isMobileMenuOpen}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <a href="/" className="header-title">
          <h1>VX220 Service Manual</h1>
        </a>
        <nav className="header-nav">
          <a href="/epc" className="nav-pill">Parts</a>
          <a href="/ref/tools" className="nav-pill">Tools</a>
          <a href="/ref/torque" className="nav-pill">Torque</a>
          <a href="/ref/pictograms" className="nav-pill">Pictograms</a>
          <a href="/ref/glossary" className="nav-pill">Glossary</a>
        </nav>
        <div className="header-right">
        <div className="vehicle-info">
          {manifest.vehicle.make} {manifest.vehicle.model} | {manifest.vehicle.year}
          {Array.isArray(manifest.vehicle.engines) && manifest.vehicle.engines.length > 0
            ? ` | ${manifest.vehicle.engines.join(' / ')}`
            : manifest.vehicle.engine
              ? ` | ${manifest.vehicle.engine}`
              : ''}
        </div>
        {Array.isArray(manifest.vehicle.engines) && manifest.vehicle.engines.length > 1 && (
          <div className="engine-filter">
            <button
              type="button"
              className={`engine-pill ${selectedEngine === null ? 'active' : ''}`}
              onClick={() => handleEngineChange(null)}
              aria-pressed={selectedEngine === null}
            >
              All
            </button>
            {manifest.vehicle.engines.includes('Z20LET') && (
              <button
                type="button"
                className={`engine-pill engine-turbo ${selectedEngine === 'Z20LET' ? 'active' : ''}`}
                onClick={() => handleEngineChange('Z20LET')}
                aria-pressed={selectedEngine === 'Z20LET'}
              >
                Z20LET (Turbo)
              </button>
            )}
            {manifest.vehicle.engines.includes('Z22SE') && (
              <button
                type="button"
                className={`engine-pill engine-na ${selectedEngine === 'Z22SE' ? 'active' : ''}`}
                onClick={() => handleEngineChange('Z22SE')}
                aria-pressed={selectedEngine === 'Z22SE'}
              >
                Z22SE (NA)
              </button>
            )}
          </div>
        )}
        <div className="header-offline-dropdown" ref={offlineDropdownRef}>
          <button
            type="button"
            className="header-offline-trigger"
            onClick={() => setShowDownloadManager(!showDownloadManager)}
            aria-expanded={showDownloadManager}
            aria-haspopup="true"
            title={showDownloadManager ? 'Close offline downloads' : 'Offline downloads'}
          >
            <span className="header-offline-trigger-label">Offline</span>
            {isOffline && <span className="header-offline-dot" title="You are offline" />}
            <svg className={`header-offline-arrow ${showDownloadManager ? 'is-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showDownloadManager && (
            <div
              className={`header-offline-panel ${showMobileMenu ? 'header-offline-panel--fullscreen' : ''}`}
              role="dialog"
              aria-label="Offline downloads"
            >
              <DownloadManager manifest={manifest} onClose={() => setShowDownloadManager(false)} />
            </div>
          )}
        </div>
        </div>
      </header>
      <div className="main-layout">
        <Sidebar 
          sections={manifest.sections} 
          tree={manifest.tree} 
          tocIdToSlug={manifest.tocIdToSlug}
          contentTypeStats={manifest.contentTypeStats}
          selectedEngine={selectedEngine}
          isColumnLayout={isColumnLayout}
          isMobile={isMobile}
          isTablet={isTablet}
          isOpen={showMobileMenu ? isMobileMenuOpen : true}
          onClose={handleMenuClose}
          externalNavPath={externalNavPath}
          onExternalNavComplete={handleExternalNavComplete}
          onOpenOfflineDownloads={() => setShowDownloadManager(true)}
        />
        {showDownloadManager && showMobileMenu && (
          <div
            className="header-offline-backdrop"
            onClick={() => setShowDownloadManager(false)}
            onKeyDown={(e) => e.key === 'Escape' && setShowDownloadManager(false)}
            aria-hidden
          />
        )}
        {!showMobileMenu && (
          <div 
            className="sidebar-resize-handle"
            onMouseDown={handleMouseDown}
            title="Drag to resize sidebar"
          />
        )}
        <main className={`content${location.pathname === '/' ? ' is-homepage' : ''}`}>
          <Routes>
            <Route path="/" element={<ContentViewer manifest={manifest} selectedEngine={selectedEngine} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/doc/:id" element={<ContentViewer manifest={manifest} selectedEngine={selectedEngine} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/ref/:type" element={<ReferenceIndex />} />
            <Route path="/epc" element={<EPCBrowser />} />
            <Route path="/epc/:groupId/diagram/:diagramId" element={<EPCBrowser />} />
            <Route path="/epc/:groupId/:subSectionId/:mainId" element={<EPCBrowser />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default App
