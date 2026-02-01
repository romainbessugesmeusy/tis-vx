import { useState, useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

/**
 * Reference index for browsing tools, torque values, and other technical data.
 */
function ReferenceIndex() {
  const { type } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(searchParams.get('q') || '')

  useEffect(() => {
    setLoading(true)
    const filename = type === 'torque' ? 'torque-values.json' : `${type}.json`
    
    fetch(`/data/references/${filename}`)
      .then(res => res.json())
      .then(json => {
        setData(json)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load reference:', err)
        setLoading(false)
      })
  }, [type])

  useEffect(() => {
    if (filter) {
      setSearchParams({ q: filter })
    } else {
      setSearchParams({})
    }
  }, [filter, setSearchParams])

  if (loading) {
    return <div className="reference-loading">Loading references...</div>
  }

  if (!data) {
    return <div className="reference-error">Failed to load reference data</div>
  }

  return (
    <div className="reference-index">
      <div className="reference-header">
        <h1>{getTitle(type)}</h1>
        <p className="reference-subtitle">{getSubtitle(type, data)}</p>
      </div>

      <div className="reference-filter">
        <input
          type="text"
          placeholder={getFilterPlaceholder(type)}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="filter-input"
        />
        {filter && (
          <button className="filter-clear" onClick={() => setFilter('')}>
            ×
          </button>
        )}
      </div>

      {type === 'tools' && <ToolsList tools={data.tools} filter={filter} />}
      {type === 'torque' && <TorqueList values={data.values} filter={filter} />}
      {type === 'pictograms' && <PictogramsList pictograms={data.pictograms} filter={filter} />}
      {type === 'glossary' && <GlossaryList terms={data.terms} filter={filter} />}
    </div>
  )
}

function getTitle(type) {
  const titles = {
    tools: 'Special Service Tools',
    torque: 'Torque Specifications',
    pictograms: 'Pictograms Reference',
    glossary: 'Technical Glossary'
  }
  return titles[type] || 'Reference'
}

function getSubtitle(type, data) {
  if (type === 'tools') return `${data.tools?.length || 0} tools found`
  if (type === 'torque') return `${data.values?.length || 0} torque specifications`
  if (type === 'pictograms') return `${data.pictograms?.length || 0} pictograms`
  if (type === 'glossary') return `${data.terms?.length || 0} terms`
  return ''
}

function getFilterPlaceholder(type) {
  const placeholders = {
    tools: 'Search tools by code or name...',
    torque: 'Search by component...',
    pictograms: 'Search pictograms...',
    glossary: 'Search terms...'
  }
  return placeholders[type] || 'Search...'
}

/**
 * Tools list component
 */
function ToolsList({ tools, filter }) {
  const filtered = tools.filter(tool => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      tool.code.toLowerCase().includes(q) ||
      (tool.name && tool.name.toLowerCase().includes(q)) ||
      (tool.description && tool.description.toLowerCase().includes(q))
    )
  })

  // Group by first letter of code
  const grouped = filtered.reduce((acc, tool) => {
    const group = tool.code.charAt(0)
    if (!acc[group]) acc[group] = []
    acc[group].push(tool)
    return acc
  }, {})

  return (
    <div className="tools-list">
      {Object.keys(grouped).sort().map(group => (
        <div key={group} className="tool-group">
          <h3 className="group-header">{group}</h3>
          <div className="group-items">
            {grouped[group].map((tool, i) => (
              <div key={i} className="tool-card">
                <div className="tool-header">
                  <span className="tool-code">{tool.code}</span>
                  {tool.name && <span className="tool-name">{tool.name}</span>}
                </div>
                {tool.description && (
                  <p className="tool-description">{tool.description}</p>
                )}
                {tool.usedIn && tool.usedIn.length > 0 && (
                  <div className="tool-usage">
                    <span className="usage-label">Used in:</span>
                    <div className="usage-links">
                      {tool.usedIn.slice(0, 5).map((docId, j) => (
                        <Link key={j} to={`/doc/${docId}`} className="usage-link">
                          {docId.split('-').slice(0, 3).join(' ')}
                        </Link>
                      ))}
                      {tool.usedIn.length > 5 && (
                        <span className="usage-more">+{tool.usedIn.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="no-results">No tools found matching "{filter}"</div>
      )}
    </div>
  )
}

/**
 * Torque values list component
 */
function TorqueList({ values, filter }) {
  const filtered = values.filter(tv => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return tv.component.toLowerCase().includes(q)
  })

  // Group by source page group (A-R)
  const grouped = filtered.reduce((acc, tv) => {
    const group = tv.group || 'Other'
    if (!acc[group]) acc[group] = []
    acc[group].push(tv)
    return acc
  }, {})

  const groupLabels = {
    A: 'A - Maintenance & Body',
    B: 'B - Paint',
    C: 'C - Body Equipment',
    D: 'D - HVAC',
    E: 'E - Front Suspension',
    F: 'F - Rear Axle',
    H: 'H - Brakes',
    J: 'J - Engine',
    K: 'K - Clutch & Transmission',
    L: 'L - Fuel & Exhaust',
    M: 'M - Steering',
    N: 'N - Electrical',
    R: 'R - Accessories',
    Other: 'Other'
  }

  return (
    <div className="torque-list">
      {Object.keys(grouped).sort().map(group => (
        <div key={group} className="torque-group">
          <h3 className="group-header">{groupLabels[group] || group}</h3>
          <table className="torque-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Torque</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {grouped[group].map((tv, i) => (
                <tr key={i}>
                  <td className="component-cell">{tv.component}</td>
                  <td className="torque-cell">{tv.value} {tv.unit}</td>
                  <td className="source-cell">
                    {tv.sourcePage && (
                      <Link to={`/doc/${tv.sourcePage}`} className="source-link">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="no-results">No torque values found matching "{filter}"</div>
      )}
    </div>
  )
}

/**
 * Pictograms list component
 */
function PictogramsList({ pictograms, filter }) {
  const filtered = pictograms.filter(p => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      p.label.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q))
    )
  })

  return (
    <div className="pictograms-list">
      <div className="pictograms-grid">
        {filtered.map((picto, i) => (
          <div key={i} className="pictogram-card">
            {picto.icon && (
              <img src={picto.icon} alt={picto.label} className="pictogram-icon" />
            )}
            <div className="pictogram-info">
              <h4 className="pictogram-label">{picto.label}</h4>
              {picto.description && (
                <p className="pictogram-description">{picto.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="no-results">No pictograms found matching "{filter}"</div>
      )}
    </div>
  )
}

/**
 * Glossary list component
 */
function GlossaryList({ terms, filter }) {
  const filtered = terms.filter(term => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      term.term.toLowerCase().includes(q) ||
      (term.description && term.description.toLowerCase().includes(q))
    )
  })

  // Group alphabetically
  const grouped = filtered.reduce((acc, term) => {
    const group = term.term.charAt(0).toUpperCase()
    if (!acc[group]) acc[group] = []
    acc[group].push(term)
    return acc
  }, {})

  return (
    <div className="glossary-list">
      <div className="alphabet-nav">
        {Object.keys(grouped).sort().map(letter => (
          <a key={letter} href={`#letter-${letter}`} className="alphabet-link">
            {letter}
          </a>
        ))}
      </div>
      
      {Object.keys(grouped).sort().map(letter => (
        <div key={letter} id={`letter-${letter}`} className="glossary-group">
          <h3 className="group-header">{letter}</h3>
          <div className="glossary-items">
            {grouped[letter].map((term, i) => (
              <div key={i} className="glossary-item">
                <dt className="glossary-term">{term.term}</dt>
                <dd className="glossary-definition">{term.description}</dd>
              </div>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="no-results">No terms found matching "{filter}"</div>
      )}
    </div>
  )
}

export default ReferenceIndex
