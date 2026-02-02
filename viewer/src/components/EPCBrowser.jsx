import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'

/**
 * EPC (Electronic Parts Catalog) Browser
 * Displays parts catalog with hierarchical navigation and diagram viewer
 */

// Group icons mapping
const GROUP_ICONS = {
  A: '🚗', // Body shell and panels
  B: '🔩', // Body exterior fittings
  C: '🪟', // Body interior fittings
  D: '💺', // Body interior trim
  E: '⚙️', // Engine and clutch
  F: '❄️', // Cooling
  G: '⛽', // Fuel and exhaust
  H: '🔧', // Transmission
  J: '🛞', // Brakes
  K: '🏎️', // Front axle and suspension
  L: '🎯', // Steering
  M: '🔄', // Rear axle and suspension
  N: '⭕', // Road wheels
  P: '⚡', // Electrical
  Q: '📦', // Accessories
  R: '🚙', // Special vehicle option specification
}

function EPCBrowser() {
  const { groupId, subSectionId, mainId } = useParams()
  const navigate = useNavigate()
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDiagram, setSelectedDiagram] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })

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
    }
  }, [data])

  // Global search across all parts
  const globalSearchResults = useMemo(() => {
    if (!data || !searchQuery.trim() || groupId) return null
    
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
    
    return results.slice(0, 50) // Limit results
  }, [data, searchQuery, groupId])

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
  const renderBreadcrumb = () => (
    <nav className="epc-breadcrumb">
      <Link to="/epc" className="epc-breadcrumb-item">Parts Catalog</Link>
      {currentGroup && (
        <>
          <span className="epc-breadcrumb-sep">›</span>
          <Link to={`/epc/${groupId}`} className="epc-breadcrumb-item">
            {GROUP_ICONS[groupId]} {currentGroup.name}
          </Link>
        </>
      )}
      {currentSubSection && (
        <>
          <span className="epc-breadcrumb-sep">›</span>
          <Link to={`/epc/${groupId}/${subSectionId}`} className="epc-breadcrumb-item">
            {currentSubSection.name}
          </Link>
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

  // Render groups grid (home view)
  const renderGroupsGrid = () => (
    <div className="epc-groups">
      <div className="epc-header">
        <h1>Parts Catalog</h1>
        <p className="epc-subtitle">Electronic Parts Catalog for Opel/Vauxhall Speedster & VX220</p>
      </div>
      
      <div className="epc-search-container">
        <input
          type="text"
          placeholder="Search all parts by description, part number, or catalog number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="epc-search-input"
        />
        {searchQuery && (
          <button className="epc-search-clear" onClick={() => setSearchQuery('')}>×</button>
        )}
      </div>

      {globalSearchResults && globalSearchResults.length > 0 ? (
        <div className="epc-search-results">
          <h3>Search Results ({globalSearchResults.length}{globalSearchResults.length === 50 ? '+' : ''})</h3>
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
                      {part.groupName} › {part.mainName}
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
        <div className="epc-groups-grid">
          {data.groups.map(group => (
            <Link 
              key={group.id} 
              to={`/epc/${group.id}`}
              className="epc-group-card"
            >
              <span className="epc-group-icon">{GROUP_ICONS[group.id] || '📦'}</span>
              <span className="epc-group-letter">{group.id}</span>
              <span className="epc-group-name">{group.name}</span>
              <span className="epc-group-count">
                {group.subSections.reduce((acc, s) => acc + s.main.reduce((a, m) => a + m.parts.length, 0), 0)} parts
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )

  // Render sub sections list
  const renderSubSections = () => (
    <div className="epc-subsections">
      {renderBreadcrumb()}
      
      <div className="epc-header">
        <h1>{GROUP_ICONS[groupId]} {currentGroup.name}</h1>
      </div>

      <div className="epc-list">
        {currentGroup.subSections.map(subSection => (
          <Link 
            key={subSection.id} 
            to={`/epc/${groupId}/${subSection.id}`}
            className="epc-list-item"
          >
            <span className="epc-list-number">{subSection.id.replace(groupId, '')}</span>
            <span className="epc-list-name">{subSection.name}</span>
            <span className="epc-list-count">
              {subSection.main.reduce((acc, m) => acc + m.parts.length, 0)} parts
            </span>
            <span className="epc-list-arrow">›</span>
          </Link>
        ))}
      </div>
    </div>
  )

  // Render main items list
  const renderMainItems = () => (
    <div className="epc-main-items">
      {renderBreadcrumb()}
      
      <div className="epc-header">
        <h1>{currentSubSection.name}</h1>
      </div>

      <div className="epc-list">
        {currentSubSection.main.map(main => (
          <Link 
            key={main.id} 
            to={`/epc/${groupId}/${subSectionId}/${main.id}`}
            className="epc-list-item"
          >
            <span className="epc-list-number">{main.id.split('-').pop()}</span>
            <span className="epc-list-name">{main.name}</span>
            <span className="epc-list-count">{main.parts.length} parts</span>
            <span className="epc-list-arrow">›</span>
          </Link>
        ))}
      </div>
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
              <tr key={idx} className={part.diagramId ? 'has-diagram' : ''}>
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
            <h3>Diagram {selectedDiagram.id}</h3>
            <div className="epc-diagram-image-container">
              <img 
                src={`/data/epc/diagrams/${selectedDiagram.filename}`}
                alt={`Diagram ${selectedDiagram.id}`}
                className="epc-diagram-image"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Main render logic
  if (!groupId) {
    return renderGroupsGrid()
  }
  
  if (!currentGroup) {
    return (
      <div className="epc-error">
        <p>Group not found</p>
        <Link to="/epc">Back to Parts Catalog</Link>
      </div>
    )
  }

  if (!subSectionId) {
    return renderSubSections()
  }

  if (!currentSubSection) {
    return (
      <div className="epc-error">
        <p>Sub section not found</p>
        <Link to={`/epc/${groupId}`}>Back to {currentGroup.name}</Link>
      </div>
    )
  }

  if (!mainId) {
    return renderMainItems()
  }

  if (!currentMain) {
    return (
      <div className="epc-error">
        <p>Section not found</p>
        <Link to={`/epc/${groupId}/${subSectionId}`}>Back to {currentSubSection.name}</Link>
      </div>
    )
  }

  return renderPartsTable()
}

export default EPCBrowser
