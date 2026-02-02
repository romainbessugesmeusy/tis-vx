import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { NavLink, useParams, useNavigate, useLocation } from 'react-router-dom'
import SearchBar from './SearchBar'

// Group icons for EPC navigation
const EPC_GROUP_ICONS = {
  A: '🚗', B: '🔩', C: '🪟', D: '💺', E: '⚙️', F: '❄️', G: '⛽', H: '🔧',
  J: '🛞', K: '🏎️', L: '🎯', M: '🔄', N: '⭕', P: '⚡', Q: '📦', R: '🚙',
}

// Document type folders that should be treated as group labels (not columns)
const GROUP_FOLDER_TITLES = [
  'Repair Instructions',
  'Description and Operation',
  'Component Locator',
  'Specifications',
  'Special Tools and Equipment',
  'Technical Service Bulletins',
  'Other Information',
  'Inspections',
  'Technical Information',
  'Schematic and Routing Diagrams',
  'Circuit Diagram'
]

// Group styling configuration with emoji and color accent
const GROUP_STYLES = {
  'Repair Instructions': { emoji: '🔧', color: '#3b82f6' },         // Blue
  'Description and Operation': { emoji: '📖', color: '#10b981' },   // Green
  'Component Locator': { emoji: '📍', color: '#8b5cf6' },           // Purple
  'Specifications': { emoji: '📋', color: '#f59e0b' },              // Orange
  'Special Tools and Equipment': { emoji: '🛠️', color: '#ef4444' }, // Red
  'Technical Service Bulletins': { emoji: '📢', color: '#ec4899' }, // Pink
  'Other Information': { emoji: 'ℹ️', color: '#6b7280' },           // Gray
  'Inspections': { emoji: '🔍', color: '#14b8a6' },                 // Teal
  'Technical Information': { emoji: '📚', color: '#6366f1' },       // Indigo
  'Schematic and Routing Diagrams': { emoji: '📐', color: '#0ea5e9' }, // Sky blue
  'Circuit Diagram': { emoji: '⚡', color: '#eab308' }              // Yellow
}

// Check if a node is a group folder (should be rendered as label, not column)
const isGroupFolder = (node) => {
  if (!node || !node.title) return false
  return GROUP_FOLDER_TITLES.includes(node.title)
}

// Get styling for a group folder
const getGroupStyle = (title) => {
  return GROUP_STYLES[title] || { emoji: '📁', color: '#6b7280' }
}

// Collect all leaves from a group, handling nested group folders
// If a group folder like "Schematic and Routing Diagrams" contains another group folder
// like "Circuit Diagram", we flatten it and only show the nested group's content under
// the nested group's label (reducing redundancy)
const collectGroupLeaves = (groupNode, nodes) => {
  const leaves = []
  const nestedGroups = []
  
  if (!groupNode || !groupNode.children) return { leaves, nestedGroups }
  
  groupNode.children.forEach(childId => {
    const child = nodes[childId]
    if (!child) return
    
    if (child.isLeaf) {
      leaves.push({ id: childId, node: child })
    } else if (isGroupFolder(child)) {
      // This is a nested group folder - collect it separately
      nestedGroups.push({ id: childId, node: child })
    } else {
      // Regular folder - check if it has leaves we should include
      // (this handles edge cases)
    }
  })
  
  return { leaves, nestedGroups }
}

// localStorage keys
const STORAGE_KEYS = {
  COLUMN_PATH: 'tis-column-path',
  EXPANDED_NODES: 'tis-expanded-nodes',
  COLLAPSED_GROUPS: 'tis-collapsed-groups',
  SIDEBAR_MODE: 'tis-sidebar-mode'
}

// EPC Sidebar Navigation Component
function EPCSidebarNav({ onClose, showMobileMenu }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [epcData, setEpcData] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Load EPC data
  useEffect(() => {
    fetch('/data/epc/parts.json')
      .then(res => res.ok ? res.json() : null)
      .then(data => setEpcData(data))
      .catch(() => setEpcData(null))
  }, [])
  
  // Get current group from URL
  const currentGroupId = useMemo(() => {
    const match = location.pathname.match(/^\/epc\/([A-R])/)
    return match ? match[1] : null
  }, [location.pathname])
  
  // Filter groups by search
  const filteredGroups = useMemo(() => {
    if (!epcData?.groups) return []
    if (!searchQuery.trim()) return epcData.groups
    
    const query = searchQuery.toLowerCase()
    return epcData.groups.filter(g => 
      g.name.toLowerCase().includes(query) ||
      g.id.toLowerCase().includes(query)
    )
  }, [epcData, searchQuery])
  
  const handleGroupClick = (groupId) => {
    navigate(`/epc/${groupId}`)
    if (showMobileMenu && onClose) {
      onClose()
    }
  }
  
  if (!epcData) {
    return (
      <div className="epc-sidebar-nav">
        <div className="epc-sidebar-loading">
          <p>Parts catalog not available</p>
          <p className="epc-sidebar-hint">Run the scraper to download parts data.</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="epc-sidebar-nav">
      <div className="epc-sidebar-search">
        <input
          type="text"
          placeholder="Search groups..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <ul className="epc-sidebar-groups">
        {filteredGroups.map(group => (
          <li key={group.id} className="epc-sidebar-group">
            <button
              className={`epc-sidebar-group-btn ${currentGroupId === group.id ? 'active' : ''}`}
              onClick={() => handleGroupClick(group.id)}
            >
              <span className="epc-sidebar-group-icon">{EPC_GROUP_ICONS[group.id] || '📦'}</span>
              <span className="epc-sidebar-group-letter">{group.id}</span>
              <span className="epc-sidebar-group-name">{group.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Mixed column component - renders group folders as labels AND other folders as clickable items
function MixedColumn({ groupFolders, otherFolders, nodes, tocIdToSlug, activeDocId, searchQuery, onFolderClick, selectedId, onDocumentSelect }) {
  // Track collapsed state for each group - initialize from localStorage
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.COLLAPSED_GROUPS)
      if (saved) {
        return new Set(JSON.parse(saved))
      }
    } catch (e) {
      console.warn('Failed to load collapsed groups from localStorage:', e)
    }
    return new Set()
  })

  // Persist collapsed groups to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.COLLAPSED_GROUPS, JSON.stringify([...collapsedGroups]))
    } catch (e) {
      console.warn('Failed to save collapsed groups to localStorage:', e)
    }
  }, [collapsedGroups])
  
  const toggleGroupCollapse = (groupId) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }
  
  // Filter function for search within groups
  const filterLeaves = (leaves, query) => {
    if (!query) return leaves
    const lowerQuery = query.toLowerCase()
    return leaves.filter(leaf => {
      const node = nodes[leaf.id]
      return node && node.title.toLowerCase().includes(lowerQuery)
    })
  }

  // Check if group has matching descendants for search (including nested groups)
  const hasMatchingLeaves = (groupId, query) => {
    if (!query) return true
    const groupNode = nodes[groupId]
    if (!groupNode || !groupNode.children) return false
    const lowerQuery = query.toLowerCase()
    
    const checkChildren = (childIds) => {
      return childIds.some(childId => {
        const child = nodes[childId]
        if (!child) return false
        if (child.isLeaf && child.title.toLowerCase().includes(lowerQuery)) return true
        if (!child.isLeaf && child.children) return checkChildren(child.children)
        return false
      })
    }
    
    return checkChildren(groupNode.children)
  }

  // Check if folder has matching descendants for search
  const hasMatchingDescendant = (childIds, query) => {
    for (const childId of childIds) {
      const child = nodes[childId]
      if (!child) continue
      if (child.title.toLowerCase().includes(query)) return true
      if (!child.isLeaf && child.children) {
        if (hasMatchingDescendant(child.children, query)) return true
      }
    }
    return false
  }

  // Process groups to handle nesting - if a group contains another group,
  // skip the parent and only show the nested group
  const processedGroups = useMemo(() => {
    const result = []
    const skipIds = new Set()
    
    groupFolders.forEach(({ id, node }) => {
      const { leaves, nestedGroups } = collectGroupLeaves(node, nodes)
      
      if (nestedGroups.length > 0) {
        // This group has nested groups - add the nested ones instead
        // and mark this parent as having been processed
        nestedGroups.forEach(nested => {
          result.push(nested)
        })
        // Also add any direct leaves from the parent if any exist
        if (leaves.length > 0) {
          result.push({ id, node, directLeavesOnly: true })
        }
      } else {
        // No nested groups - add this group normally
        result.push({ id, node })
      }
    })
    
    return result
  }, [groupFolders, nodes])

  // Filter groups and other folders based on search
  const query = searchQuery?.toLowerCase()
  
  const visibleGroups = query
    ? processedGroups.filter(({ id }) => hasMatchingLeaves(id, searchQuery))
    : processedGroups

  const visibleOthers = query
    ? otherFolders.filter(({ node }) => {
        if (node.title.toLowerCase().includes(query)) return true
        if (!node.isLeaf && node.children) {
          return hasMatchingDescendant(node.children, query)
        }
        return false
      })
    : otherFolders

  if (visibleGroups.length === 0 && visibleOthers.length === 0) {
    return (
      <div className="column-nav-column column-mixed">
        <p className="no-results">No documents found</p>
      </div>
    )
  }

  return (
    <div className="column-nav-column column-mixed">
      {/* Render subcomponent folders first (on top) */}
      {visibleOthers.length > 0 && (
        <ul className="column-nav-list column-other-folders">
          {visibleOthers.map(({ id, node }) => {
            const isSelected = selectedId === id
            const isLeaf = node.isLeaf
            const slug = isLeaf ? tocIdToSlug[id] : null
            const isActive = slug === activeDocId

            return (
              <li key={id} className="column-nav-item">
                {isLeaf ? (
                  onDocumentSelect ? (
                    <button
                      type="button"
                      className={`column-nav-link ${isActive ? 'active' : ''}`}
                      onClick={() => onDocumentSelect(slug)}
                    >
                      <span className="column-nav-title document-leaf">{node.title}</span>
                    </button>
                  ) : (
                    <NavLink
                      to={`/doc/${slug}`}
                      className={`column-nav-link ${isActive ? 'active' : ''}`}
                    >
                      <span className="column-nav-title document-leaf">{node.title}</span>
                    </NavLink>
                  )
                ) : (
                  <button
                    type="button"
                    className={`column-nav-link ${isSelected ? 'selected' : ''}`}
                    onClick={() => onFolderClick(id)}
                  >
                    <span className="column-nav-title">{node.title}</span>
                    <span className="column-nav-arrow">›</span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Render group folders as labels with documents (at the bottom) */}
      {visibleGroups.map(({ id, node, directLeavesOnly }) => {
        const style = getGroupStyle(node.title)
        const { leaves: directLeaves, nestedGroups } = collectGroupLeaves(node, nodes)
        
        // Get leaves - if directLeavesOnly, only show direct leaves
        const leaves = directLeavesOnly ? directLeaves : directLeaves
        
        const filteredLeaves = filterLeaves(leaves, searchQuery)
        
        if (filteredLeaves.length === 0) return null

        // Single item: render as direct link with group icon/color
        if (filteredLeaves.length === 1) {
          const { id: leafId, node: leafNode } = filteredLeaves[0]
          const slug = tocIdToSlug[leafId]
          const isActive = slug === activeDocId

          return (
            <div key={id} className="column-group column-group-single">
              {onDocumentSelect ? (
                <button
                  type="button"
                  className={`column-group-link ${isActive ? 'active' : ''}`}
                  style={{ '--group-color': style.color }}
                  onClick={() => onDocumentSelect(slug)}
                >
                  <span className="column-group-emoji">{style.emoji}</span>
                  <span className="column-nav-title">{leafNode.title}</span>
                </button>
              ) : (
                <NavLink
                  to={`/doc/${slug}`}
                  className={`column-group-link ${isActive ? 'active' : ''}`}
                  style={{ '--group-color': style.color }}
                >
                  <span className="column-group-emoji">{style.emoji}</span>
                  <span className="column-nav-title">{leafNode.title}</span>
                </NavLink>
              )}
            </div>
          )
        }

        // Multiple items: render as collapsible dropdown
        const isCollapsed = collapsedGroups.has(id)

        return (
          <div key={id} className={`column-group ${isCollapsed ? 'collapsed' : ''}`}>
            <button 
              type="button"
              className="column-group-label"
              style={{ '--group-color': style.color }}
              onClick={() => toggleGroupCollapse(id)}
            >
              <span className="column-group-chevron">{isCollapsed ? '▶' : '▼'}</span>
              <span className="column-group-emoji">{style.emoji}</span>
              <span className="column-group-title">{node.title}</span>
              <span className="column-group-count">{filteredLeaves.length}</span>
            </button>
            {!isCollapsed && (
              <ul className="column-group-items">
                {filteredLeaves.map(({ id: leafId, node: leafNode }) => {
                  const slug = tocIdToSlug[leafId]
                  const isActive = slug === activeDocId

                  return (
                    <li key={leafId} className="column-nav-item">
                      {onDocumentSelect ? (
                        <button
                          type="button"
                          className={`column-nav-link ${isActive ? 'active' : ''}`}
                          onClick={() => onDocumentSelect(slug)}
                        >
                          <span className="column-nav-title document-leaf">{leafNode.title}</span>
                        </button>
                      ) : (
                        <NavLink
                          to={`/doc/${slug}`}
                          className={`column-nav-link ${isActive ? 'active' : ''}`}
                        >
                          <span className="column-nav-title document-leaf">{leafNode.title}</span>
                        </NavLink>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Column-based navigation component (macOS Finder style)
function ColumnNav({ roots, nodes, tocIdToSlug, searchQuery, maxVisibleColumns = Infinity, onDocumentSelect, externalNavPath, onExternalNavComplete }) {
  const navigate = useNavigate()
  const { id: activeDocId } = useParams()
  const containerRef = useRef(null)
  const initialLoadRef = useRef(true)
  
  const isMobileColumnMode = maxVisibleColumns < Infinity

  // Build reverse mapping for finding active doc
  const slugToTocId = useMemo(() => {
    if (!tocIdToSlug) return {}
    const reverse = {}
    for (const [tocId, slug] of Object.entries(tocIdToSlug)) {
      reverse[slug] = tocId
    }
    return reverse
  }, [tocIdToSlug])

  // Helper function to build path from a node to root
  const buildPathToNode = useCallback((tocId) => {
    if (!tocId || !nodes[tocId]) return []
    
    const path = []
    const findPath = (nodeId) => {
      const node = nodes[nodeId]
      if (node && node.parentId) {
        findPath(node.parentId)
      }
      path.push(nodeId)
    }
    findPath(tocId)
    
    // Remove the leaf node from path (we only select folders)
    const node = nodes[tocId]
    if (node && node.isLeaf && path.length > 0) {
      path.pop()
    }
    
    // Remove group folders from path - they're rendered as labels, not columns
    const filteredPath = path.filter(nodeId => {
      const pathNode = nodes[nodeId]
      return pathNode && !isGroupFolder(pathNode)
    })
    
    return filteredPath
  }, [nodes])

  // Initialize selectedPath - prioritize URL, then localStorage
  const [selectedPath, setSelectedPath] = useState(() => {
    // If there's an active document in URL, build path to it
    if (activeDocId && slugToTocId[activeDocId]) {
      const activeTocId = slugToTocId[activeDocId]
      const path = buildPathToNode(activeTocId)
      if (path.length > 0) {
        return path
      }
    }
    
    // Otherwise, try to restore from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.COLUMN_PATH)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Validate that the saved path still exists in the tree
        if (Array.isArray(parsed) && parsed.every(id => nodes[id])) {
          return parsed
        }
      }
    } catch (e) {
      console.warn('Failed to load column path from localStorage:', e)
    }
    
    return []
  })

  const [visibleColumnStart, setVisibleColumnStart] = useState(0) // For mobile: which column to start showing

  // Handle external navigation path from homepage component grid
  useEffect(() => {
    if (externalNavPath && externalNavPath.length > 0) {
      // Set the selected path to the external navigation path
      setSelectedPath(externalNavPath)
      
      // In mobile mode, adjust visible column start to show the last columns
      if (isMobileColumnMode && externalNavPath.length >= maxVisibleColumns) {
        setVisibleColumnStart(Math.max(0, externalNavPath.length - maxVisibleColumns + 1))
      } else {
        setVisibleColumnStart(0)
      }
      
      // Notify that navigation is complete
      if (onExternalNavComplete) {
        onExternalNavComplete()
      }
    }
  }, [externalNavPath, onExternalNavComplete, maxVisibleColumns])

  // Persist selectedPath to localStorage when it changes (but not on initial load from URL)
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      return
    }
    try {
      localStorage.setItem(STORAGE_KEYS.COLUMN_PATH, JSON.stringify(selectedPath))
    } catch (e) {
      console.warn('Failed to save column path to localStorage:', e)
    }
  }, [selectedPath])

  // Update path when URL changes (navigation to a different document)
  useEffect(() => {
    if (!activeDocId) return
    const activeTocId = slugToTocId[activeDocId]
    if (!activeTocId) return

    const newPath = buildPathToNode(activeTocId)
    
    if (newPath.length > 0) {
      // Only update if the path is different
      const pathChanged = newPath.length !== selectedPath.length || 
        newPath.some((id, i) => selectedPath[i] !== id)
      
      if (pathChanged) {
        setSelectedPath(newPath)
        
        // In mobile mode, adjust visible column start to show the last columns
        if (isMobileColumnMode && newPath.length >= maxVisibleColumns) {
          setVisibleColumnStart(Math.max(0, newPath.length - maxVisibleColumns + 1))
        }
      }
    }
  }, [activeDocId, slugToTocId, buildPathToNode, selectedPath, isMobileColumnMode, maxVisibleColumns])

  // Handle clicking on an item
  const handleItemClick = (nodeId, columnIndex) => {
    const node = nodes[nodeId]
    if (!node) return

    if (node.isLeaf) {
      // Navigate to document
      const slug = tocIdToSlug[nodeId]
      if (slug) {
        if (onDocumentSelect) {
          // Mobile mode: use callback to navigate and close menu
          onDocumentSelect(slug)
        } else {
          navigate(`/doc/${slug}`)
        }
      }
    } else {
      // Select this folder, truncate path at this level
      setSelectedPath(prev => {
        const newPath = prev.slice(0, columnIndex)
        newPath.push(nodeId)
        return newPath
      })
      
      // In mobile mode, advance the visible column window
      if (isMobileColumnMode) {
        const newColumnCount = columnIndex + 2 // +1 for the new column that will appear
        if (newColumnCount > maxVisibleColumns) {
          setVisibleColumnStart(newColumnCount - maxVisibleColumns)
        }
      }
    }
  }
  
  // Handle back button in mobile mode
  const handleMobileBack = useCallback(() => {
    if (visibleColumnStart > 0) {
      setVisibleColumnStart(prev => prev - 1)
      // Also remove the last path item if we're going back
      setSelectedPath(prev => prev.slice(0, -1))
    }
  }, [visibleColumnStart])

  // Check if a node has any group folder children
  const hasAnyGroupChildren = useCallback((nodeId) => {
    const node = nodes[nodeId]
    if (!node || !node.children || node.children.length === 0) return false
    
    return node.children.some(childId => {
      const child = nodes[childId]
      return child && isGroupFolder(child)
    })
  }, [nodes])

  // Separate children into group folders and regular folders
  const separateChildren = useCallback((nodeId) => {
    const node = nodes[nodeId]
    if (!node || !node.children) return { groups: [], others: [] }
    
    const groups = []
    const others = []
    
    node.children.forEach(childId => {
      const child = nodes[childId]
      if (!child) return
      
      if (isGroupFolder(child)) {
        groups.push({ id: childId, node: child })
      } else {
        others.push({ id: childId, node: child })
      }
    })
    
    return { groups, others }
  }, [nodes])

  // Build columns based on selected path
  const columns = useMemo(() => {
    const cols = []
    
    // First column: root items
    cols.push({
      type: 'normal',
      items: roots.map(id => ({ id, node: nodes[id] })).filter(item => item.node),
      selectedId: selectedPath[0] || null
    })

    // Subsequent columns: children of selected items
    for (let i = 0; i < selectedPath.length; i++) {
      const selectedId = selectedPath[i]
      const selectedNode = nodes[selectedId]
      
      if (selectedNode && selectedNode.children && selectedNode.children.length > 0) {
        // Check if this node has any group folder children
        if (hasAnyGroupChildren(selectedId)) {
          const { groups, others } = separateChildren(selectedId)
          
          // Render a mixed column with group labels and regular folders
          cols.push({
            type: 'mixed',
            parentId: selectedId,
            groupFolders: groups,
            otherFolders: others,
            selectedId: selectedPath[i + 1] || null
          })
          
          // If a non-group folder is selected in this column, continue building columns
          const nextSelectedId = selectedPath[i + 1]
          if (nextSelectedId) {
            const nextNode = nodes[nextSelectedId]
            // If the selected item is not a group folder, continue the loop
            if (nextNode && !isGroupFolder(nextNode)) {
              continue
            }
          }
          // Stop here - either nothing selected or a group folder selected (which shows docs inline)
          break
        } else {
          cols.push({
            type: 'normal',
            items: selectedNode.children.map(id => ({ id, node: nodes[id] })).filter(item => item.node),
            selectedId: selectedPath[i + 1] || null
          })
        }
      }
    }

    return cols
  }, [roots, nodes, selectedPath, hasAnyGroupChildren, separateChildren])

  // Auto-scroll to show new columns when they're added
  useEffect(() => {
    if (containerRef.current && columns.length > 1) {
      // Find the scrollable parent (.sidebar-nav)
      const scrollableParent = containerRef.current.closest('.sidebar-nav')
      if (scrollableParent) {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          scrollableParent.scrollTo({
            left: scrollableParent.scrollWidth,
            behavior: 'smooth'
          })
        })
      }
    }
  }, [columns.length])

  // Filter items by search query
  const filterItems = (items) => {
    if (!searchQuery) return items
    const query = searchQuery.toLowerCase()
    return items.filter(({ node }) => {
      if (node.title.toLowerCase().includes(query)) return true
      // For folders, check if any descendant matches
      if (!node.isLeaf && node.children) {
        return hasMatchingDescendant(node.children, query)
      }
      return false
    })
  }

  const hasMatchingDescendant = (childIds, query) => {
    for (const childId of childIds) {
      const child = nodes[childId]
      if (!child) continue
      if (child.title.toLowerCase().includes(query)) return true
      if (!child.isLeaf && child.children) {
        if (hasMatchingDescendant(child.children, query)) return true
      }
    }
    return false
  }

  // Handle clicking a folder in a mixed column
  const handleMixedFolderClick = useCallback((nodeId, colIndex) => {
    setSelectedPath(prev => {
      const newPath = prev.slice(0, colIndex)
      newPath.push(nodeId)
      return newPath
    })
    
    // In mobile mode, advance the visible column window
    if (isMobileColumnMode) {
      const newColumnCount = colIndex + 2 // +1 for the new column that will appear
      if (newColumnCount > maxVisibleColumns) {
        setVisibleColumnStart(newColumnCount - maxVisibleColumns)
      }
    }
  }, [isMobileColumnMode, maxVisibleColumns])

  // Calculate which columns to show (for mobile with limited columns)
  const visibleColumns = isMobileColumnMode
    ? columns.slice(visibleColumnStart, visibleColumnStart + maxVisibleColumns)
    : columns
  
  // Adjust column indices for mobile mode
  const getActualColumnIndex = (visibleIndex) => {
    return isMobileColumnMode ? visibleIndex + visibleColumnStart : visibleIndex
  }

  return (
    <div className={`column-nav ${isMobileColumnMode ? 'mobile-column-nav' : ''}`} ref={containerRef}>
      {/* Back button for mobile mode */}
      {isMobileColumnMode && visibleColumnStart > 0 && (
        <button 
          type="button"
          className="mobile-back-button"
          onClick={handleMobileBack}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Back</span>
        </button>
      )}
      
      {visibleColumns.map((col, visibleIndex) => {
        const colIndex = getActualColumnIndex(visibleIndex)
        
        // Render mixed column (group labels + regular folders)
        if (col.type === 'mixed') {
          return (
            <MixedColumn
              key={`mixed-${colIndex}`}
              groupFolders={col.groupFolders}
              otherFolders={col.otherFolders}
              nodes={nodes}
              tocIdToSlug={tocIdToSlug}
              activeDocId={activeDocId}
              searchQuery={searchQuery}
              onFolderClick={(nodeId) => handleMixedFolderClick(nodeId, colIndex)}
              selectedId={col.selectedId}
              onDocumentSelect={onDocumentSelect}
            />
          )
        }

        // Render normal column
        return (
          <div key={colIndex} className="column-nav-column">
            <ul className="column-nav-list">
              {filterItems(col.items).map(({ id, node }) => {
                const isSelected = col.selectedId === id
                const isLeaf = node.isLeaf
                const slug = isLeaf ? tocIdToSlug[id] : null
                const isActive = slug === activeDocId

                return (
                  <li key={id} className="column-nav-item">
                    {isLeaf ? (
                      onDocumentSelect ? (
                        <button
                          type="button"
                          className={`column-nav-link ${isActive ? 'active' : ''}`}
                          onClick={() => onDocumentSelect(slug)}
                        >
                          <span className="column-nav-title document-leaf">{node.title}</span>
                        </button>
                      ) : (
                        <NavLink
                          to={`/doc/${slug}`}
                          className={`column-nav-link ${isActive ? 'active' : ''}`}
                        >
                          <span className="column-nav-title document-leaf">{node.title}</span>
                        </NavLink>
                      )
                    ) : (
                      <button
                        type="button"
                        className={`column-nav-link ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleItemClick(id, colIndex)}
                      >
                        <span className="column-nav-title">{node.title}</span>
                        <span className="column-nav-arrow">›</span>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// Tree group component - renders a group folder with special styling
function TreeGroup({ nodeId, node, nodes, tocIdToSlug, expandedNodes, toggleNode, searchQuery }) {
  const isExpanded = expandedNodes.has(nodeId)
  const style = getGroupStyle(node.title)
  
  // Collect leaves from this group (and handle nested groups)
  const { leaves, nestedGroups } = useMemo(() => {
    const result = { leaves: [], nestedGroups: [] }
    if (!node.children) return result
    
    node.children.forEach(childId => {
      const child = nodes[childId]
      if (!child) return
      
      if (child.isLeaf) {
        const slug = tocIdToSlug[childId]
        if (slug) {
          result.leaves.push({ id: childId, node: child, slug })
        }
      } else if (isGroupFolder(child)) {
        result.nestedGroups.push({ id: childId, node: child })
      }
    })
    
    return result
  }, [node.children, nodes, tocIdToSlug])
  
  // Filter leaves by search
  const filteredLeaves = useMemo(() => {
    if (!searchQuery) return leaves
    const query = searchQuery.toLowerCase()
    return leaves.filter(({ node: leafNode }) => 
      leafNode.title.toLowerCase().includes(query)
    )
  }, [leaves, searchQuery])
  
  // Check if has visible content
  const hasVisibleContent = filteredLeaves.length > 0 || nestedGroups.length > 0
  
  // Hide empty groups (no leaves and no nested groups)
  if (!hasVisibleContent) return null
  
  // If this group only contains nested groups (no direct leaves), render the nested groups instead
  if (filteredLeaves.length === 0 && nestedGroups.length > 0) {
    return (
      <>
        {nestedGroups.map(({ id, node: nestedNode }) => (
          <TreeGroup
            key={id}
            nodeId={id}
            node={nestedNode}
            nodes={nodes}
            tocIdToSlug={tocIdToSlug}
            expandedNodes={expandedNodes}
            toggleNode={toggleNode}
            searchQuery={searchQuery}
          />
        ))}
      </>
    )
  }
  
  // Single item: render as direct link with group icon/color (no dropdown)
  if (filteredLeaves.length === 1 && nestedGroups.length === 0) {
    const { id, node: leafNode, slug } = filteredLeaves[0]
    return (
      <li className="tree-group tree-group-single">
        <NavLink
          to={`/doc/${slug}`}
          className={({ isActive }) => `tree-group-link ${isActive ? 'active' : ''}`}
          style={{ '--group-color': style.color }}
        >
          <span className="tree-group-emoji">{style.emoji}</span>
          <span className="tree-group-link-title">{leafNode.title}</span>
        </NavLink>
      </li>
    )
  }

  // Multiple items: render as collapsible dropdown
  return (
    <li className={`tree-group ${isExpanded ? '' : 'collapsed'}`}>
      <button 
        className="tree-group-toggle"
        onClick={() => toggleNode(nodeId)}
        type="button"
        style={{ '--group-color': style.color }}
      >
        <span className="tree-group-chevron">{isExpanded ? '▼' : '▶'}</span>
        <span className="tree-group-emoji">{style.emoji}</span>
        <span className="tree-group-title">{node.title}</span>
        <span className="tree-group-count">{filteredLeaves.length}</span>
      </button>
      {isExpanded && (
        <ul className="tree-group-items">
          {filteredLeaves.map(({ id, node: leafNode, slug }) => (
            <li key={id} className="tree-leaf">
              <NavLink
                to={`/doc/${slug}`}
                className={({ isActive }) => `nav-link document-leaf ${isActive ? 'active' : ''}`}
              >
                {leafNode.title}
              </NavLink>
            </li>
          ))}
          {/* Render any nested groups after leaves */}
          {nestedGroups.map(({ id, node: nestedNode }) => (
            <TreeGroup
              key={id}
              nodeId={id}
              node={nestedNode}
              nodes={nodes}
              tocIdToSlug={tocIdToSlug}
              expandedNodes={expandedNodes}
              toggleNode={toggleNode}
              searchQuery={searchQuery}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// Recursive tree node component
function TreeNode({ nodeId, nodes, tocIdToSlug, expandedNodes, toggleNode, searchQuery }) {
  const node = nodes[nodeId]
  if (!node) return null

  const isExpanded = expandedNodes.has(nodeId)
  const hasChildren = node.children && node.children.length > 0

  // For leaf nodes, look up the slug directly from tocIdToSlug
  if (node.isLeaf) {
    const slug = tocIdToSlug[nodeId]
    if (!slug) return null  // No matching document

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesSearch = node.title.toLowerCase().includes(query)
      if (!matchesSearch) return null
    }

    return (
      <li className="tree-leaf">
        <NavLink
          to={`/doc/${slug}`}
          className={({ isActive }) => `nav-link document-leaf ${isActive ? 'active' : ''}`}
        >
          {node.title}
        </NavLink>
      </li>
    )
  }

  // Check if this is a group folder - render with special styling
  if (isGroupFolder(node)) {
    return (
      <TreeGroup
        nodeId={nodeId}
        node={node}
        nodes={nodes}
        tocIdToSlug={tocIdToSlug}
        expandedNodes={expandedNodes}
        toggleNode={toggleNode}
        searchQuery={searchQuery}
      />
    )
  }

  // For regular folder nodes, separate group children from regular children
  const { groupChildren, regularChildren } = useMemo(() => {
    if (!hasChildren) return { groupChildren: [], regularChildren: [] }
    
    const groups = []
    const regular = []
    
    node.children.forEach(childId => {
      const child = nodes[childId]
      if (!child) return
      
      if (!child.isLeaf && isGroupFolder(child)) {
        groups.push(childId)
      } else {
        regular.push(childId)
      }
    })
    
    return { groupChildren: groups, regularChildren: regular }
  }, [node.children, nodes, hasChildren])

  // Filter visible children based on search
  const visibleRegularChildren = useMemo(() => {
    if (!searchQuery) return regularChildren
    
    return regularChildren.filter(childId => {
      const child = nodes[childId]
      if (!child) return false
      
      if (child.isLeaf) {
        const slug = tocIdToSlug[childId]
        if (!slug) return false
        return child.title.toLowerCase().includes(searchQuery.toLowerCase())
      }
      
      // For folders, always include (recursive filtering will handle visibility)
      return true
    })
  }, [regularChildren, nodes, tocIdToSlug, searchQuery])

  // Check if any descendants match the search
  const hasVisibleDescendants = useMemo(() => {
    if (!searchQuery) return hasChildren
    
    const checkDescendants = (childIds) => {
      for (const childId of childIds) {
        const child = nodes[childId]
        if (!child) continue
        
        if (child.isLeaf) {
          const slug = tocIdToSlug[childId]
          if (slug && child.title.toLowerCase().includes(searchQuery.toLowerCase())) {
            return true
          }
        } else if (child.children && child.children.length > 0) {
          if (checkDescendants(child.children)) return true
        }
      }
      return false
    }
    
    return checkDescendants(node.children || [])
  }, [node.children, nodes, tocIdToSlug, searchQuery, hasChildren])

  // Hide empty folders when searching
  if (searchQuery && !hasVisibleDescendants) return null

  return (
    <li className="tree-folder">
      <button 
        className={`folder-toggle ${isExpanded ? 'expanded' : ''}`}
        onClick={() => toggleNode(nodeId)}
        type="button"
      >
        <span className="folder-icon">{isExpanded ? '▼' : '▶'}</span>
        <span className="folder-title">{node.title}</span>
      </button>
      {isExpanded && hasChildren && (
        <ul className="tree-children">
          {/* Render group children first */}
          {groupChildren.map(childId => {
            const childNode = nodes[childId]
            return (
              <TreeGroup
                key={childId}
                nodeId={childId}
                node={childNode}
                nodes={nodes}
                tocIdToSlug={tocIdToSlug}
                expandedNodes={expandedNodes}
                toggleNode={toggleNode}
                searchQuery={searchQuery}
              />
            )
          })}
          {/* Then render regular children */}
          {visibleRegularChildren.map(childId => (
            <TreeNode
              key={childId}
              nodeId={childId}
              nodes={nodes}
              tocIdToSlug={tocIdToSlug}
              expandedNodes={expandedNodes}
              toggleNode={toggleNode}
              searchQuery={searchQuery}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// Fallback: Group sections by category when no tree structure exists
function CategoryView({ sections, searchQuery }) {
  const groupedSections = useMemo(() => {
    const groups = {}
    sections.forEach(section => {
      if (!groups[section.category]) {
        groups[section.category] = []
      }
      groups[section.category].push(section)
    })
    return groups
  }, [sections])

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return groupedSections
    }

    const query = searchQuery.toLowerCase()
    const filtered = {}

    Object.entries(groupedSections).forEach(([category, items]) => {
      const matchingItems = items.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
      )
      if (matchingItems.length > 0) {
        filtered[category] = matchingItems
      }
    })

    return filtered
  }, [groupedSections, searchQuery])

  const categories = Object.keys(filteredGroups).sort()

  if (categories.length === 0) {
    return <p className="no-results">No documents found</p>
  }

  return (
    <>
      {categories.map(category => (
        <div key={category} className="nav-category">
          <h3 className="category-title">{category}</h3>
          <ul className="nav-list">
            {filteredGroups[category].map(section => (
              <li key={section.id}>
                <NavLink
                  to={`/doc/${section.id}`}
                  className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
                >
                  {section.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

// Filter to identify actual TIS root sections (A-R pattern or "General Vehicle Information")
const isValidRootFolder = (node) => {
  if (!node || !node.title) return false
  const title = node.title.trim()
  
  // Match patterns like "A Maintenance...", "B Paint", "H Brakes", etc.
  // Or "General Vehicle Information"
  const sectionPattern = /^[A-R]\s+[A-Z]/i
  const generalPattern = /^General\s+Vehicle/i
  
  return sectionPattern.test(title) || generalPattern.test(title)
}

function Sidebar({ sections, tree, tocIdToSlug, isColumnLayout, isMobile, isTablet, isOpen, onClose, externalNavPath, onExternalNavComplete }) {
  const [searchQuery, setSearchQuery] = useState('')
  const { id: activeDocId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const initialExpandRef = useRef(true)
  
  // Sidebar mode: 'manual' or 'epc'
  const [sidebarMode, setSidebarMode] = useState(() => {
    // Auto-detect from URL
    if (location.pathname.startsWith('/epc')) {
      return 'epc'
    }
    // Try to restore from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SIDEBAR_MODE)
      if (saved === 'epc' || saved === 'manual') {
        return saved
      }
    } catch (e) {}
    return 'manual'
  })
  
  // Update mode when URL changes
  useEffect(() => {
    if (location.pathname.startsWith('/epc')) {
      setSidebarMode('epc')
    } else if (location.pathname.startsWith('/doc') || location.pathname === '/') {
      setSidebarMode('manual')
    }
  }, [location.pathname])
  
  // Persist mode to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_MODE, sidebarMode)
    } catch (e) {}
  }, [sidebarMode])
  
  // Handle mode change
  const handleModeChange = useCallback((mode) => {
    setSidebarMode(mode)
    if (mode === 'epc' && !location.pathname.startsWith('/epc')) {
      navigate('/epc')
    } else if (mode === 'manual' && location.pathname.startsWith('/epc')) {
      navigate('/')
    }
  }, [navigate, location.pathname])

  // Build reverse mapping: slug -> tocId for finding active document in tree
  const slugToTocId = useMemo(() => {
    if (!tocIdToSlug) return {}
    const reverse = {}
    for (const [tocId, slug] of Object.entries(tocIdToSlug)) {
      reverse[slug] = tocId
    }
    return reverse
  }, [tocIdToSlug])

  // Initialize expandedNodes - prioritize URL-based expansion, then localStorage
  const [expandedNodes, setExpandedNodes] = useState(() => {
    // If there's an active document in URL, expand its ancestors
    if (activeDocId && tree?.nodes && slugToTocId[activeDocId]) {
      const activeTocId = slugToTocId[activeDocId]
      const nodesToExpand = new Set()
      
      const findAncestors = (nodeId) => {
        const node = tree.nodes[nodeId]
        if (node && node.parentId) {
          nodesToExpand.add(node.parentId)
          findAncestors(node.parentId)
        }
      }
      
      findAncestors(activeTocId)
      if (nodesToExpand.size > 0) {
        return nodesToExpand
      }
    }
    
    // Otherwise, try to restore from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EXPANDED_NODES)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          // Validate that saved nodes still exist in tree
          if (tree?.nodes) {
            const validNodes = parsed.filter(id => tree.nodes[id])
            return new Set(validNodes)
          }
          return new Set(parsed)
        }
      }
    } catch (e) {
      console.warn('Failed to load expanded nodes from localStorage:', e)
    }
    
    return new Set()
  })

  // Persist expandedNodes to localStorage when they change (but not on initial URL-based expansion)
  useEffect(() => {
    if (initialExpandRef.current) {
      initialExpandRef.current = false
      return
    }
    try {
      localStorage.setItem(STORAGE_KEYS.EXPANDED_NODES, JSON.stringify([...expandedNodes]))
    } catch (e) {
      console.warn('Failed to save expanded nodes to localStorage:', e)
    }
  }, [expandedNodes])
  
  // Determine max visible columns for mobile/tablet
  const maxVisibleColumns = isMobile ? 1 : isTablet ? 2 : Infinity
  const showMobileMenu = isMobile || isTablet
  
  // Handle document navigation on mobile (auto-close menu)
  const handleMobileNavigate = useCallback((slug) => {
    if (showMobileMenu && onClose) {
      navigate(`/doc/${slug}`)
      onClose()
    }
  }, [showMobileMenu, onClose, navigate])

  // Filter tree roots to only include actual TIS section folders
  const filteredRoots = useMemo(() => {
    if (!tree || !tree.roots || !tree.nodes) return []
    
    return tree.roots.filter(rootId => {
      const node = tree.nodes[rootId]
      return isValidRootFolder(node)
    })
  }, [tree])

  // Check if we have a valid tree structure AND tocIdToSlug mapping
  const hasTree = filteredRoots.length > 0 && tree.nodes && tocIdToSlug && Object.keys(tocIdToSlug).length > 0

  // Toggle folder expansion
  const toggleNode = useCallback((nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // Expand ancestors of active document when URL changes (only for tree view, not column view)
  useEffect(() => {
    if (!activeDocId || !hasTree || isColumnLayout) return

    const activeTocId = slugToTocId[activeDocId]
    if (!activeTocId) return

    // Find all ancestors of this node and expand them
    const nodesToExpand = new Set()
    
    const findAncestors = (nodeId) => {
      const node = tree.nodes[nodeId]
      if (node && node.parentId) {
        nodesToExpand.add(node.parentId)
        findAncestors(node.parentId)
      }
    }
    
    findAncestors(activeTocId)

    if (nodesToExpand.size > 0) {
      setExpandedNodes(prev => {
        const next = new Set(prev)
        nodesToExpand.forEach(id => next.add(id))
        return next
      })
    }
  }, [activeDocId, hasTree, tree, slugToTocId, isColumnLayout])

  // When searching, auto-expand folders with matches (only for tree view)
  useEffect(() => {
    if (!searchQuery || !hasTree || isColumnLayout) return

    const query = searchQuery.toLowerCase()
    const nodesToExpand = new Set()

    const checkNode = (nodeId, ancestors = []) => {
      const node = tree.nodes[nodeId]
      if (!node) return false

      if (node.isLeaf) {
        const slug = tocIdToSlug[nodeId]
        if (slug && node.title.toLowerCase().includes(query)) {
          ancestors.forEach(id => nodesToExpand.add(id))
          return true
        }
        return false
      }

      let hasMatch = false
      if (node.children) {
        for (const childId of node.children) {
          if (checkNode(childId, [...ancestors, nodeId])) {
            hasMatch = true
          }
        }
      }
      return hasMatch
    }

    tree.roots.forEach(rootId => checkNode(rootId, []))

    if (nodesToExpand.size > 0) {
      setExpandedNodes(nodesToExpand)
    }
  }, [searchQuery, hasTree, tree, tocIdToSlug, isColumnLayout])

  // Mobile overlay wrapper
  const sidebarContent = (
    <>
      {showMobileMenu && (
        <div className="mobile-menu-header">
          <button 
            className="mobile-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="mobile-menu-title">Menu</span>
        </div>
      )}
      
      {/* Mode Toggle */}
      <div className="sidebar-mode-toggle">
        <button
          className={`sidebar-mode-btn ${sidebarMode === 'manual' ? 'active' : ''}`}
          onClick={() => handleModeChange('manual')}
        >
          <span className="sidebar-mode-icon">📖</span>
          Manual
        </button>
        <button
          className={`sidebar-mode-btn ${sidebarMode === 'epc' ? 'active' : ''}`}
          onClick={() => handleModeChange('epc')}
        >
          <span className="sidebar-mode-icon">🔧</span>
          Parts
        </button>
      </div>
      
      {sidebarMode === 'epc' ? (
        <EPCSidebarNav onClose={onClose} showMobileMenu={showMobileMenu} />
      ) : (
        <>
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
          <nav className="sidebar-nav">
            {isColumnLayout && hasTree ? (
              <ColumnNav
                roots={filteredRoots}
                nodes={tree.nodes}
                tocIdToSlug={tocIdToSlug}
                searchQuery={searchQuery}
                maxVisibleColumns={maxVisibleColumns}
                onDocumentSelect={showMobileMenu ? handleMobileNavigate : null}
                externalNavPath={externalNavPath}
                onExternalNavComplete={onExternalNavComplete}
              />
            ) : hasTree ? (
              <ul className="tree-root">
                {filteredRoots.map(rootId => (
                  <TreeNode
                    key={rootId}
                    nodeId={rootId}
                    nodes={tree.nodes}
                    tocIdToSlug={tocIdToSlug}
                    expandedNodes={expandedNodes}
                    toggleNode={toggleNode}
                    searchQuery={searchQuery}
                  />
                ))}
              </ul>
            ) : (
              <CategoryView sections={sections} searchQuery={searchQuery} />
            )}
          </nav>
        </>
      )}
    </>
  )

  // Mobile/tablet: render as overlay
  if (showMobileMenu) {
    return (
      <>
        {/* Backdrop */}
        <div 
          className={`mobile-menu-backdrop ${isOpen ? 'open' : ''}`}
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Menu */}
        <aside 
          className={`sidebar mobile-menu ${isOpen ? 'open' : ''} ${isColumnLayout ? 'sidebar-columns' : ''}`}
          aria-hidden={!isOpen}
        >
          {sidebarContent}
        </aside>
      </>
    )
  }

  // Desktop: render normally
  return (
    <aside className={`sidebar ${isColumnLayout && hasTree ? 'sidebar-columns' : ''}`}>
      {sidebarContent}
    </aside>
  )
}

export default Sidebar
