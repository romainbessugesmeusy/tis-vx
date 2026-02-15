import { Routes, Route, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ContentViewer from './components/ContentViewer'
import ReferenceIndex from './components/ReferenceIndex'
import EPCBrowser from './components/EPCBrowser'
import ChatPanel from './components/ChatPanel'
import AppHeader from './components/AppHeader'
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
      <AppHeader
        manifest={manifest}
        selectedEngine={selectedEngine}
        onEngineChange={handleEngineChange}
        isOffline={isOffline}
        isMobile={isMobile}
        isTablet={isTablet}
        onMenuToggle={() => setIsMobileMenuOpen(true)}
        onNavigateToNode={handleNavigateToComponent}
      />
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
            <Route path="/" element={<ContentViewer manifest={manifest} selectedEngine={selectedEngine} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/doc/:id" element={<ContentViewer manifest={manifest} selectedEngine={selectedEngine} onNavigateToComponent={handleNavigateToComponent} />} />
            <Route path="/ref/:type" element={<ReferenceIndex />} />
            <Route path="/epc" element={<EPCBrowser />} />
            <Route path="/epc/:groupId/diagram/:diagramId" element={<EPCBrowser />} />
            <Route path="/epc/:groupId/:subSectionId/:mainId" element={<EPCBrowser />} />
          </Routes>
        </main>
        <ChatPanel selectedEngine={selectedEngine} />
      </div>
    </div>
  )
}

export default App
