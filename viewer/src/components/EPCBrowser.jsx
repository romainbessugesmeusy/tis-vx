import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import MapViewer from './MapViewer'
import PartThumbnail from './PartThumbnail'

/**
 * EPC (Electronic Parts Catalog) Browser
 *
 * Diagram-centric pages: one URL per diagram (/epc/:groupId/diagram/:diagramId).
 * Main items that share a diagram are combined on one page with foldable part groups.
 *
 * - Resizable split: diagram viewer (top), drag handle, scrollable table section (info bar, search, parts).
 * - Clicking a hotspot selects the part, expands its group if needed, and scrolls the table to that row.
 * - Navigation is handled by the Sidebar (tree/column view with diagram pills and multi-line titles).
 */

// Parse "CABLE,BONNET LOCK RELEASE" → ["Cable", "Bonnet lock release"]
function parseDescription(desc) {
  if (!desc) return []
  return desc.split(',').map(s => {
    const trimmed = s.trim().toLowerCase()
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  })
}

// Group icons mapping
const GROUP_ICONS = {
  A: '🚗', B: '🔩', C: '🪟', D: '💺', E: '⚙️', F: '❄️', G: '⛽', H: '🔧',
  J: '🛞', K: '🏎️', L: '🎯', M: '🔄', N: '⭕', P: '⚡', Q: '📦', R: '🚙',
}

function EPCBrowser() {
  const { groupId, subSectionId, mainId, diagramId } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState(null)
  const [hotspotIndex, setHotspotIndex] = useState(null) // sheetCode per diagramId from _index.json
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hotspots, setHotspots] = useState({}) // Map of diagramId -> hotspots
  const [highlightedRef, setHighlightedRef] = useState(null)
  const [selectedRef, setSelectedRef] = useState(null) // Selected from parts list (click)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [expandedPartGroups, setExpandedPartGroups] = useState(new Set()) // main item ids for foldable groups
  const [copiedPartNo, setCopiedPartNo] = useState(null)
  const [diagramPanelHeight, setDiagramPanelHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('epc-diagram-height')
      if (saved) {
        const n = parseInt(saved, 10)
        if (Number.isFinite(n) && n >= 200) return Math.min(n, 1200)
      }
    } catch (_) {}
    return 420
  })
  const isResizingEpcRef = useRef(false)
  const lastDiagramHeightRef = useRef(diagramPanelHeight)

  // Reset search and selection when navigating to a different page
  useEffect(() => {
    setSearchQuery('')
    setSelectedRef(null)
    setHighlightedRef(null)
  }, [groupId, subSectionId, mainId, diagramId])

  // Load EPC data and hotspot index
  useEffect(() => {
    Promise.all([
      fetch('/data/epc/parts.json').then(res => {
        if (!res.ok) throw new Error('Failed to load parts catalog')
        return res.json()
      }),
      fetch('/data/epc/hotspots/_index.json').then(res => (res.ok ? res.json() : null)).catch(() => null)
    ])
      .then(([json, index]) => {
        // Pre-process: split descriptions into component arrays
        for (const group of json.groups) {
          for (const sub of group.subSections) {
            for (const main of sub.main) {
              for (const part of main.parts) {
                part.descriptionParts = parseDescription(part.description)
                if (part.partNo) part.partNo = part.partNo.replace(/^\(|\)$/g, '').trim()
                if (part.katNo) part.katNo = part.katNo.replace(/^\(|\)$/g, '').trim()
              }
            }
          }
        }
        setData(json)
        setHotspotIndex(index)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  // Diagram index: groupId -> diagramId -> { sheetCode, mainItems: [{ id, name, parts, subSectionId }] }
  const diagramIndex = useMemo(() => {
    if (!data?.groups || !data.groups.length) return null
    const sheetCodeByDiagramId = new Map()
    if (hotspotIndex?.diagrams) {
      hotspotIndex.diagrams.forEach(d => {
        sheetCodeByDiagramId.set(d.id, d.sheetCode ?? '?')
      })
    }
    const index = {}
    data.groups.forEach(group => {
      index[group.id] = {}
      group.subSections.forEach(subSection => {
        subSection.main.forEach(main => {
          const diagramId = main.parts[0]?.diagramId
          if (!diagramId) return
          if (!index[group.id][diagramId]) {
            index[group.id][diagramId] = {
              sheetCode: sheetCodeByDiagramId.get(diagramId) ?? '?',
              mainItems: []
            }
          }
          index[group.id][diagramId].mainItems.push({
            id: main.id,
            name: main.name,
            parts: main.parts,
            subSectionId: subSection.id
          })
        })
      })
      if (Object.keys(index[group.id]).length === 0) delete index[group.id]
    })
    return index
  }, [data, hotspotIndex])

  // Redirect old URL (mainId) to diagram URL
  useEffect(() => {
    if (!data || !mainId || !groupId || !subSectionId || diagramId) return
    const group = data.groups.find(g => g.id === groupId)
    const subSection = group?.subSections.find(s => s.id === subSectionId)
    const main = subSection?.main.find(m => m.id === mainId)
    const did = main?.parts[0]?.diagramId
    if (did) navigate(`/epc/${groupId}/diagram/${did}`, { replace: true })
  }, [data, groupId, subSectionId, mainId, diagramId, navigate])

  // Diagram page: when groupId + diagramId, entry from diagram index
  const diagramPageEntry = useMemo(() => {
    if (!groupId || !diagramId || !diagramIndex) return null
    return diagramIndex[groupId]?.[diagramId] ?? null
  }, [diagramIndex, groupId, diagramId])

  const currentGroup = useMemo(() => {
    if (!data || !groupId) return null
    return data.groups.find(g => g.id === groupId) ?? null
  }, [data, groupId])

  // All parts for current diagram page (for hotspot loading and active part lookup)
  const diagramPageParts = useMemo(() => {
    if (!diagramPageEntry?.mainItems) return []
    return diagramPageEntry.mainItems.flatMap(m => m.parts)
  }, [diagramPageEntry])

  // Expand all part groups by default when diagram page changes
  useEffect(() => {
    if (diagramPageEntry?.mainItems) {
      setExpandedPartGroups(new Set(diagramPageEntry.mainItems.map(m => m.id)))
    }
  }, [diagramPageEntry])

  // Load hotspot for current diagram when on diagram page
  useEffect(() => {
    if (!diagramId || !data?.diagrams?.[diagramId]) return
    if (hotspots[diagramId]) return
    fetch(`/data/epc/hotspots/${diagramId}.json`)
      .then(res => res.ok ? res.json() : null)
      .then(hotspotData => {
        if (hotspotData) setHotspots(prev => ({ ...prev, [diagramId]: hotspotData }))
      })
      .catch(() => {})
  }, [diagramId, data?.diagrams, hotspots])

  // Filter and sort main items for diagram page (foldable groups)
  const filteredAndSortedMainItems = useMemo(() => {
    if (!diagramPageEntry?.mainItems) return []
    const query = searchQuery.trim().toLowerCase()
    let items = diagramPageEntry.mainItems.map(mainItem => ({
      ...mainItem,
      parts: query
        ? mainItem.parts.filter(part =>
            part.description?.toLowerCase().includes(query) ||
            part.partNo?.toLowerCase().includes(query) ||
            part.katNo?.toLowerCase().includes(query) ||
            part.ref?.toString().includes(query)
          )
        : mainItem.parts
    }))
    items = items.filter(m => m.parts.length > 0)
    if (!sortConfig.key) return items
    return items.map(mainItem => ({
      ...mainItem,
      parts: [...mainItem.parts].sort((a, b) => {
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
  }, [diagramPageEntry, searchQuery, sortConfig])

  // Toggle foldable part group (by main item id)
  const togglePartGroup = useCallback((mainItemId) => {
    setExpandedPartGroups(prev => {
      const next = new Set(prev)
      if (next.has(mainItemId)) next.delete(mainItemId)
      else next.add(mainItemId)
      return next
    })
  }, [])

  // Handle sort click
  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }))
  }, [])

  // Resize diagram/table split (vertical drag)
  const handleEpcResizeMouseDown = useCallback((e) => {
    e.preventDefault()
    isResizingEpcRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleEpcResizeMouseMove = useCallback((e) => {
    if (!isResizingEpcRef.current) return
    const headerHeight = 60
    const maxHeight = window.innerHeight - headerHeight - 120
    const newHeight = Math.min(maxHeight, Math.max(200, e.clientY - headerHeight))
    lastDiagramHeightRef.current = newHeight
    setDiagramPanelHeight(newHeight)
  }, [])

  const handleEpcResizeMouseUp = useCallback(() => {
    if (isResizingEpcRef.current) {
      isResizingEpcRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem('epc-diagram-height', String(lastDiagramHeightRef.current))
      } catch (_) {}
    }
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleEpcResizeMouseMove)
    window.addEventListener('mouseup', handleEpcResizeMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleEpcResizeMouseMove)
      window.removeEventListener('mouseup', handleEpcResizeMouseUp)
    }
  }, [handleEpcResizeMouseMove, handleEpcResizeMouseUp])

  // Compare refs (handles string/number mismatch)
  const refsMatch = useCallback((ref1, ref2) => {
    if (ref1 === null || ref2 === null || ref1 === undefined || ref2 === undefined) return false
    return String(ref1) === String(ref2)
  }, [])

  // Copy part number to clipboard
  const handleCopyPartNo = useCallback((partNo, e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(partNo).then(() => {
      setCopiedPartNo(partNo)
      setTimeout(() => setCopiedPartNo(null), 1500)
    })
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

  // When a hotspot is clicked (selectedRef set), expand the part's group if collapsed and scroll to the row/card
  useEffect(() => {
    if (selectedRef == null || !diagramPageEntry?.mainItems) return
    const mainItem = diagramPageEntry.mainItems.find(m => m.parts.some(p => refsMatch(p.ref, selectedRef)))
    const needsExpand = mainItem && !expandedPartGroups.has(mainItem.id)
    if (mainItem && needsExpand) {
      setExpandedPartGroups(prev => new Set(prev).add(mainItem.id))
    }
    const refKey = String(selectedRef)
    const scrollToPart = () => {
      const bottom = document.querySelector('.epc-diagram-split-bottom')
      if (!bottom) return
      // Prefer table row (visible on desktop); fallback to any part element (card on mobile)
      const row = bottom.querySelector(`tr[data-part-ref="${refKey}"]`)
      const el = row || bottom.querySelector(`[data-part-ref="${refKey}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    const delay = needsExpand ? 300 : 50
    const t = setTimeout(scrollToPart, delay)
    return () => clearTimeout(t)
  }, [selectedRef, diagramPageEntry, expandedPartGroups, refsMatch])

  // Global search across all parts (for home page)
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
                diagramId: part.diagramId,
              })
            }
          }
        }
      }
    }

    return results.slice(0, 100) // Limit results
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

  // Render breadcrumb navigation (diagram page: group + combined title)
  const renderBreadcrumb = () => {
    if (!currentGroup) return null
    const combinedTitle = diagramPageEntry?.mainItems?.map(m => m.name).join(' / ')
    return (
      <nav className="epc-breadcrumb">
        <span className="epc-breadcrumb-item epc-breadcrumb-root">
          {GROUP_ICONS[groupId]} {currentGroup.name}
        </span>
        {combinedTitle && (
          <>
            <span className="epc-breadcrumb-sep">›</span>
            <span className="epc-breadcrumb-current">{combinedTitle}</span>
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
                to={`/epc/${part.groupId}/diagram/${part.diagramId}`}
                className="epc-part-card"
              >
                <div className="epc-part-card-header">
                  <span className="epc-part-ref">{part.ref}</span>
                  <span className="epc-part-location">{GROUP_ICONS[part.groupId]} {part.mainName}</span>
                </div>
                <div className="epc-part-card-body">
                  <div className="epc-part-description">{part.descriptionParts?.join(', ') || part.description}</div>
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
        data-part-ref={String(part.ref)}
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
          <div className="epc-part-description">{part.descriptionParts.join(', ')}</div>
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
                data-part-ref={String(part.ref)}
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
                <td className="epc-desc-cell">{part.descriptionParts.join(', ')}</td>
                <td className="epc-usage-cell">{part.usage}</td>
                <td className="epc-qty-cell">{part.qty}</td>
                <td className="epc-partno-cell epc-copyable" onClick={(e) => handleCopyPartNo(part.partNo, e)} title="Click to copy">
                  {part.partNo}
                  <span className={`epc-copy-icon ${copiedPartNo === part.partNo ? 'copied' : ''}`}>
                    {copiedPartNo === part.partNo ? '✓' : '⧉'}
                  </span>
                </td>
                <td className="epc-katno-cell">{part.katNo}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  // Diagram page: one diagram + foldable part groups
  const renderDiagramPage = () => {
    const diagram = data?.diagrams?.[diagramId]
    const diagramHotspots = hotspots[diagramId]
    const activeRef = selectedRef || highlightedRef
    const activePartInfo = getActivePartInfo(diagramPageParts, activeRef)

    return (
      <div className="epc-parts epc-parts-compact epc-diagram-split">
        <div
          className="epc-diagram-split-container"
          style={{ '--epc-diagram-height': `${diagramPanelHeight}px` }}
        >
          <div className="epc-diagram-split-top">
            <div className="epc-diagram-group">
              {diagram && (
                <div className="epc-diagram-viewer-wrapper">
                  <MapViewer
                    src={`/data/epc/diagrams/${diagram.filename}`}
                    alt="Parts diagram"
                    allowFullscreen={true}
                    hotspots={diagramHotspots}
                    highlightedRef={activeRef}
                    centerOnRef={selectedRef}
                    onHotspotHover={setHighlightedRef}
                    onHotspotClick={(ref) => setSelectedRef(prev => refsMatch(prev, ref) ? null : ref)}
                    className="epc-diagram-map"
                  />
                </div>
              )}
            </div>
          </div>
          <div
            className="epc-epc-resize-handle"
            onMouseDown={handleEpcResizeMouseDown}
            title="Drag to resize"
          />
          <div className="epc-diagram-split-bottom">
            <div className={`epc-part-info-bar ${activePartInfo ? 'visible' : ''}`}>
              {activePartInfo ? (
                <>
                  <span className="epc-part-info-ref">#{activePartInfo.ref}</span>
                  <span className="epc-part-info-desc">{activePartInfo.descriptionParts?.join(', ') || activePartInfo.description}</span>
                  <span className="epc-part-info-partno epc-copyable" onClick={(e) => handleCopyPartNo(activePartInfo.partNo, e)} title="Click to copy">
                    {activePartInfo.partNo}
                    <span className={`epc-copy-icon ${copiedPartNo === activePartInfo.partNo ? 'copied' : ''}`}>
                      {copiedPartNo === activePartInfo.partNo ? '✓' : '⧉'}
                    </span>
                  </span>
                  {activePartInfo.usage && <span className="epc-part-info-usage">{activePartInfo.usage}</span>}
                  {activePartInfo.qty && <span className="epc-part-info-qty">Qty: {activePartInfo.qty}</span>}
                </>
              ) : (
                <span className="epc-part-info-placeholder">Hover or click a part to see details</span>
              )}
            </div>
            <div className="epc-search-container">
              <input
                type="text"
                placeholder="Filter parts on this diagram..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="epc-search-input"
              />
              {searchQuery && (
                <button className="epc-search-clear" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>
            <div className="epc-parts-groups">
            {filteredAndSortedMainItems.length === 1 ? (
              <div className="epc-parts-group-content">
                <div className="epc-parts-responsive">
                  <div className="epc-parts-cards">
                    {filteredAndSortedMainItems[0].parts.map(part => renderPartCard(part, diagramId, diagram, diagramHotspots))}
                  </div>
                  <div className="epc-parts-table-wrapper">
                    {renderPartsTable(filteredAndSortedMainItems[0].parts, diagramId, diagram, diagramHotspots)}
                  </div>
                </div>
              </div>
            ) : (
              filteredAndSortedMainItems.map((mainItem) => {
                const isExpanded = expandedPartGroups.has(mainItem.id)
                return (
                  <div key={mainItem.id} className="epc-parts-group">
                    <button
                      type="button"
                      className="epc-parts-group-header"
                      onClick={() => togglePartGroup(mainItem.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="epc-parts-group-chevron">{isExpanded ? '▼' : '▶'}</span>
                      <span className="epc-parts-group-title">{mainItem.name}</span>
                      <span className="epc-parts-group-count">{mainItem.parts.length}</span>
                    </button>
                    {isExpanded && (
                      <div className="epc-parts-group-content">
                        <div className="epc-parts-responsive">
                          <div className="epc-parts-cards">
                            {mainItem.parts.map(part => renderPartCard(part, diagramId, diagram, diagramHotspots))}
                          </div>
                          <div className="epc-parts-table-wrapper">
                            {renderPartsTable(mainItem.parts, diagramId, diagram, diagramHotspots)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            </div>
            {filteredAndSortedMainItems.length === 0 && searchQuery && (
              <div className="epc-no-results">
                <p>No parts match "{searchQuery}"</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Main render: home when no group, diagram page when groupId + diagramId, else not found
  if (!groupId) {
    return renderHome()
  }

  if (groupId && diagramId) {
    if (!diagramPageEntry) {
      return (
        <div className="epc-error">
          <p>Diagram not found</p>
          <Link to="/epc">Back to Parts Catalog</Link>
        </div>
      )
    }
    return renderDiagramPage()
  }

  // Old URL (groupId + subSectionId + mainId) is redirected in useEffect; if we land here, show home
  return renderHome()
}

export default EPCBrowser
