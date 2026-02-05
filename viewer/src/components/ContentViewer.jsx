import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ProcedureViewer from './ProcedureViewer'
import MapViewer from './MapViewer'

/**
 * Donation callout with PayPal button
 */
function DonationCallout() {
  const buttonId = 'paypal-donate-button'
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [buttonRendered, setButtonRendered] = useState(false)

  useEffect(() => {
    // Check if script is already loaded
    if (window.PayPal?.Donation?.Button) {
      setScriptLoaded(true)
      return
    }

    // Load PayPal donate SDK
    const script = document.createElement('script')
    script.src = 'https://www.paypalobjects.com/donate/sdk/donate-sdk.js'
    script.charset = 'UTF-8'
    script.async = true
    script.onload = () => setScriptLoaded(true)
    document.body.appendChild(script)
  }, [])

  useEffect(() => {
    if (scriptLoaded && !buttonRendered && window.PayPal?.Donation?.Button) {
      const container = document.getElementById(buttonId)
      if (container && container.childNodes.length === 0) {
        try {
          // Render PayPal donation button using CSS selector
          window.PayPal.Donation.Button({
            env: 'production',
            hosted_button_id: 'T6VVWUV2NPHAQ',
            image: {
              src: 'https://www.paypalobjects.com/en_GB/i/btn/btn_donate_LG.gif',
              alt: 'Donate with PayPal button',
              title: 'PayPal - The safer, easier way to pay online!',
            }
          }).render(`#${buttonId}`)
          setButtonRendered(true)
        } catch (e) {
          console.warn('PayPal button render error:', e)
        }
      }
    }
  }, [scriptLoaded, buttonRendered])

  return (
    <div className="donation-callout">
      <div className="donation-content">
        <p>
          This app is for my personal use, but if you find it useful and would like me to improve it over time, 
          you can help by donating a few quid.
        </p>
        <div id={buttonId} className="donation-button"></div>
      </div>
    </div>
  )
}

// Group folder titles that should NOT be shown as sub-components
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
  'Circuit Diagram',
  'Warnings, Disclaimers, Safety',
  'Diagnostic Information and Procedures',
]

// Icon mapping for root components (using emojis)
const COMPONENT_ICONS = {
  'A  Maintenance, Body and Chassis Sheet Metal Parts, Frame': '🔧',
  'B  Paint': '🎨',
  'C  Body Equipment': '🚗',
  'D  Heating, Ventilation, Air Conditioning (HVAC)': '❄️',
  'E  Front Wheel Suspension, Wheels and Tyres': '🛞',
  'F  Rear Axle and Rear Wheel Suspension': '⚙️',
  'H  Brakes': '🛑',
  'J  Engine and Engine Aggregates': '🔩',
  'K  Clutch and Transmission': '⚡',
  'L  Fuel and Exhaust System': '⛽',
  'M  Steering': '🎯',
  'N  Electrical Equipment and Instruments': '💡',
  'R  Accessories': '🔌',
}

// Short display names for components
const COMPONENT_SHORT_NAMES = {
  'A  Maintenance, Body and Chassis Sheet Metal Parts, Frame': 'Maintenance & Body',
  'B  Paint': 'Paint',
  'C  Body Equipment': 'Body Equipment',
  'D  Heating, Ventilation, Air Conditioning (HVAC)': 'HVAC',
  'E  Front Wheel Suspension, Wheels and Tyres': 'Front Suspension',
  'F  Rear Axle and Rear Wheel Suspension': 'Rear Suspension',
  'H  Brakes': 'Brakes',
  'J  Engine and Engine Aggregates': 'Engine',
  'K  Clutch and Transmission': 'Clutch & Transmission',
  'L  Fuel and Exhaust System': 'Fuel & Exhaust',
  'M  Steering': 'Steering',
  'N  Electrical Equipment and Instruments': 'Electrical',
  'R  Accessories': 'Accessories',
}

/**
 * Component grid for the homepage showing all root-level car components
 */
function ComponentGrid({ manifest, onNavigateToComponent }) {
  const navigate = useNavigate()
  
  if (!manifest?.tree?.roots || !manifest?.tree?.nodes) {
    return null
  }

  const { roots, nodes } = manifest.tree

  // Filter out "General Vehicle Information" - only show car components (those starting with a letter)
  const carComponentRoots = roots.filter(rootId => {
    const node = nodes[rootId]
    return node && node.title !== 'General Vehicle Information'
  })

  // Check if a node is a group folder
  const isGroupFolder = (node) => {
    if (!node || !node.title) return false
    return GROUP_FOLDER_TITLES.includes(node.title)
  }

  // Get display name for a node (strip letter prefix if present)
  const getDisplayName = (title) => {
    return COMPONENT_SHORT_NAMES[title] || title.replace(/^[A-Z]\s+/, '')
  }

  // Get non-group child nodes for a root node (actual sub-components)
  const getSubComponents = (nodeId, maxCount = 5) => {
    const node = nodes[nodeId]
    if (!node?.children) return []
    
    const subComponents = []
    for (const childId of node.children) {
      const child = nodes[childId]
      if (child && !isGroupFolder(child)) {
        subComponents.push({ id: childId, title: child.title })
      }
      if (subComponents.length >= maxCount) break
    }
    return subComponents
  }

  // Count total non-group children
  const countSubComponents = (nodeId) => {
    const node = nodes[nodeId]
    if (!node?.children) return 0
    return node.children.filter(childId => {
      const child = nodes[childId]
      return child && !isGroupFolder(child)
    }).length
  }

  // Handle click on component card header
  const handleComponentClick = (rootId) => {
    if (onNavigateToComponent) {
      onNavigateToComponent([rootId])
    }
  }

  // Handle click on a sub-component
  const handleSubComponentClick = (rootId, subComponentId) => {
    if (onNavigateToComponent) {
      onNavigateToComponent([rootId, subComponentId])
    }
  }

  return (
    <div className="component-grid">
      <h3>Components</h3>
      <div className="component-cards">
        {carComponentRoots.map(rootId => {
          const node = nodes[rootId]
          if (!node) return null
          
          const icon = COMPONENT_ICONS[node.title] || '📋'
          const displayName = getDisplayName(node.title)
          const subComponents = getSubComponents(rootId, 5)
          const totalSubComponents = countSubComponents(rootId)
          const hasMore = totalSubComponents > 5

          return (
            <div key={rootId} className="component-card">
              <button 
                className="component-card-header"
                onClick={() => handleComponentClick(rootId)}
              >
                <span className="component-icon">{icon}</span>
                <span className="component-name">{displayName}</span>
              </button>
              {subComponents.length > 0 && (
                <ul className="component-sublist">
                  {subComponents.map(({ id, title }) => (
                    <li key={id}>
                      <button 
                        className="component-subitem"
                        onClick={() => handleSubComponentClick(rootId, id)}
                      >
                        {title}
                      </button>
                    </li>
                  ))}
                  {hasMore && <li className="more-items">+ {totalSubComponents - 5} more...</li>}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Content viewer that loads and displays documents.
 * Automatically selects the appropriate viewer based on content type.
 */
function ContentViewer({ manifest, onNavigateToComponent }) {
  const { id } = useParams()
  const [content, setContent] = useState(null)
  const [contentType, setContentType] = useState(null)
  const [htmlFallback, setHtmlFallback] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) {
      setContent(null)
      setContentType(null)
      setHtmlFallback(null)
      return
    }

    setLoading(true)
    setError(null)

    // Try to load JSON first (structured content)
    fetch(`/data/content/${id}.json`)
      .then(res => {
        if (!res.ok) throw new Error('JSON not found')
        return res.json()
      })
      .then(data => {
        setContent(data)
        setContentType(data.type)
        
        // For generic type, also load HTML fallback
        if (data.type === 'generic') {
          return fetch(`/data/content/${id}.html`)
            .then(res => res.ok ? res.text() : null)
            .then(html => setHtmlFallback(html))
        }
      })
      .catch(() => {
        // Fallback to HTML only
        return fetch(`/data/content/${id}.html`)
          .then(res => {
            if (!res.ok) throw new Error(`Document not found: ${id}`)
            return res.text()
          })
          .then(html => {
            setContent(null)
            setContentType('html')
            setHtmlFallback(html)
          })
      })
      .catch(err => {
        setError(err.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [id])

  if (!id) {
    const vehicleLabel = manifest?.vehicle 
      ? `${manifest.vehicle.model} • ${manifest.vehicle.year} • ${manifest.vehicle.engine}`
      : 'VX220 / Speedster'
    
    return (
      <div className="content-welcome">
        <div className="welcome-hero">
          <div className="welcome-hero-content">
            <div className="car-badge">
              <span className="car-badge-icon">🏎️</span>
              <span>{vehicleLabel}</span>
            </div>
            <h2>VX220 Service Manual</h2>
            <p>Complete workshop documentation for your Vauxhall VX220 / Opel Speedster. Browse repair procedures, wiring diagrams, torque specs and more.</p>
          </div>
        </div>
        
        <div className="welcome-links">
          <h3>Quick Access</h3>
          <div className="quick-links">
            <a href="/ref/tools" className="quick-link">
              <span className="quick-icon">🔧</span>
              <span>Service Tools</span>
            </a>
            <a href="/ref/torque" className="quick-link">
              <span className="quick-icon">🔩</span>
              <span>Torque Specs</span>
            </a>
            <a href="/ref/pictograms" className="quick-link">
              <span className="quick-icon">📋</span>
              <span>Pictograms</span>
            </a>
            <a href="/ref/glossary" className="quick-link">
              <span className="quick-icon">📖</span>
              <span>Glossary</span>
            </a>
          </div>
        </div>
        
        <ComponentGrid manifest={manifest} onNavigateToComponent={onNavigateToComponent} />
        
        <DonationCallout />
      </div>
    )
  }

  if (loading) {
    return <div className="content-loading">Loading...</div>
  }

  if (error) {
    return <div className="content-error">{error}</div>
  }

  // Render based on content type
  return (
    <article className="content-article">
      {contentType === 'procedure' && content && (
        <ProcedureViewer data={content} />
      )}
      
      {contentType === 'tsb' && content && (
        <TsbViewer data={content} />
      )}
      
      {contentType === 'harness_diagram' && content && (
        <DiagramViewer data={content} />
      )}
      
      {contentType === 'torque_table' && content && (
        <TorqueTableViewer data={content} />
      )}
      
      {contentType === 'tool_list' && content && (
        <ToolListViewer data={content} />
      )}
      
      {contentType === 'diagnostic' && content && (
        <DiagnosticViewer data={content} />
      )}
      
      {contentType === 'glossary' && content && (
        <GlossaryViewer data={content} />
      )}
      
      {(contentType === 'generic' || contentType === 'html') && htmlFallback && (
        <div className="content-body" dangerouslySetInnerHTML={{ __html: htmlFallback }} />
      )}
    </article>
  )
}

/**
 * TSB/Field Remedy viewer
 */
function TsbViewer({ data }) {
  // Render a diagnosis table with categories
  const renderDiagnosisTable = (tableData) => {
    return (
      <div className="diagnosis-table-container">
        <table className="diagnosis-table">
          <thead>
            <tr>
              <th className="diag-col-category">Symptom</th>
              <th className="diag-col-desc">Description</th>
              <th className="diag-col-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {tableData.categories.map((category, catIdx) => (
              category.rows.map((row, rowIdx) => (
                <tr key={`${catIdx}-${rowIdx}`} className={rowIdx === 0 ? 'category-first-row' : ''}>
                  {rowIdx === 0 && (
                    <td className="diag-category" rowSpan={category.rows.length}>
                      <span className="category-badge">{category.name}</span>
                    </td>
                  )}
                  <td className="diag-description">{row.description}</td>
                  <td className="diag-action">{row.action}</td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Render a single remedy content block based on its type
  const renderRemedyBlock = (block, index) => {
    switch (block.type) {
      case 'bullets':
        return (
          <ul key={index} className="remedy-bullets">
            {(block.items || block.text?.split('\n') || []).map((item, i) => {
              const cleanItem = typeof item === 'string' ? item.replace(/^\s*[•\-\*]\s*/, '').trim() : item
              return cleanItem ? <li key={i}>{cleanItem}</li> : null
            })}
          </ul>
        )
      case 'numbered':
        return (
          <ol key={index} className="remedy-numbered">
            {(block.items || block.text?.split('\n') || []).map((item, i) => {
              const cleanItem = typeof item === 'string' ? item.replace(/^\s*\d+\.\s*/, '').trim() : item
              return cleanItem ? <li key={i}>{cleanItem}</li> : null
            })}
          </ol>
        )
      case 'diagnosis_table':
        return (
          <div key={index} className="remedy-diagnosis">
            <h4>Diagnosis Guide</h4>
            {renderDiagnosisTable(block.table)}
          </div>
        )
      case 'paragraph':
        return (
          <p key={index} className="remedy-paragraph">{block.text}</p>
        )
      case 'text':
      default:
        return (
          <p key={index} className="remedy-text">{block.text}</p>
        )
    }
  }

  return (
    <div className="tsb-viewer">
      <h1 className="tsb-title">{data.title}</h1>
      
      {data.subject && (
        <div className="tsb-subject">
          <strong>Subject:</strong> {data.subject}
        </div>
      )}
      
      {data.metadata && (
        <div className="tsb-metadata">
          {data.metadata.models && (
            <div className="meta-item">
              <span className="meta-label">Models:</span>
              <span className="meta-value">{data.metadata.models}</span>
            </div>
          )}
          {data.metadata.engines && (
            <div className="meta-item">
              <span className="meta-label">Engines:</span>
              <span className="meta-value">{data.metadata.engines}</span>
            </div>
          )}
        </div>
      )}
      
      <div className="tsb-fields">
        {data.complaint && (
          <div className="tsb-field">
            <span className="field-label">Complaint</span>
            <span className="field-value">{data.complaint}</span>
          </div>
        )}
        
        {data.cause && (
          <div className="tsb-field">
            <span className="field-label">Cause</span>
            <span className="field-value">{data.cause}</span>
          </div>
        )}
        
        {data.production && (
          <div className="tsb-field">
            <span className="field-label">Production</span>
            <span className="field-value">{data.production}</span>
          </div>
        )}
      </div>
      
      {data.images && data.images.length > 0 && (
        <div className="tsb-images">
          {data.images.map((img, i) => (
            <img key={i} src={img.src} alt={img.alt} className="tsb-image" loading="lazy" />
          ))}
        </div>
      )}
      
      {data.remedyContent && data.remedyContent.length > 0 && (
        <div className="tsb-remedy">
          <h3>Remedy</h3>
          <div className="remedy-content">
            {data.remedyContent.map((block, i) => renderRemedyBlock(block, i))}
          </div>
        </div>
      )}
      
      {/* Legacy support for old remedy format */}
      {!data.remedyContent && data.remedy && data.remedy.length > 0 && (
        <div className="tsb-remedy">
          <h3>Remedy</h3>
          <ol className="remedy-steps">
            {data.remedy.map((step, i) => (
              <li key={i} className="remedy-step">
                <span className="step-text">{step.text}</span>
                {step.notes && step.notes.map((note, j) => (
                  <div key={j} className="step-note">Note: {note}</div>
                ))}
                {step.important && step.important.map((imp, j) => (
                  <div key={j} className="step-important">Important: {imp}</div>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}
      
      {data.parts && data.parts.length > 0 && (
        <div className="tsb-parts">
          <h3>Spare Parts</h3>
          <table className="parts-table">
            <thead>
              <tr>
                <th>Part Name</th>
                <th>Part No.</th>
                <th>Catalogue No.</th>
              </tr>
            </thead>
            <tbody>
              {data.parts.map((part, i) => (
                <tr key={i}>
                  <td>{part.name}</td>
                  <td>{part.partNumber}</td>
                  <td>{part.catalogueNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Harness/Wiring diagram viewer with Google Maps-style zoom/pan
 */
function DiagramViewer({ data }) {
  const [imageError, setImageError] = useState(false)
  const isCgm = data.diagram?.src?.toLowerCase().endsWith('.cgm')

  return (
    <div className="diagram-viewer">
      <h1 className="diagram-title">{data.title}</h1>
      
      {data.diagram && (
        <div className="diagram-map-container">
          {isCgm ? (
            <div className="diagram-fallback">
              <p>CGM diagram: {data.diagram.src}</p>
              <p className="diagram-note">CGM format diagrams require a specialized viewer</p>
            </div>
          ) : (
            <MapViewer
              src={data.diagram.src}
              alt={data.title}
              onError={() => setImageError(true)}
            />
          )}
        </div>
      )}
      
      {data.components && data.components.length > 0 && (
        <div className="diagram-components">
          <h3>Components</h3>
          <table className="components-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.components.map((comp, i) => (
                <tr key={i}>
                  <td className="comp-code">{comp.code}</td>
                  <td>{comp.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {data.locations && data.locations.length > 0 && (
        <div className="diagram-locations">
          <h3>Locations</h3>
          <ul>
            {data.locations.map((loc, i) => (
              <li key={i}>{loc}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Torque table viewer
 */
function TorqueTableViewer({ data }) {
  return (
    <div className="torque-viewer">
      <h1 className="torque-title">{data.title}</h1>
      
      {data.group && (
        <div className="torque-group-badge">Group {data.group}</div>
      )}
      
      {data.values && data.values.length > 0 && (
        <table className="torque-values-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Torque (Nm)</th>
            </tr>
          </thead>
          <tbody>
            {data.values.map((v, i) => (
              <tr key={i}>
                <td>{v.component}</td>
                <td className="torque-value">{v.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Tool list viewer
 */
function ToolListViewer({ data }) {
  return (
    <div className="tool-list-viewer">
      <h1 className="tool-list-title">{data.title}</h1>
      
      {data.group && (
        <div className="tool-group-badge">Group {data.group}</div>
      )}
      
      <div className="tool-items">
        {data.tools && data.tools.map((tool, i) => (
          <div key={i} className="tool-item">
            <div className="tool-code">{tool.code}</div>
            <div className="tool-name">{tool.name}</div>
            {tool.description && (
              <div className="tool-desc">{tool.description}</div>
            )}
          </div>
        ))}
      </div>
      
      {data.image && (
        <div className="tool-image-container">
          <img src={data.image.src} alt={data.title} className="tool-image" loading="lazy" />
        </div>
      )}
    </div>
  )
}

/**
 * Diagnostic/Test procedure viewer
 */
function DiagnosticViewer({ data }) {
  return (
    <div className="diagnostic-viewer">
      <h1 className="diagnostic-title">{data.title}</h1>
      
      {data.objective && (
        <div className="diagnostic-section">
          <h3>Objective</h3>
          <p>{data.objective}</p>
        </div>
      )}
      
      {data.measurement && (
        <div className="diagnostic-section">
          <h3>Measurement</h3>
          <p>{data.measurement}</p>
        </div>
      )}
      
      {data.preparation && (
        <div className="diagnostic-section">
          <h3>Preparation</h3>
          <p>{data.preparation}</p>
        </div>
      )}
      
      {data.connections && Object.keys(data.connections).length > 0 && (
        <div className="diagnostic-connections">
          <h3>Connections</h3>
          <table>
            <tbody>
              {Object.entries(data.connections).map(([key, value], i) => (
                <tr key={i}>
                  <th>{key}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {data.steps && data.steps.length > 0 && (
        <div className="diagnostic-steps">
          <h3>Procedure</h3>
          <ol>
            {data.steps.map((step, i) => (
              <li key={i}>{step.text}</li>
            ))}
          </ol>
        </div>
      )}
      
      {data.images && data.images.length > 0 && (
        <div className="diagnostic-images">
          {data.images.map((img, i) => (
            <img key={i} src={img.src} alt={img.alt} className="diagnostic-image" loading="lazy" />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Glossary viewer
 */
function GlossaryViewer({ data }) {
  return (
    <div className="glossary-viewer">
      <h1 className="glossary-title">{data.title}</h1>
      
      {data.subtype === 'pictograms' && data.items && (
        <div className="pictograms-list">
          {data.items.map((item, i) => (
            <div key={i} className="pictogram-item">
              {item.icon && <img src={item.icon} alt={item.label} className="picto-icon" />}
              <div className="picto-info">
                <strong>{item.label}</strong>
                {item.description && <p>{item.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {data.subtype === 'conversions' && data.items && (
        <table className="conversions-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Factor</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i}>
                <td>{item.from}</td>
                <td>{item.to}</td>
                <td>{item.factor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {data.subtype === 'terms' && data.items && (
        <dl className="terms-list">
          {data.items.map((item, i) => (
            <div key={i} className="term-item">
              <dt>{item.term}</dt>
              <dd>{item.description}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export default ContentViewer
