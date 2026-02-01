# Sidebar Navigation - Decisions & Learnings

## Overview

The TIS2Web viewer sidebar supports two navigation modes:
1. **Tree view** - Traditional collapsible tree (default, narrow sidebar)
2. **Column view** - macOS Finder-style multi-column navigation (wide sidebar ≥450px)

## Key Decisions

### Resizable Sidebar
- **Min width**: 240px
- **Max width**: Viewport width minus 100px (always keeps at least 100px for content)
- **Default width**: 320px (stored in localStorage as `sidebarWidth`)
- **Column threshold**: 450px - switches to column layout when sidebar is wider

### Column Navigation Design
- Each column shows children of the selected item in the previous column
- Column 1: Root-level sections (A-R categories)
- Column N+1: Children of selected item in column N
- Leaf nodes (documents) are links; folder nodes are buttons with `›` arrow
- Selected folders have a highlighted background and left border accent
- **Last column expands** to fill remaining sidebar space (no fixed max-width)

### Auto-Scroll Behavior
- When a new column is added that extends beyond the visible area, the sidebar auto-scrolls to reveal it
- Uses `scrollTo({ behavior: 'smooth' })` for animated transition
- Scrolls the `.sidebar-nav` container (the scrollable parent), not the `.column-nav` itself
- Uses `requestAnimationFrame` to ensure DOM has updated before calculating scroll position

### Grouped Document Types

Certain folder titles are treated as "group labels" rather than navigable columns. These are document-type categories that should display their children inline within the same column.

**Group Folder Titles:**
| Group | Emoji | Color |
|-------|-------|-------|
| Repair Instructions | 🔧 | Blue (#3b82f6) |
| Description and Operation | 📖 | Green (#10b981) |
| Component Locator | 📍 | Purple (#8b5cf6) |
| Specifications | 📋 | Orange (#f59e0b) |
| Special Tools and Equipment | 🛠️ | Red (#ef4444) |
| Technical Service Bulletins | 📢 | Pink (#ec4899) |
| Other Information | ℹ️ | Gray (#6b7280) |
| Inspections | 🔍 | Teal (#14b8a6) |
| Technical Information | 📚 | Indigo (#6366f1) |
| Schematic and Routing Diagrams | 📐 | Sky blue (#0ea5e9) |
| Circuit Diagram | ⚡ | Yellow (#eab308) |

**Group Behavior:**
- Groups render as collapsible labels with emoji, title, and document count
- Clicking the group label toggles collapse/expand (▼/▶ indicators)
- Documents within groups are listed directly below the label
- Non-group folders (sub-assemblies) appear below all groups as navigable items

### Mixed Columns

When a parent folder contains both group folders and regular folders, a "mixed column" is rendered:
1. **Group sections** appear first - each with emoji label, document count, and collapsible document list
2. **Sub-assembly folders** appear below - clickable items with `›` arrows that open new columns

### Nested Group Handling

Some group folders may contain other group folders (e.g., "Schematic and Routing Diagrams" containing "Circuit Diagram"). In these cases:
- The parent group is **not displayed** as a separate group
- Only the nested group is shown with its documents
- This prevents redundant nesting in the UI

**Example:**
```
Data structure:                    UI shows:
Schematic and Routing Diagrams     ⚡ Circuit Diagram (4)
└── Circuit Diagram                   └── Diagnostic link
    └── Diagnostic link               └── Start & Charging
    └── Start & Charging              └── ...
    └── ...
```

## Implementation Details

### Component Structure
```
Sidebar.jsx
├── ColumnNav (column layout)
│   ├── MixedColumn (groups + folders)
│   │   ├── column-group (collapsible group with documents)
│   │   └── column-other-folders (navigable sub-assemblies)
│   └── columns[] → column-nav-column → column-nav-list → column-nav-item
└── TreeNode (tree layout, recursive)
```

### Helper Functions
- `isGroupFolder(node)` - Checks if node title is in GROUP_FOLDER_TITLES
- `getGroupStyle(title)` - Returns emoji and color for a group
- `collectGroupLeaves(groupNode, nodes)` - Extracts leaves and detects nested groups
- `separateChildren(nodeId)` - Splits children into groups and regular folders

### State Management
- `selectedPath`: Array of node IDs representing the selection at each level
- `collapsedGroups`: Set of group IDs that are currently collapsed
- Path is built from root to selected folder
- Clicking a folder truncates the path and adds the new selection
- Clicking a leaf navigates to the document
- Clicking a group label toggles its collapsed state

### CSS Structure
```css
.sidebar-columns          /* Column mode wrapper */
.sidebar-columns .sidebar-nav  /* Scrollable container (overflow-x: auto) */
.column-nav               /* Flex row container (min-width: max-content) */
.column-nav-column        /* Individual column (min: 200px, max: 220px) */
.column-nav-column:last-child  /* Last column expands (flex-grow: 1, no max-width) */
.column-nav-link          /* Item button/link */
.column-nav-link.selected /* Selected folder */
.column-nav-link.active   /* Active document */

/* Group styles */
.column-mixed             /* Mixed column with groups and folders */
.column-group             /* Group container */
.column-group.collapsed   /* Collapsed group state */
.column-group-label       /* Clickable group header (button) */
.column-group-chevron     /* Collapse indicator (▼/▶) */
.column-group-emoji       /* Group type emoji */
.column-group-title       /* Uppercase group name */
.column-group-count       /* Badge with document count */
.column-group-items       /* List of documents in group */
.column-other-folders     /* Non-group folders section */
```

## Learnings

### Scroll Target
The scrollable element must be the parent container with `overflow-x: auto`, not the flex container with `min-width: max-content`. The flex container expands to fit content but doesn't scroll itself.

### Column Count Dependency
The `useEffect` for auto-scroll depends on `columns.length` to trigger when new columns are added. This ensures scroll happens after render.

### requestAnimationFrame
Using `requestAnimationFrame` before `scrollTo` ensures the DOM has been painted with the new column before calculating `scrollWidth`.

### Finder-Style UX
- Selection state is separate from navigation - clicking a folder selects it (shows children) but doesn't navigate
- Only leaf nodes trigger navigation
- The `›` arrow indicates expandable items (folders with children)
- No arrow means it's a leaf document

### Group Detection Strategy
- Use `.some()` (hasAnyGroupChildren) not `.every()` to detect mixed columns
- This handles real-world data where group folders and regular folders coexist at the same level
- Separating children into groups vs others allows rendering both in a single column

### Nested Group Detection
- When processing groups, check if any child is also a group folder
- If nested groups exist, only add the nested ones to the visible groups list
- This prevents showing redundant parent groups that only contain other groups

## Mobile Responsive Design

### Breakpoints
| Breakpoint | Width | Behavior |
|------------|-------|----------|
| Mobile | < 768px | Single column, hamburger menu, fullscreen overlay |
| Tablet | 768px - 1023px | Two columns, hamburger menu, fullscreen overlay |
| Desktop | ≥ 1024px | Multi-column, always-visible sidebar, resizable |

### Mobile Menu Pattern
- **Hamburger icon** in header opens fullscreen menu overlay
- **Backdrop** covers content area (click to close)
- **Close button** (X) in menu header
- **Menu slides in** from left with CSS transform animation
- **Body scroll locked** when menu is open (prevents background scrolling)
- **Escape key** closes menu

### Column Visibility on Mobile
- `maxVisibleColumns` prop controls how many columns are shown
- `visibleColumnStart` state tracks the "window" into the column array
- **Back button** appears when navigating deeper than the first column
- Clicking folders advances the visible window forward
- Back button moves the window backward and removes the last selection

### State Management for Mobile
```javascript
// In App.jsx
const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
const [isTablet, setIsTablet] = useState(() => 
  window.innerWidth >= 768 && window.innerWidth < 1024
)

// Props passed to Sidebar
<Sidebar 
  isMobile={isMobile}
  isTablet={isTablet}
  isOpen={isMobileMenuOpen}
  onClose={() => setIsMobileMenuOpen(false)}
/>
```

### Touch-Friendly Adjustments
- **Tap targets**: Minimum 44px height for interactive elements
- **Hover removal**: `@media (hover: none)` removes hover effects on touch devices
- **Active states**: Preserved for touch feedback (background change on tap)
- **User-select**: Disabled on interactive elements to prevent text selection
- **Touch scrolling**: `-webkit-overflow-scrolling: touch` for momentum scrolling
- **Overscroll containment**: `overscroll-behavior: contain` prevents pull-to-refresh interference

### CSS Structure for Mobile
```css
/* Mobile menu backdrop */
.mobile-menu-backdrop { }
.mobile-menu-backdrop.open { opacity: 1; pointer-events: auto; }

/* Mobile menu sidebar */
.sidebar.mobile-menu { 
  position: fixed;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
}
.sidebar.mobile-menu.open { transform: translateX(0); }

/* Mobile column navigation */
.mobile-column-nav { 
  flex-direction: column;
  min-width: 100% !important; /* Override max-content */
}
.mobile-column-nav .column-nav-column {
  min-width: 100%;
  max-width: 100%;
}

/* Fix overflow for mobile */
.mobile-menu .sidebar-nav {
  overflow-x: hidden;
  overflow-y: auto;
}
```

## Group Styling (Beautification)

### Card-Like Group Appearance
Groups are styled as contained cards rather than flat lists:

```css
.column-group {
  margin: 0 8px 12px 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  overflow: hidden;
}

.column-group-label {
  border-left: 3px solid var(--group-color);
  padding: 12px 14px;
}

.column-group-items {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding: 0 0 8px 0;
}
```

### Visual Indicators for Group Items
- **Dot indicators**: Subtle bullet points before each item
- **Indentation**: Items indented with `padding-left: 42px`
- **Active state**: Blue highlight with solid dot indicator

```css
.column-group-items .column-nav-link::before {
  content: '';
  position: absolute;
  left: 24px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-muted);
  opacity: 0.5;
}
```

## Learnings (Session: Mobile & Group Styling)

### React Hooks Order
Hooks must be called unconditionally at the top level. Moving a `useCallback` below early `return` statements caused "Rendered more hooks than during the previous render" error. All hooks must be defined before any conditional returns.

### Mobile Column Navigation Bug
When `handleMixedFolderClick` only updated `selectedPath` without updating `visibleColumnStart`, navigation stopped working after depth 1. Both states must be synchronized:
```javascript
const handleMixedFolderClick = useCallback((nodeId, colIndex) => {
  setSelectedPath(prev => {
    const newPath = prev.slice(0, colIndex)
    newPath.push(nodeId)
    return newPath
  })
  
  // Must also update visible window
  if (isMobileColumnMode) {
    const newColumnCount = colIndex + 2
    if (newColumnCount > maxVisibleColumns) {
      setVisibleColumnStart(newColumnCount - maxVisibleColumns)
    }
  }
}, [isMobileColumnMode, maxVisibleColumns])
```

### CSS min-width: max-content Issue
On desktop, `.column-nav { min-width: max-content }` allows horizontal scrolling to show all columns. On mobile, this must be overridden with `min-width: 100% !important` to prevent content from extending beyond viewport and causing cut-off.

### Mobile Overflow Handling
The parent `.sidebar-nav` has `overflow-x: auto` for desktop column scrolling, but on mobile this should be `overflow-x: hidden` to prevent horizontal scrolling. Added `.mobile-menu .sidebar-nav { overflow-x: hidden }`.

### Group Card Containment
Using `overflow: hidden` on `.column-group` ensures the border-radius is respected for child elements, particularly the left border on the group label.

### Visual Hierarchy for Groups
- Groups use a subtle background (`rgba(255, 255, 255, 0.02)`)
- Items within groups get a separator line (`border-top`)
- Dot indicators help distinguish group items from folder items
- Count badges use slightly smaller font and rounded pill styling

## Future Considerations

- Keyboard navigation (arrow keys to move between columns/items)
- Remembering scroll position when returning to a previously viewed section
- Column width could be configurable or adaptive based on content
- Persist collapsed group state in localStorage
- Search highlighting within groups
- Swipe gestures for mobile back navigation
- Pull-down to refresh on mobile
- Landscape mode optimization for tablets
