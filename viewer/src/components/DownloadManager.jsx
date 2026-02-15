import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useOffline,
  getStoredSectionUrls,
  setStoredSectionUrls,
  addToCache,
  removeCachedSection,
  getStorageEstimate,
  requestPersistentStorage,
} from '../hooks/useOffline'

const isValidRootFolder = (node) => {
  if (!node || !node.title) return false
  const title = node.title.trim()
  const sectionPattern = /^[A-R]\s+[A-Z]/i
  const generalPattern = /^General\s+Vehicle/i
  return sectionPattern.test(title) || generalPattern.test(title)
}

function getSlugsUnderRoot(rootId, tree) {
  const nodes = tree?.nodes
  if (!nodes) return []
  const slugs = new Set()
  const walk = (nodeId) => {
    const node = nodes[nodeId]
    if (!node) return
    if (node.isLeaf && node.variants) {
      Object.values(node.variants).forEach((v) => {
        if (v && v.slug) slugs.add(v.slug)
      })
    } else if (node.children) {
      node.children.forEach(walk)
    }
  }
  walk(rootId)
  return [...slugs]
}

function buildSections(manifest) {
  const tree = manifest?.tree
  const roots = tree?.roots || []
  const nodes = tree?.nodes || {}
  if (!roots.length || !nodes) return []

  return roots
    .filter((id) => isValidRootFolder(nodes[id]))
    .map((rootId) => {
      const node = nodes[rootId]
      const title = node?.title || rootId
      const slugs = getSlugsUnderRoot(rootId, tree)
      const urls = slugs.flatMap((s) => [`/data/content/${s}.json`, `/data/content/${s}.html`])
      return { rootId, title, slugs, urls }
    })
}

// Reference pages (Tools, Torque, Pictograms, Glossary)
const PAGE_ITEMS = [
  { rootId: '_ref_tools', title: 'Tools', urls: ['/data/references/tools.json'] },
  { rootId: '_ref_torque', title: 'Torque', urls: ['/data/references/torque-values.json'] },
  { rootId: '_ref_pictograms', title: 'Pictograms', urls: ['/data/references/pictograms.json'] },
  { rootId: '_ref_glossary', title: 'Glossary', urls: ['/data/references/glossary.json'] },
]

const EPC_CORE_URLS = ['/data/epc/parts.json', '/data/epc/hotspots/_index.json']

/** Build EPC core + per-group items from parts.json. Returns { core, groups } */
function buildEpcItems(partsData) {
  if (!partsData?.groups || !partsData?.diagrams) {
    return {
      core: { rootId: '_epc_core', title: 'Core (parts list & index)', urls: EPC_CORE_URLS },
      groups: [],
    }
  }
  const diagrams = partsData.diagrams
  const groups = partsData.groups.map((group) => {
    const diagramIds = new Set()
    for (const sub of group.subSections || []) {
      for (const m of sub.main || []) {
        for (const p of m.parts || []) {
          if (p.diagramId) diagramIds.add(p.diagramId)
        }
      }
    }
    const urls = []
    diagramIds.forEach((id) => {
      if (diagrams[id]?.filename) urls.push(`/data/epc/diagrams/${diagrams[id].filename}`)
      urls.push(`/data/epc/hotspots/${id}.json`)
    })
    return {
      rootId: `_epc_group_${group.id}`,
      title: `${group.id} – ${group.name}`,
      urls: [...new Set(urls)],
    }
  })
  return {
    core: { rootId: '_epc_core', title: 'Core (parts list & index)', urls: EPC_CORE_URLS },
    groups,
  }
}

export default function DownloadManager({ manifest, onClose }) {
  const { isOnline } = useOffline()
  const [storage, setStorage] = useState({ usage: 0, quota: 0 })
  const [downloadingId, setDownloadingId] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [removingId, setRemovingId] = useState(null)
  const [stored, setStored] = useState(getStoredSectionUrls)
  const [persisted, setPersisted] = useState(false)
  const [expandedPanels, setExpandedPanels] = useState({ pages: true, epc: true, manual: true })
  const [epcPartsData, setEpcPartsData] = useState(null)

  const manualSections = useMemo(
    () => (manifest ? buildSections(manifest) : []),
    [manifest]
  )
  const epcItems = useMemo(() => buildEpcItems(epcPartsData), [epcPartsData])
  const allItems = useMemo(
    () => [
      ...PAGE_ITEMS,
      epcItems.core,
      ...epcItems.groups,
      ...manualSections,
    ],
    [epcItems.core, epcItems.groups, manualSections]
  )

  const refreshStored = useCallback(() => {
    setStored(getStoredSectionUrls())
  }, [])

  useEffect(() => {
    getStorageEstimate().then(setStorage)
  }, [stored, downloadingId])

  useEffect(() => {
    requestPersistentStorage().then(setPersisted)
  }, [])

  useEffect(() => {
    if (!expandedPanels.epc || epcPartsData) return
    fetch('/data/epc/parts.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setEpcPartsData)
      .catch(() => setEpcPartsData(null))
  }, [expandedPanels.epc, epcPartsData])

  const togglePanel = useCallback((panel) => {
    setExpandedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }))
  }, [])

  const handleDownload = useCallback(
    async (section) => {
      if (!isOnline) return
      const urls = section.urls || []
      if (!urls.length) return
      setDownloadingId(section.rootId)
      setProgress({ done: 0, total: urls.length })
      await addToCache(urls, (done, total) => setProgress({ done, total }))
      setStoredSectionUrls(section.rootId, urls)
      refreshStored()
      setDownloadingId(null)
    },
    [isOnline, refreshStored]
  )

  const handleRemove = useCallback(
    async (section) => {
      setRemovingId(section.rootId)
      await removeCachedSection(section.rootId)
      refreshStored()
      setRemovingId(null)
    },
    [refreshStored]
  )

  const handleDownloadAll = useCallback(async () => {
    if (!isOnline) return
    const coreUrls = ['/data/manifest.json']
    setDownloadingId('_all')
    let total = coreUrls.length
    allItems.forEach((s) => { total += (s.urls || []).length })
    let done = 0
    setProgress({ done: 0, total })
    await addToCache(coreUrls, (d) => {
      done = d
      setProgress({ done, total })
    })
    for (const section of allItems) {
      const urls = section.urls || []
      if (!urls.length) continue
      const start = done
      await addToCache(urls, (d) => {
        setProgress({ done: start + d, total })
      })
      done = start + urls.length
      setStoredSectionUrls(section.rootId, urls)
    }
    refreshStored()
    setDownloadingId(null)
  }, [isOnline, allItems, refreshStored])

  const handleRemoveAll = useCallback(async () => {
    for (const section of allItems) {
      await removeCachedSection(section.rootId)
    }
    refreshStored()
  }, [allItems, refreshStored])

  const formatBytes = (n) => {
    if (n === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(n) / Math.log(k))
    return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const isSectionDownloaded = (rootId) => {
    const urls = stored[rootId]
    return Array.isArray(urls) && urls.length > 0
  }

  const hasAnyDownloaded = allItems.some((s) => isSectionDownloaded(s.rootId))

  const getSectionMeta = (section) => {
    const urlCount = (section.urls || []).length
    if (urlCount === 0) return '0 files'
    if (section.slugs?.length) return `${section.slugs.length} docs · ${urlCount} files`
    return `${urlCount} file${urlCount !== 1 ? 's' : ''}`
  }

  const renderItem = (section) => {
    const downloaded = isSectionDownloaded(section.rootId)
    const isDownloading = downloadingId === section.rootId
    const isRemoving = removingId === section.rootId
    const prog = isDownloading ? progress : null
    return (
      <li key={section.rootId} className="download-manager-item">
        <div className="download-manager-item-main">
          <span className="download-manager-item-title">{section.title}</span>
          <span className="download-manager-item-meta">{getSectionMeta(section)}</span>
          <div className="download-manager-item-actions">
            {downloaded ? (
              <button
                type="button"
                className="download-manager-btn download-manager-btn-small"
                disabled={!isOnline || isRemoving || isDownloading}
                onClick={() => handleRemove(section)}
              >
                {isRemoving ? 'Removing…' : 'Remove'}
              </button>
            ) : (
              <button
                type="button"
                className="download-manager-btn download-manager-btn-small download-manager-btn-primary"
                disabled={!isOnline || isDownloading}
                onClick={() => handleDownload(section)}
              >
                {isDownloading && prog ? `${prog.done}/${prog.total}` : 'Download'}
              </button>
            )}
          </div>
        </div>
        {isDownloading && prog && prog.total > 0 && (
          <div className="download-manager-progress">
            <div
              className="download-manager-progress-bar"
              style={{ width: `${(100 * prog.done) / prog.total}%` }}
            />
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="download-manager">
      <div className="download-manager-header">
        <h2>Offline downloads</h2>
        <button type="button" className="download-manager-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!isOnline && (
        <p className="download-manager-offline-msg">You need to be online to download sections.</p>
      )}
      <div className="download-manager-storage">
        <span>Storage: {formatBytes(storage.usage)} used</span>
        {storage.quota > 0 && <span> of {formatBytes(storage.quota)}</span>}
        {persisted && <span className="download-manager-persisted"> (persistent)</span>}
      </div>
      <div className="download-manager-actions">
        <button
          type="button"
          className="download-manager-btn download-manager-btn-primary"
          disabled={!isOnline || downloadingId !== null}
          onClick={handleDownloadAll}
        >
          {downloadingId === '_all' ? `Downloading… ${progress.done}/${progress.total}` : 'Download all'}
        </button>
        {hasAnyDownloaded && (
          <button
            type="button"
            className="download-manager-btn"
            disabled={removingId !== null || downloadingId !== null}
            onClick={handleRemoveAll}
          >
            Remove all
          </button>
        )}
      </div>
      <div className="download-manager-panels">
        <div className="download-manager-panel">
          <button
            type="button"
            className="download-manager-panel-header"
            onClick={() => togglePanel('pages')}
            aria-expanded={expandedPanels.pages}
          >
            <span className="download-manager-panel-chevron">{expandedPanels.pages ? '▼' : '▶'}</span>
            <span className="download-manager-panel-title">Pages (Tools, Torque, Pictograms, Glossary)</span>
          </button>
          {expandedPanels.pages && (
            <ul className="download-manager-list">
              {PAGE_ITEMS.map((item) => renderItem(item))}
            </ul>
          )}
        </div>
        <div className="download-manager-panel">
          <button
            type="button"
            className="download-manager-panel-header"
            onClick={() => togglePanel('epc')}
            aria-expanded={expandedPanels.epc}
          >
            <span className="download-manager-panel-chevron">{expandedPanels.epc ? '▼' : '▶'}</span>
            <span className="download-manager-panel-title">Parts (EPC)</span>
          </button>
          {expandedPanels.epc && (
            <ul className="download-manager-list">
              {renderItem(epcItems.core)}
              {epcItems.groups.length === 0 && !epcPartsData && (
                <li className="download-manager-item download-manager-item-muted">Loading groups…</li>
              )}
              {epcItems.groups.map((group) => renderItem(group))}
            </ul>
          )}
        </div>
        <div className="download-manager-panel">
          <button
            type="button"
            className="download-manager-panel-header"
            onClick={() => togglePanel('manual')}
            aria-expanded={expandedPanels.manual}
          >
            <span className="download-manager-panel-chevron">{expandedPanels.manual ? '▼' : '▶'}</span>
            <span className="download-manager-panel-title">Manual sections</span>
          </button>
          {expandedPanels.manual && (
            <ul className="download-manager-list">
              {manualSections.map((section) => renderItem(section))}
            </ul>
          )}
        </div>
      </div>
      <style>{`
        .download-manager {
          background: var(--bg-card, #fff);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          width: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .download-manager-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #e5e7eb);
          background: var(--bg-card, #fff);
        }
        .download-manager-header h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0;
          color: #1a1d23;
        }
        .download-manager-close {
          background: none;
          border: none;
          font-size: 1.5rem;
          line-height: 1;
          cursor: pointer;
          color: #6b7280;
          padding: 0 4px;
          border-radius: 4px;
        }
        .download-manager-close:hover {
          color: #1a1d23;
          background: rgba(0,0,0,0.06);
        }
        .download-manager-offline-msg {
          padding: 12px 20px;
          background: #fef3c7;
          color: #92400e;
          margin: 0;
          font-size: 0.9rem;
        }
        .download-manager-storage {
          padding: 12px 20px;
          font-size: 0.875rem;
          color: #4b5563;
        }
        .download-manager-persisted { color: var(--accent); }
        .download-manager-actions {
          padding: 0 20px 12px;
          display: flex;
          gap: 8px;
        }
        .download-manager-btn {
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-main);
          cursor: pointer;
          font-size: 0.875rem;
        }
        .download-manager-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .download-manager-btn-primary {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .download-manager-btn-primary:hover:not(:disabled) {
          background: var(--accent-hover);
        }
        .download-manager-panels {
          flex: 1;
          overflow-y: auto;
          padding: 0 20px 20px;
        }
        .download-manager-panel {
          margin-bottom: 12px;
        }
        .download-manager-panel-header {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 8px;
          background: rgba(0,0,0,0.03);
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          color: #1a1d23;
          text-align: left;
        }
        .download-manager-panel-header:hover {
          background: rgba(0,0,0,0.06);
        }
        .download-manager-panel-chevron {
          font-size: 0.7rem;
          color: #6b7280;
        }
        .download-manager-panel-title {
          flex: 1;
        }
        .download-manager-list {
          list-style: none;
          margin: 4px 0 0 0;
          padding: 0;
        }
        .download-manager-item {
          border: 1px solid var(--border);
          border-radius: 6px;
          margin-bottom: 8px;
          overflow: hidden;
        }
        .download-manager-item-muted {
          padding: 12px 14px;
          color: #6b7280;
          font-size: 0.9rem;
          border-style: dashed;
        }
        .download-manager-item-main {
          padding: 12px 14px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .download-manager-item-title {
          font-weight: 500;
          flex: 1 1 100%;
          color: #1a1d23;
        }
        .download-manager-item-meta {
          font-size: 0.8rem;
          color: #6b7280;
        }
        .download-manager-item-actions { margin-left: auto; }
        .download-manager-btn-small { padding: 4px 10px; font-size: 0.8rem; }
        .download-manager-progress {
          height: 4px;
          background: var(--border);
          overflow: hidden;
        }
        .download-manager-progress-bar {
          height: 100%;
          background: var(--accent);
          transition: width 0.2s ease;
        }
      `}</style>
    </div>
  )
}
