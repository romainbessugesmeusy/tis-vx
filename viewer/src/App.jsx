import { Routes, Route, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ContentViewer from './components/ContentViewer'
import ReferenceIndex from './components/ReferenceIndex'

// Breakpoints
const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

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
  
  const isResizing = useRef(false)
  const minWidth = 240
  const minContentWidth = 100 // Always keep at least 100px for content
  const columnThreshold = 450 // Switch to column layout when wider

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

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false)
      }
    }
    
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isMobileMenuOpen])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
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
          <a href="/ref/tools" className="nav-pill">Tools</a>
          <a href="/ref/torque" className="nav-pill">Torque</a>
          <a href="/ref/pictograms" className="nav-pill">Pictograms</a>
          <a href="/ref/glossary" className="nav-pill">Glossary</a>
        </nav>
        <div className="vehicle-info">
          {manifest.vehicle.make} {manifest.vehicle.model} | {manifest.vehicle.year} | {manifest.vehicle.engine}
        </div>
      </header>
      <div className="main-layout">
        <Sidebar 
          sections={manifest.sections} 
          tree={manifest.tree} 
          tocIdToSlug={manifest.tocIdToSlug}
          contentTypeStats={manifest.contentTypeStats}
          isColumnLayout={isColumnLayout}
          isMobile={isMobile}
          isTablet={isTablet}
          isOpen={showMobileMenu ? isMobileMenuOpen : true}
          onClose={handleMenuClose}
          externalNavPath={externalNavPath}
          onExternalNavComplete={() => setExternalNavPath(null)}
        />
        {!showMobileMenu && (
          <div 
            className="sidebar-resize-handle"
            onMouseDown={handleMouseDown}
            title="Drag to resize sidebar"
          />
        )}
        <main className={`content${location.pathname === '/' ? ' is-homepage' : ''}`}>
          <Routes>
            <Route path="/" element={<ContentViewer manifest={manifest} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/doc/:id" element={<ContentViewer manifest={manifest} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/ref/:type" element={<ReferenceIndex />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default App
