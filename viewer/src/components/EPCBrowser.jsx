import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import MapViewer from './MapViewer'
import PartThumbnail from './PartThumbnail'

/**
 * EPC (Electronic Parts Catalog) Browser
 * Displays parts grouped by diagram when a main item is selected
 * Navigation is handled by the Sidebar component
 */

// Group icons mapping
const GROUP_ICONS = {
  A: '🚗', B: '🔩', C: '🪟', D: '💺', E: '⚙️', F: '❄️', G: '⛽', H: '🔧',
  J: '🛞', K: '🏎️', L: '🎯', M: '🔄', N: '⭕', P: '⚡', Q: '📦', R: '🚙',
}

function EPCBrowser() {
  const { groupId, subSectionId, mainId } = useParams()
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hotspots, setHotspots] = useState({}) // Map of diagramId -> hotspots
  const [highlightedRef, setHighlightedRef] = useState(null)
  const [selectedRef, setSelectedRef] = useState(null) // Selected from parts list (click)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [expandedDiagrams, setExpandedDiagrams] = useState(new Set())

  // Load EPC data
  useEffect(() => {
    fetch('/data/epc/parts.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load parts catalog')
        return res.json()
      })
      .then(json => {
        setData(json)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  // Get current navigation context
  const { currentGroup, currentSubSection, currentMain, parts } = useMemo(() => {
    if (!data) return { currentGroup: null, currentSubSection: null, currentMain: null, parts: [] }
    
    const group = groupId ? data.groups.find(g => g.id === groupId) : null
    const subSection = group && subSectionId 
      ? group.subSections.find(s => s.id === subSectionId) 
      : null
    const main = subSection && mainId 
      ? subSection.main.find(m => m.id === mainId) 
      : null
    
    return {
      currentGroup: group,
      currentSubSection: subSection,
      currentMain: main,
      parts: main?.parts || []
    }
  }, [data, groupId, subSectionId, mainId])

  // Group parts by diagram
  const partsByDiagram = useMemo(() => {
    if (!parts.length) return []
    
    const groups = new Map()
    
    for (const part of parts) {
      const diagramId = part.diagramId || '_none'
      if (!groups.has(diagramId)) {
        groups.set(diagramId, [])
      }
      groups.get(diagramId).push(part)
    }
    
    // Convert to array and get diagram info
    return Array.from(groups.entries()).map(([diagramId, groupParts]) => ({
      diagramId,
      diagram: diagramId !== '_none' && data?.diagrams?.[diagramId] ? data.diagrams[diagramId] : null,
      parts: groupParts
    }))
  }, [parts, data])

  // Expand all diagrams by default when parts change
  useEffect(() => {
    if (partsByDiagram.length > 0) {
      setExpandedDiagrams(new Set(partsByDiagram.map(g => g.diagramId)))
    }
  }, [partsByDiagram])

  // Load hotspots for all diagrams in current view
  useEffect(() => {
    if (!partsByDiagram.length) return
    
    const diagramIds = partsByDiagram
      .filter(g => g.diagramId !== '_none' && g.diagram)
      .map(g => g.diagramId)
    
    // Load hotspots for each diagram
    diagramIds.forEach(diagramId => {
      if (!hotspots[diagramId]) {
        fetch(`/data/epc/hotspots/${diagramId}.json`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setHotspots(prev => ({ ...prev, [diagramId]: data }))
            }
          })
          .catch(() => {})
      }
    })
  }, [partsByDiagram])

  // Filter parts by search query
  const filteredPartsByDiagram = useMemo(() => {
    if (!searchQuery.trim()) return partsByDiagram
    
    const query = searchQuery.toLowerCase()
    return partsByDiagram
      .map(group => ({
        ...group,
        parts: group.parts.filter(part => 
          part.description?.toLowerCase().includes(query) ||
          part.partNo?.toLowerCase().includes(query) ||
          part.katNo?.toLowerCase().includes(query) ||
          part.ref?.toString().includes(query)
        )
      }))
      .filter(group => group.parts.length > 0)
  }, [partsByDiagram, searchQuery])

  // Sort parts within each group
  const sortedPartsByDiagram = useMemo(() => {
    if (!sortConfig.key) return filteredPartsByDiagram
    
    return filteredPartsByDiagram.map(group => ({
      ...group,
      parts: [...group.parts].sort((a, b) => {
        const aVal = a[sortConfig.key] || ''
        const bVal = b[sortConfig.key] || ''
        
        if (sortConfig.key === 'ref' || sortConfig.key === 'qty') {
          const aNum = parseInt(aVal) || 0
          const bNum = parseInt(bVal) || 0
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum
        }
        
        const comparison = aVal.toString().localeCompare(bVal.toString())
        return sortConfig.direction === 'asc' ? comparison : -comparison
      })
    }))
  }, [filteredPartsByDiagram, sortConfig])

  // Handle sort click
  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }))
  }, [])

  // Toggle diagram expansion
  const toggleDiagram = useCallback((diagramId) => {
    setExpandedDiagrams(prev => {
      const next = new Set(prev)
      if (next.has(diagramId)) {
        next.delete(diagramId)
      } else {
        next.add(diagramId)
      }
      return next
    })
  }, [])

  // Compare refs (handles string/number mismatch)
  const refsMatch = useCallback((ref1, ref2) => {
    if (ref1 === null || ref2 === null || ref1 === undefined || ref2 === undefined) return false
    return String(ref1) === String(ref2)
  }, [])

  // Get part info for currently highlighted or selected ref
  const getActivePartInfo = useCallback((groupParts, activeRef) => {
    if (!activeRef) return null
    return groupParts.find(p => refsMatch(p.ref, activeRef))
  }, [refsMatch])

  // Find hotspot for a given ref in a diagram's hotspots
  const findHotspotForRef = useCallback((diagramHotspots, ref) => {
    if (!diagramHotspots?.hotspots || ref === undefined) return null
    return diagramHotspots.hotspots.find(h => refsMatch(h.ref, ref))
  }, [refsMatch])

  // Global search across all parts (for home page)
  const globalSearchResults = useMemo(() => {
    if (!data || !searchQuery.trim() || mainId) return null
    
    const query = searchQuery.toLowerCase()
    const results = []
    
    for (const group of data.groups) {
      for (const subSection of group.subSections) {
        for (const main of subSection.main) {
          for (const part of main.parts) {
            if (
              part.description?.toLowerCase().includes(query) ||
              part.partNo?.toLowerCase().includes(query) ||
              part.katNo?.toLowerCase().includes(query)
            ) {
              results.push({
                ...part,
                groupId: group.id,
                groupName: group.name,
                subSectionId: subSection.id,
                subSectionName: subSection.name,
                mainId: main.id,
                mainName: main.name,
              })
            }
          }
        }
      }
    }
    
    return results.slice(0, 100) // Limit results
  }, [data, searchQuery, mainId])

  if (loading) {
    return (
      <div className="epc-loading">
        <div className="epc-spinner" />
        <p>Loading Parts Catalog...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="epc-error">
        <span className="epc-error-icon">⚠️</span>
        <h2>Parts Catalog Not Available</h2>
        <p>{error}</p>
        <p className="epc-error-hint">
          Run <code>node scrape-epc.js</code> to download the parts catalog.
        </p>
      </div>
    )
  }

  // Render breadcrumb navigation
  const renderBreadcrumb = () => {
    if (!currentGroup) return null
    
    return (
      <nav className="epc-breadcrumb">
        <span className="epc-breadcrumb-item epc-breadcrumb-root">
          {GROUP_ICONS[groupId]} {currentGroup.name}
        </span>
        {currentSubSection && (
          <>
            <span className="epc-breadcrumb-sep">›</span>
            <span className="epc-breadcrumb-item">{currentSubSection.name}</span>
          </>
        )}
        {currentMain && (
          <>
            <span className="epc-breadcrumb-sep">›</span>
            <span className="epc-breadcrumb-current">{currentMain.name}</span>
          </>
        )}
      </nav>
    )
  }

  // Home view - shows global search
  const renderHome = () => (
    <div className="epc-home">
      <div className="epc-header">
        <h1>🔧 Parts Catalog</h1>
        <p className="epc-subtitle">Electronic Parts Catalog for Opel/Vauxhall Speedster & VX220</p>
        <p className="epc-stats">
          {data.groups.length} groups • {data.groups.reduce((acc, g) => acc + g.subSections.length, 0)} sections • {data.groups.reduce((acc, g) => acc + g.subSections.reduce((a, s) => a + s.main.reduce((x, m) => x + m.parts.length, 0), 0), 0).toLocaleString()} parts
        </p>
      </div>
      
      <div className="epc-search-container epc-search-large">
        <input
          type="text"
          placeholder="Search all parts by description, part number, or catalog number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="epc-search-input"
          autoFocus
        />
        {searchQuery && (
          <button className="epc-search-clear" onClick={() => setSearchQuery('')}>×</button>
        )}
      </div>

      {globalSearchResults && globalSearchResults.length > 0 ? (
        <div className="epc-search-results">
          <h3>Search Results ({globalSearchResults.length}{globalSearchResults.length === 100 ? '+' : ''})</h3>
          <div className="epc-parts-list">
            {globalSearchResults.map((part, idx) => (
              <Link 
                key={idx} 
                to={`/epc/${part.groupId}/${part.subSectionId}/${part.mainId}`}
                className="epc-part-card"
              >
                <div className="epc-part-card-header">
                  <span className="epc-part-ref">{part.ref}</span>
                  <span className="epc-part-location">{GROUP_ICONS[part.groupId]} {part.mainName}</span>
                </div>
                <div className="epc-part-card-body">
                  <div className="epc-part-description">{part.description}</div>
                  <div className="epc-part-numbers">
                    <span className="epc-part-partno">{part.partNo}</span>
                    {part.katNo && <span className="epc-part-katno">{part.katNo}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : globalSearchResults && globalSearchResults.length === 0 ? (
        <div className="epc-no-results">
          <p>No parts found matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="epc-home-hint">
          <p>Use the sidebar to browse parts by category, or search above.</p>
        </div>
      )}
    </div>
  )

  // Render a single part card (mobile-first)
  const renderPartCard = (part, diagramId, diagram, diagramHotspots) => {
    const hotspot = findHotspotForRef(diagramHotspots, part.ref)
    return (
      <div 
        key={`${part.partNo}-${part.ref}`}
        className={`epc-part-card ${refsMatch(highlightedRef, part.ref) ? 'highlighted' : ''} ${refsMatch(selectedRef, part.ref) ? 'selected' : ''}`}
        onMouseEnter={() => setHighlightedRef(part.ref)}
        onMouseLeave={() => setHighlightedRef(null)}
      >
        <div className="epc-part-card-header">
          {diagram && hotspot && (
            <PartThumbnail
              diagramSrc={`/data/epc/diagrams/${diagram.filename}`}
              hotspot={hotspot}
              size={32}
              padding={4}
            />
          )}
          <button 
            className={`epc-part-ref ${refsMatch(selectedRef, part.ref) ? 'selected' : ''}`}
            onClick={() => setSelectedRef(prev => refsMatch(prev, part.ref) ? null : part.ref)}
          >
            {part.ref}
          </button>
          {part.usage && <span className="epc-part-usage">{part.usage}</span>}
          {part.qty && <span className="epc-part-qty">×{part.qty}</span>}
        </div>
        <div className="epc-part-card-body">
          <div className="epc-part-description">{part.description}</div>
          <div className="epc-part-numbers">
            <span className="epc-part-partno">{part.partNo}</span>
            {part.katNo && <span className="epc-part-katno">{part.katNo}</span>}
          </div>
        </div>
      </div>
    )
  }

  // Render parts table (desktop)
  const renderPartsTable = (groupParts, diagramId, diagram, diagramHotspots) => (
    <div className="epc-parts-table-container">
      <table className="epc-parts-table">
        <thead>
          <tr>
            <th className="epc-thumb-header"></th>
            <th onClick={() => handleSort('ref')} className="sortable">
              Ref {sortConfig.key === 'ref' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('description')} className="sortable">
              Description {sortConfig.key === 'description' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('usage')} className="sortable">
              Usage {sortConfig.key === 'usage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('qty')} className="sortable">
              Qty {sortConfig.key === 'qty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('partNo')} className="sortable">
              Part No {sortConfig.key === 'partNo' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th onClick={() => handleSort('katNo')} className="sortable">
              Kat No {sortConfig.key === 'katNo' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
          </tr>
        </thead>
        <tbody>
          {groupParts.map((part, idx) => {
            const hotspot = findHotspotForRef(diagramHotspots, part.ref)
            return (
              <tr 
                key={idx} 
                className={`${refsMatch(highlightedRef, part.ref) ? 'highlighted' : ''} ${refsMatch(selectedRef, part.ref) ? 'selected' : ''}`}
                onMouseEnter={() => setHighlightedRef(part.ref)}
                onMouseLeave={() => setHighlightedRef(null)}
              >
                <td className="epc-thumb-cell">
                  {diagram && hotspot && (
                    <PartThumbnail
                      diagramSrc={`/data/epc/diagrams/${diagram.filename}`}
                      hotspot={hotspot}
                      size={36}
                      padding={5}
                    />
                  )}
                </td>
                <td className="epc-ref-cell">
                  <button 
                    className={`epc-ref-badge ${refsMatch(selectedRef, part.ref) ? 'selected' : ''}`}
                    onClick={() => setSelectedRef(prev => refsMatch(prev, part.ref) ? null : part.ref)}
                    title="Click to highlight on diagram"
                  >
                    {part.ref}
                  </button>
                </td>
                <td className="epc-desc-cell">{part.description}</td>
                <td className="epc-usage-cell">{part.usage}</td>
                <td className="epc-qty-cell">{part.qty}</td>
                <td className="epc-partno-cell">{part.partNo}</td>
                <td className="epc-katno-cell">{part.katNo}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  // Render diagram group
  const renderDiagramGroup = (group) => {
    const { diagramId, diagram, parts: groupParts } = group
    const isExpanded = expandedDiagrams.has(diagramId)
    const diagramHotspots = hotspots[diagramId]
    const activeRef = selectedRef || highlightedRef
    const activePartInfo = getActivePartInfo(groupParts, activeRef)
    
    return (
      <div key={diagramId} className="epc-diagram-group">
        {/* Diagram Header */}
        <button 
          className={`epc-diagram-header ${isExpanded ? 'expanded' : ''}`}
          onClick={() => toggleDiagram(diagramId)}
        >
          <svg className="epc-diagram-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="epc-diagram-title">
            {currentMain?.name || (diagram ? `Diagram ${diagramHotspots?.sheetCode?.text || ''}` : 'Parts without diagram')}
          </span>
          <span className="epc-diagram-count">{groupParts.length} parts</span>
        </button>
        
        {isExpanded && (
          <div className="epc-diagram-content">
            {/* Diagram Viewer */}
            {diagram && (
              <div className="epc-diagram-viewer-wrapper">
                <MapViewer
                  src={`/data/epc/diagrams/${diagram.filename}`}
                  alt={`Parts diagram`}
                  allowFullscreen={true}
                  hotspots={diagramHotspots}
                  highlightedRef={activeRef}
                  onHotspotHover={setHighlightedRef}
                  onHotspotClick={(ref) => setSelectedRef(prev => refsMatch(prev, ref) ? null : ref)}
                  className="epc-diagram-map"
                />
              </div>
            )}
            
            {/* Part Info Bar - shows selected/hovered part info */}
            <div className={`epc-part-info-bar ${activePartInfo ? 'visible' : ''}`}>
              {activePartInfo && (
                <>
                  <span className="epc-part-info-ref">#{activePartInfo.ref}</span>
                  <span className="epc-part-info-desc">{activePartInfo.description}</span>
                  <span className="epc-part-info-partno">{activePartInfo.partNo}</span>
                  {activePartInfo.usage && <span className="epc-part-info-usage">{activePartInfo.usage}</span>}
                  {activePartInfo.qty && <span className="epc-part-info-qty">Qty: {activePartInfo.qty}</span>}
                </>
              )}
            </div>
            
            {/* Parts List - Card view for mobile, table for desktop */}
            <div className="epc-parts-responsive">
              {/* Mobile: Card layout */}
              <div className="epc-parts-cards">
                {groupParts.map(part => renderPartCard(part, diagramId, diagram, diagramHotspots))}
              </div>
              
              {/* Desktop: Table layout */}
              <div className="epc-parts-table-wrapper">
                {renderPartsTable(groupParts, diagramId, diagram, diagramHotspots)}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render main parts view (grouped by diagram)
  const renderPartsView = () => (
    <div className="epc-parts epc-parts-compact">
      {/* Diagram Groups - directly render without extra headers */}
      <div className="epc-diagram-groups">
        {sortedPartsByDiagram.map(group => renderDiagramGroup(group))}
      </div>

      {sortedPartsByDiagram.length === 0 && searchQuery && (
        <div className="epc-no-results">
          <p>No parts match "{searchQuery}"</p>
        </div>
      )}
    </div>
  )

  // Main render logic - Show home if no main item selected
  if (!mainId) {
    return renderHome()
  }

  if (!currentMain) {
    return (
      <div className="epc-error">
        <p>Part section not found</p>
        <Link to="/epc">Back to Parts Catalog</Link>
      </div>
    )
  }

  return renderPartsView()
}

export default EPCBrowser
