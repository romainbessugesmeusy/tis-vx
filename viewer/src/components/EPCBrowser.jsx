import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'

/**
 * EPC (Electronic Parts Catalog) Browser
 * Displays parts table when a main item is selected
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
  const [selectedDiagram, setSelectedDiagram] = useState(null)
  const [hotspots, setHotspots] = useState(null)
  const [highlightedRef, setHighlightedRef] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const diagramImageRef = useRef(null)
  const [diagramLoaded, setDiagramLoaded] = useState(false)

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

  // Filter parts by search query
  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return parts
    
    const query = searchQuery.toLowerCase()
    return parts.filter(part => 
      part.description?.toLowerCase().includes(query) ||
      part.partNo?.toLowerCase().includes(query) ||
      part.katNo?.toLowerCase().includes(query) ||
      part.ref?.toString().includes(query)
    )
  }, [parts, searchQuery])

  // Sort parts
  const sortedParts = useMemo(() => {
    if (!sortConfig.key) return filteredParts
    
    return [...filteredParts].sort((a, b) => {
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
  }, [filteredParts, sortConfig])

  // Handle sort click
  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }))
  }, [])

  // Handle diagram click
  const handleDiagramClick = useCallback((diagramId) => {
    if (!diagramId || !data?.diagrams) return
    const diagram = data.diagrams[diagramId]
    if (diagram?.filename) {
      setSelectedDiagram({ id: diagramId, ...diagram })
      setDiagramLoaded(false)
      setHotspots(null)
      // Load hotspots for this diagram
      fetch(`/data/epc/hotspots/${diagramId}.json`)
        .then(res => res.ok ? res.json() : null)
        .then(data => setHotspots(data))
        .catch(() => setHotspots(null))
    }
  }, [data])

  // Handle diagram image load
  const handleDiagramLoad = useCallback(() => {
    setDiagramLoaded(true)
  }, [])

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
          <table className="epc-parts-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Ref</th>
                <th>Description</th>
                <th>Part No</th>
                <th>Kat No</th>
              </tr>
            </thead>
            <tbody>
              {globalSearchResults.map((part, idx) => (
                <tr key={idx}>
                  <td className="epc-location-cell">
                    <Link to={`/epc/${part.groupId}/${part.subSectionId}/${part.mainId}`}>
                      {GROUP_ICONS[part.groupId]} {part.mainName}
                    </Link>
                  </td>
                  <td className="epc-ref-cell">{part.ref}</td>
                  <td>{part.description}</td>
                  <td className="epc-partno-cell">{part.partNo}</td>
                  <td className="epc-katno-cell">{part.katNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

  // Render parts table
  const renderPartsTable = () => (
    <div className="epc-parts">
      {renderBreadcrumb()}
      
      <div className="epc-header">
        <h1>{currentMain.name}</h1>
        <p className="epc-parts-count">{parts.length} parts</p>
      </div>

      <div className="epc-search-container epc-search-small">
        <input
          type="text"
          placeholder="Filter parts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="epc-search-input"
        />
        {searchQuery && (
          <button className="epc-search-clear" onClick={() => setSearchQuery('')}>×</button>
        )}
      </div>

      <div className="epc-parts-container">
        <table className="epc-parts-table">
          <thead>
            <tr>
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
            {sortedParts.map((part, idx) => (
              <tr 
                key={idx} 
                className={`${part.diagramId ? 'has-diagram' : ''} ${highlightedRef === part.ref ? 'highlighted' : ''}`}
                onMouseEnter={() => selectedDiagram && setHighlightedRef(part.ref)}
                onMouseLeave={() => setHighlightedRef(null)}
              >
                <td className="epc-ref-cell">
                  {part.diagramId ? (
                    <button 
                      className="epc-ref-link"
                      onClick={() => handleDiagramClick(part.diagramId)}
                      title="View diagram"
                    >
                      {part.ref}
                    </button>
                  ) : (
                    part.ref
                  )}
                </td>
                <td className="epc-desc-cell">{part.description}</td>
                <td className="epc-usage-cell">{part.usage}</td>
                <td className="epc-qty-cell">{part.qty}</td>
                <td className="epc-partno-cell">{part.partNo}</td>
                <td className="epc-katno-cell">{part.katNo}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedParts.length === 0 && searchQuery && (
          <div className="epc-no-results">
            <p>No parts match "{searchQuery}"</p>
          </div>
        )}
      </div>

      {/* Diagram Modal */}
      {selectedDiagram && (
        <div className="epc-diagram-modal" onClick={() => setSelectedDiagram(null)}>
          <div className="epc-diagram-content" onClick={e => e.stopPropagation()}>
            <button className="epc-diagram-close" onClick={() => setSelectedDiagram(null)}>×</button>
            <h3>{currentMain.name}</h3>
            <div className="epc-diagram-image-container">
              <img 
                ref={diagramImageRef}
                src={`/data/epc/diagrams/${selectedDiagram.filename}`}
                alt={`Diagram for ${currentMain.name}`}
                className="epc-diagram-image"
                onLoad={handleDiagramLoad}
              />
              {/* Hotspot overlays */}
              {diagramLoaded && hotspots && diagramImageRef.current && (
                <div className="epc-hotspots-container">
                  {hotspots.hotspots.map((hotspot, idx) => {
                    const img = diagramImageRef.current
                    const scaleX = img.offsetWidth / hotspots.imageWidth
                    const scaleY = img.offsetHeight / hotspots.imageHeight
                    const isHighlighted = highlightedRef === hotspot.ref
                    
                    return (
                      <div
                        key={idx}
                        className={`epc-hotspot ${isHighlighted ? 'highlighted' : ''}`}
                        style={{
                          left: `${hotspot.bbox.x * scaleX}px`,
                          top: `${hotspot.bbox.y * scaleY}px`,
                          width: `${hotspot.bbox.width * scaleX}px`,
                          height: `${hotspot.bbox.height * scaleY}px`,
                        }}
                        onMouseEnter={() => setHighlightedRef(hotspot.ref)}
                        onMouseLeave={() => setHighlightedRef(null)}
                        title={`Part #${hotspot.ref}`}
                      >
                        <span className="epc-hotspot-label">{hotspot.ref}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {hotspots?.sheetCode && (
              <div className="epc-diagram-sheet-code">
                Sheet: {hotspots.sheetCode.text}
              </div>
            )}
          </div>
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

  return renderPartsTable()
}

export default EPCBrowser
