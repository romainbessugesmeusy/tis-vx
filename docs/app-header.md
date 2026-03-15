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
[≡]  VX220 ▾   Coolant Pump ▾                            [⚙]
hamburger  nav dropdown  page title (breadcrumb)          settings
```

- **Left**: Hamburger menu + VX220 dropdown (top-level navigation: Home, Parts, Resources)
- **Center**: Current page title — tappable with chevron when breadcrumb > 1 level (shows location-only popover); static text when at a root page
- **Right**: Settings icon only

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

### Mobile Navigation Dropdown (VX220)

On mobile/tablet, the VX220 logo becomes a dropdown trigger for top-level navigation:

- **Home** (house icon) — navigates to `/`, the homepage
- **Parts** (wrench icon) — navigates to `/epc`
- Divider
- **Tools, Torque, Pictograms, Glossary** — resource pages (`/ref/*`)

Active item is highlighted based on the current route. Uses `activeDropdown === 'nav'` for mutual exclusion with other dropdowns.

### Mobile Breadcrumb Popover

On mobile/tablet, tapping the page title opens a **location-only** popover (when breadcrumb has 2+ levels). It shows the indented tree path from root to the current page. When at a root page (homepage, EPC root), the page title is static text with no chevron.

Top-level navigation was moved out of this popover into the VX220 dropdown to improve discoverability.

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
.header-logo-dropdown /* Mobile VX220 dropdown trigger */
.header-breadcrumb   /* Desktop breadcrumb trail */
.header-page-title   /* Mobile page title button (when breadcrumb > 1) */
.header-page-title-static /* Mobile page title text (when breadcrumb == 1) */
.header-nav-btn      /* Nav icon buttons */
.header-popover      /* Shared popover/dropdown base */
.nav-popover         /* Mobile VX220 navigation dropdown */
.breadcrumb-popover  /* Mobile breadcrumb popover (location only) */
.resources-popover   /* Resources dropdown */
.settings-popover    /* Settings panel */
.settings-fullscreen /* Mobile settings overlay */
```

### Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| ≥1024px | Full breadcrumb, all nav icons, dropdown panels, VX220 is plain link |
| 768-1023px | VX220 nav dropdown, page title (breadcrumb-only popover or static), settings fullscreen |
| <768px | VX220 nav dropdown, page title (breadcrumb-only popover or static), compact padding |

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
