# App Header - Design Decisions & Implementation

## Overview

The AppHeader component (`viewer/src/components/AppHeader.jsx`) replaces the previous inline header in App.jsx. It consolidates navigation, breadcrumb, and settings into a clean, responsive header bar.

## Navigation Tree Structure

The app has five top-level navigation items:

| Item | Sub-items | Access |
|------|-----------|--------|
| Manual | (sidebar tree) | Header nav icon + breadcrumb root |
| Parts | (EPC sidebar tree) | Header nav icon + breadcrumb root |
| Resources | Tools, Torque, Pictograms, Glossary | Dropdown (desktop) / Popover (mobile) |
| Settings | Engine Filter, Downloads | Dropdown panel |
| Search | — | Sidebar search bar |

## Header Layout

### Desktop (≥1024px)

```
[VX220]  Manual / A - General / Engine / Coolant Pump   [📖] [🔧] [📚▾] [⚙]
 logo      interactive breadcrumb                         nav icons
```

- **Left**: VX220 logo button (navigates to /)
- **Center**: Full breadcrumb trail with clickable ancestors
- **Right**: Manual, Parts, Resources dropdown, Settings dropdown

### Mobile/Tablet (<1024px)

```
[≡]  Coolant Pump ▾                                     [⚙]
hamburger  page title (tappable)                         settings
```

- **Left**: Hamburger menu + logo
- **Center**: Current page title with chevron — tap to open breadcrumb popover
- **Right**: Settings icon only (Manual/Parts/Resources accessible via popover)

## Interactive Breadcrumb

The breadcrumb shows the user's current location in the tree hierarchy and supports interactive navigation.

### Breadcrumb Sources

| Route | Breadcrumb |
|-------|------------|
| `/` | Manual |
| `/doc/:slug` | Manual / [tree ancestors...] / [page title] |
| `/epc` | Parts |
| `/epc/:groupId/diagram/:id` | Parts |
| `/ref/:type` | Resources / [Type name] |

### How Tree Breadcrumbs Work

For `/doc/:slug` pages, the breadcrumb is computed by:
1. Building a `slugToNodeId` map by iterating all tree nodes' `variants` (NOT from `tocIdToSlug`, which uses a different ID space — `leaf.xxx` tocIds vs `m_xxx` tree node IDs)
2. Looking up the URL slug in `slugToNodeId` to find the tree node
3. Walking up `parentId` references from the node to root
4. Rendering each ancestor as a clickable button

**Important**: `manifest.tocIdToSlug` maps TIS-native tocIds (`leaf.xxx`) to slugs for link resolution. Tree nodes use their own IDs (`m_xxx`). These are different ID systems. The breadcrumb must scan `node.variants[engine].slug` to find tree nodes by URL slug.

Clicking a breadcrumb ancestor triggers `onNavigateToNode(path)`, which uses the existing `externalNavPath` mechanism to expand and scroll the sidebar to that section.

### Mobile Breadcrumb Popover

On mobile/tablet, tapping the page title opens a popover with two sections:

1. **Breadcrumb path** (if deeper than root): Indented hierarchy showing current location
2. **Navigation**: Quick links to Manual, Parts, and all Resource pages

## Settings Panel

The settings panel is a dropdown (desktop) or fullscreen overlay (mobile) containing:

### Engine Filter
- Shows when manifest has multiple engines (Z20LET + Z22SE)
- Toggle pills: All / Z20LET (Turbo) / Z22SE (NA)
- Active state with engine-specific colors (blue for turbo, green for NA)
- Persisted in localStorage (`vx220-engine-filter`)

### Downloads
- `DownloadManager` is embedded directly as flat content (no card wrapper, no header, no close button)
- The component has no `onClose` prop — closing is handled by the settings panel itself
- Styles use CSS variables from `App.css` (dark theme) instead of inline `<style>` — no more light-themed card inside dark panel
- Offline indicator badge shown when browser is offline

## State Management

### Owned by AppHeader
| State | Purpose |
|-------|---------|
| `breadcrumbPopoverOpen` | Mobile breadcrumb popover visibility |
| `activeDropdown` | Which dropdown is open ('resources' / 'settings' / null) |

### Received as Props (from App.jsx)
| Prop | Purpose |
|------|---------|
| `manifest` | Tree structure for breadcrumb computation |
| `selectedEngine` / `onEngineChange` | Engine filter state |
| `isOffline` | Offline indicator |
| `isMobile` / `isTablet` | Responsive breakpoints |
| `onMenuToggle` | Opens the sidebar menu on mobile |
| `onNavigateToNode` | Navigates sidebar to a tree path (breadcrumb interaction) |

### What Changed from Previous Header
- **Removed**: Inline header in App.jsx, vehicle info text, nav pills, offline dropdown
- **Removed from Sidebar**: Manual/Parts mode toggle (mode now auto-detects from URL)
- **Added**: Breadcrumb, Resources dropdown, Settings panel
- **Moved**: Engine filter → Settings panel, Download Manager → Settings panel

## CSS Architecture

All styles are in `App.css` under the `===== App Header =====` section.

### Key Classes

```css
.header              /* Fixed header bar */
.header-left         /* Logo + hamburger */
.header-center       /* Breadcrumb area */
.header-right        /* Nav actions */
.header-breadcrumb   /* Desktop breadcrumb trail */
.header-page-title   /* Mobile page title button */
.header-nav-btn      /* Nav icon buttons */
.header-popover      /* Shared popover/dropdown base */
.breadcrumb-popover  /* Mobile breadcrumb popover */
.resources-popover   /* Resources dropdown */
.settings-popover    /* Settings panel */
.settings-fullscreen /* Mobile settings overlay */
```

### Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| ≥1024px | Full breadcrumb, all nav icons, dropdown panels |
| 768-1023px | Page title + popover, settings icon only, settings goes fullscreen |
| <768px | Page title + popover, settings icon only, compact padding |

### Popover Animation

```css
@keyframes popover-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Breadcrumb Overflow

Desktop breadcrumb uses a CSS mask to fade out gracefully when content is too long:

```css
.header-breadcrumb {
  mask-image: linear-gradient(to right, black 90%, transparent 100%);
}
```

## Sidebar Mode Sync

The Sidebar component keeps its internal `sidebarMode` state but now auto-syncs from URL:

```javascript
useEffect(() => {
  if (location.pathname.startsWith('/epc')) setSidebarMode('epc')
  else if (location.pathname.startsWith('/doc') || location.pathname === '/') setSidebarMode('manual')
}, [location.pathname])
```

The AppHeader drives mode changes by navigating to `/` (manual) or `/epc` (parts), and the sidebar follows.

## Interaction Patterns

### Click-Outside Dismissal
All dropdowns and popovers close when clicking outside the header element.

### Route-Change Dismissal
All dropdowns and popovers close automatically on route changes.

### Escape Key
Pressing Escape closes any open dropdown or popover.

### Mobile Backdrop
The Settings panel on mobile shows a semi-transparent backdrop behind it. Clicking the backdrop closes the panel.

## Future Considerations

- **EPC breadcrumbs**: Currently shows just "Parts" for all EPC routes. Could trace EPC tree for deeper breadcrumbs.
- **Search in header**: Search icon could expand a command-palette-style search overlay.
- **Keyboard navigation**: Arrow keys to navigate breadcrumb segments.
- **Breadcrumb truncation**: For very deep paths, could show first + last segments with "..." in between.
- **Settings panel sections**: Could add more settings (theme, font size, etc.) as the app grows.
