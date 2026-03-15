# Bookmarks Feature

## Overview

Bookmarks let users save and organize references to manual pages, EPC parts/diagrams, tools, and torque specs. Bookmarks are grouped into user-created folders, support notes, and can be exported/imported as JSON files for sharing.

## Bookmarkable Entities

| Type | Trigger | Route stored | Context |
|------|---------|-------------|---------|
| Manual page | Header icon (on `/doc/*`) | `/doc/{slug}` | `{ slug }` |
| EPC diagram | Header icon (on `/epc/*/diagram/*`) | `/epc/{groupId}/diagram/{diagramId}` | `{ groupId, diagramId }` |
| EPC part | Inline icon in part info bar | `/epc/{groupId}/diagram/{diagramId}` | `{ groupId, diagramId, ref, partNo, description }` |
| Tool | Inline icon on tool card | `/ref/tools` | `{ code }` |
| Torque spec | Inline icon on torque row | `/ref/torque` | `{ component, value, unit, sourcePage }` |

## Data Model

Stored in localStorage under key `tis-bookmarks`:

```json
{
  "folders": [
    { "id": "uuid", "name": "Folder Name", "createdAt": 1710500000000 }
  ],
  "bookmarks": [
    {
      "id": "uuid",
      "type": "manual|epc-diagram|epc-part|tool|torque",
      "title": "Display title",
      "note": "User note",
      "folderId": "uuid",
      "route": "/doc/some-slug",
      "context": {},
      "createdAt": 1710500000000
    }
  ]
}
```

## Architecture

- **`useBookmarks` hook** (`viewer/src/hooks/useBookmarks.js`): Manages localStorage persistence. Exposes CRUD for folders and bookmarks, plus `isBookmarked()`, `exportFolder()`, `importFolder()`.
- **`BookmarkContext`** (in `BookmarkDialog.jsx`): React Context wrapping the app. Provides bookmark state and `openBookmarkDialog()` / `closeBookmarkDialog()` to all components.
- **`BookmarkDialog`** (`viewer/src/components/BookmarkDialog.jsx`): Modal (desktop) / bottom sheet (mobile) for adding a bookmark. Contains: title input, folder selector or new folder input, note textarea.
- **`BookmarkButton`** (`viewer/src/components/BookmarkButton.jsx`): Inline icon button. Shows filled icon when item is already bookmarked.
- **`BookmarksPage`** (`viewer/src/components/BookmarksPage.jsx`): Dedicated page at `/bookmarks`. Collapsible folder sections with rename, export, delete actions. Bookmark rows link to the saved route. Import button for JSON files.

## UI Access Points

- **Header bookmark icon**: Visible on `/doc/*` and `/epc/*/diagram/*` routes. Filled when current page is bookmarked.
- **Inline bookmark icons**: Next to each tool card (ToolsList), each torque table row (TorqueList), and in the EPC part info bar.
- **Bookmarks page**: Accessible from header nav (desktop: bookmark icon button, mobile: VX220 dropdown).

## Export / Import Format

A folder export produces a JSON file:

```json
{
  "folder": { "id": "...", "name": "...", "createdAt": ... },
  "bookmarks": [ ... ],
  "exportedAt": ...,
  "version": 1
}
```

Importing creates a new folder with new IDs (no conflicts with existing data).

## Duplicate Detection

`isBookmarked()` uses type-specific matching:
- **tool**: matches on `context.code`
- **torque**: matches on `context.component` + `context.value` + `context.sourcePage`
- **epc-part**: matches on `context.diagramId` + `context.ref`
- **manual / epc-diagram**: matches on `route`

## Responsive Behavior

- **BookmarkDialog**: Full modal on desktop, bottom sheet (slide-up) on mobile
- **BookmarkButton**: Same sizing as existing inline actions (e.g. copy-part-number in EPC)
- **BookmarksPage**: Stacked folder sections; note preview hidden on mobile for space
- **Header bookmark icon**: Same pattern as existing `header-nav-btn` icons
