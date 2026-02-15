import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DownloadManager from './DownloadManager'

const REFERENCE_TYPES = [
  { key: 'tools', label: 'Tools' },
  { key: 'torque', label: 'Torque' },
  { key: 'pictograms', label: 'Pictograms' },
  { key: 'glossary', label: 'Glossary' },
]

// SVG icon components (inline for simplicity)
const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)

const IconBook = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>
)

const IconParts = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)

const IconResources = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>
)

const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
)

const IconChevron = ({ className }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

function AppHeader({
  manifest,
  selectedEngine,
  onEngineChange,
  isOffline,
  isMobile,
  isTablet,
  onMenuToggle,
  onNavigateToNode,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [breadcrumbPopoverOpen, setBreadcrumbPopoverOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState(null) // 'resources' | 'settings' | null
  const headerRef = useRef(null)
  
  const showMobileMenu = isMobile || isTablet

  // Close everything on route change
  useEffect(() => {
    setActiveDropdown(null)
    setBreadcrumbPopoverOpen(false)
  }, [location.pathname])

  // Close on click outside
  useEffect(() => {
    if (!activeDropdown && !breadcrumbPopoverOpen) return
    const handle = (e) => {
      if (headerRef.current && !headerRef.current.contains(e.target)) {
        setActiveDropdown(null)
        setBreadcrumbPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [activeDropdown, breadcrumbPopoverOpen])

  // Close on Escape
  useEffect(() => {
    if (!activeDropdown && !breadcrumbPopoverOpen) return
    const handle = (e) => {
      if (e.key === 'Escape') {
        setActiveDropdown(null)
        setBreadcrumbPopoverOpen(false)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [activeDropdown, breadcrumbPopoverOpen])

  // Build slug → tree node ID mapping (tree nodes use m_xxx IDs, not tocIds)
  const slugToNodeId = useMemo(() => {
    const map = {}
    if (!manifest?.tree?.nodes) return map
    for (const [nodeId, node] of Object.entries(manifest.tree.nodes)) {
      if (node.isLeaf && node.variants) {
        for (const variant of Object.values(node.variants)) {
          if (variant.slug) {
            map[variant.slug] = nodeId
          }
        }
      }
    }
    return map
  }, [manifest])

  // Build breadcrumb from current route + manifest tree
  const breadcrumb = useMemo(() => {
    const path = location.pathname
    
    // Homepage
    if (path === '/') {
      return [{ label: 'Manual', href: '/' }]
    }

    // Document page: trace tree ancestors
    if (path.startsWith('/doc/')) {
      const slug = path.slice(5)
      const crumbs = [{ label: 'Manual', href: '/' }]
      
      const nodeId = slugToNodeId[slug]
      if (nodeId && manifest?.tree?.nodes[nodeId]) {
        // Walk up from node to root, collecting ancestors
        const ancestors = []
        let current = nodeId
        while (current) {
          const node = manifest.tree.nodes[current]
          if (!node) break
          ancestors.unshift({ 
            label: node.title, 
            nodeId: current,
            isLeaf: node.isLeaf,
          })
          current = node.parentId
        }
        ancestors.forEach(a => crumbs.push(a))
      }
      
      return crumbs
    }

    // Reference pages
    if (path.startsWith('/ref/')) {
      const type = path.slice(5)
      const ref = REFERENCE_TYPES.find(r => r.key === type)
      return [
        { label: 'Resources' },
        { label: ref?.label || type, href: path },
      ]
    }

    // EPC pages
    if (path.startsWith('/epc')) {
      return [{ label: 'Parts', href: '/epc' }]
    }

    return [{ label: 'Manual', href: '/' }]
  }, [location.pathname, manifest, slugToNodeId])

  // Current page title (last breadcrumb segment)
  const currentTitle = breadcrumb.length > 0 
    ? breadcrumb[breadcrumb.length - 1].label 
    : 'Service Manual'

  // Which top-level section is active
  const activeSection = useMemo(() => {
    const path = location.pathname
    if (path.startsWith('/epc')) return 'parts'
    if (path.startsWith('/ref')) return 'resources'
    return 'manual'
  }, [location.pathname])

  const hasMultipleEngines = Array.isArray(manifest?.vehicle?.engines) 
    && manifest.vehicle.engines.length > 1

  // Navigation helpers
  const handleNav = useCallback((href) => {
    navigate(href)
    setActiveDropdown(null)
    setBreadcrumbPopoverOpen(false)
  }, [navigate])

  const handleBreadcrumbClick = useCallback((crumb, index) => {
    if (crumb.href) {
      handleNav(crumb.href)
      return
    }
    // For tree nodes: navigate sidebar to that path
    if (crumb.nodeId && onNavigateToNode) {
      const path = breadcrumb
        .slice(1, index + 1) // skip the root "Manual"/"Parts"
        .filter(c => c.nodeId)
        .map(c => c.nodeId)
      if (path.length > 0) {
        onNavigateToNode(path)
      }
    }
    setBreadcrumbPopoverOpen(false)
  }, [breadcrumb, handleNav, onNavigateToNode])

  const toggleDropdown = useCallback((name) => {
    setActiveDropdown(prev => prev === name ? null : name)
    setBreadcrumbPopoverOpen(false)
  }, [])

  const toggleBreadcrumbPopover = useCallback(() => {
    setBreadcrumbPopoverOpen(prev => !prev)
    setActiveDropdown(null)
  }, [])

  return (
    <header className="header" ref={headerRef}>
      {/* Left: hamburger + logo */}
      <div className="header-left">
        {showMobileMenu && (
          <button className="header-icon-btn" onClick={onMenuToggle} aria-label="Open menu">
            <IconMenu />
          </button>
        )}
        <button className="header-logo" onClick={() => handleNav('/')}>
          VX220
        </button>
      </div>

      {/* Center: breadcrumb */}
      <div className="header-center">
        {showMobileMenu ? (
          /* Mobile: compact page title → popover on tap */
          <button 
            className="header-page-title" 
            onClick={toggleBreadcrumbPopover} 
            aria-expanded={breadcrumbPopoverOpen}
          >
            <span className="header-page-title-text">{currentTitle}</span>
            <IconChevron className={`header-chevron ${breadcrumbPopoverOpen ? 'open' : ''}`} />
          </button>
        ) : (
          /* Desktop: full breadcrumb trail */
          <nav className="header-breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="header-crumb">
                {i > 0 && <span className="header-crumb-sep">/</span>}
                {i < breadcrumb.length - 1 ? (
                  <button 
                    className="header-crumb-btn" 
                    onClick={() => handleBreadcrumbClick(crumb, i)}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="header-crumb-current">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {/* Breadcrumb popover (mobile) */}
        {breadcrumbPopoverOpen && (
          <div className="header-popover breadcrumb-popover">
            {/* Breadcrumb path */}
            {breadcrumb.length > 1 && (
              <div className="popover-section popover-path">
                <div className="popover-section-title">Current location</div>
                {breadcrumb.map((crumb, i) => (
                  <button
                    key={i}
                    className={`popover-path-item ${i === breadcrumb.length - 1 ? 'current' : ''}`}
                    style={{ paddingLeft: `${i * 16 + 12}px` }}
                    onClick={() => handleBreadcrumbClick(crumb, i)}
                  >
                    {crumb.label}
                  </button>
                ))}
              </div>
            )}
            
            {/* Top-level navigation */}
            <div className="popover-section popover-nav">
              <div className="popover-section-title">Navigate</div>
              <button 
                className={`popover-nav-item ${activeSection === 'manual' ? 'active' : ''}`} 
                onClick={() => handleNav('/')}
              >
                <IconBook />
                Manual
              </button>
              <button 
                className={`popover-nav-item ${activeSection === 'parts' ? 'active' : ''}`} 
                onClick={() => handleNav('/epc')}
              >
                <IconParts />
                Parts
              </button>
              <div className="popover-divider" />
              {REFERENCE_TYPES.map(ref => (
                <button 
                  key={ref.key} 
                  className={`popover-nav-item ${location.pathname === `/ref/${ref.key}` ? 'active' : ''}`} 
                  onClick={() => handleNav(`/ref/${ref.key}`)}
                >
                  <IconResources />
                  {ref.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: nav actions */}
      <div className="header-right">
        {/* Manual / Parts toggle (desktop only) */}
        {!showMobileMenu && (
          <>
            <button
              className={`header-nav-btn ${activeSection === 'manual' ? 'active' : ''}`}
              onClick={() => handleNav('/')}
              title="Manual"
            >
              <IconBook />
            </button>
            <button
              className={`header-nav-btn ${activeSection === 'parts' ? 'active' : ''}`}
              onClick={() => handleNav('/epc')}
              title="Parts"
            >
              <IconParts />
            </button>
          </>
        )}

        {/* Resources dropdown (desktop only) */}
        {!showMobileMenu && (
          <div className="header-dropdown-wrap">
            <button
              className={`header-nav-btn ${activeSection === 'resources' ? 'active' : ''}`}
              onClick={() => toggleDropdown('resources')}
              aria-expanded={activeDropdown === 'resources'}
              title="Resources"
            >
              <IconResources />
              <IconChevron className={`header-chevron-sm ${activeDropdown === 'resources' ? 'open' : ''}`} />
            </button>
            {activeDropdown === 'resources' && (
              <div className="header-popover resources-popover">
                {REFERENCE_TYPES.map(ref => (
                  <button
                    key={ref.key}
                    className={`popover-nav-item ${location.pathname === `/ref/${ref.key}` ? 'active' : ''}`}
                    onClick={() => handleNav(`/ref/${ref.key}`)}
                  >
                    {ref.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings dropdown */}
        <div className="header-dropdown-wrap">
          <button
            className={`header-nav-btn ${activeDropdown === 'settings' ? 'active' : ''}`}
            onClick={() => toggleDropdown('settings')}
            aria-expanded={activeDropdown === 'settings'}
            title="Settings"
          >
            <IconSettings />
            {isOffline && <span className="header-offline-dot" />}
          </button>
          {activeDropdown === 'settings' && (
            <>
              {showMobileMenu && (
                <div 
                  className="header-backdrop" 
                  onClick={() => setActiveDropdown(null)} 
                />
              )}
              <div className={`header-popover settings-popover ${showMobileMenu ? 'settings-fullscreen' : ''}`}>
                <div className="settings-popover-inner">
                  {showMobileMenu && (
                    <div className="settings-popover-header">
                      <span>Settings</span>
                      <button className="settings-close-btn" onClick={() => setActiveDropdown(null)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}
                  
                  {/* Engine filter */}
                  {hasMultipleEngines && (
                    <div className="settings-section">
                      <div className="settings-section-label">Engine Filter</div>
                      <div className="settings-engine-pills">
                        <button
                          className={`settings-engine-pill ${selectedEngine === null ? 'active' : ''}`}
                          onClick={() => onEngineChange(null)}
                        >
                          All
                        </button>
                        {manifest.vehicle.engines.includes('Z20LET') && (
                          <button
                            className={`settings-engine-pill turbo ${selectedEngine === 'Z20LET' ? 'active' : ''}`}
                            onClick={() => onEngineChange('Z20LET')}
                          >
                            Z20LET (Turbo)
                          </button>
                        )}
                        {manifest.vehicle.engines.includes('Z22SE') && (
                          <button
                            className={`settings-engine-pill na ${selectedEngine === 'Z22SE' ? 'active' : ''}`}
                            onClick={() => onEngineChange('Z22SE')}
                          >
                            Z22SE (NA)
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Downloads */}
                  <div className="settings-section settings-downloads">
                    <div className="settings-section-label">
                      Downloads
                      {isOffline && <span className="settings-offline-badge">Offline</span>}
                    </div>
                    <DownloadManager manifest={manifest} onClose={() => setActiveDropdown(null)} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default AppHeader
