import { useState } from 'react'

/**
 * Renders a structured procedure with phases, steps, and images.
 */
function ProcedureViewer({ data }) {
  const [expandedImages, setExpandedImages] = useState({})

  const toggleImage = (stepKey) => {
    setExpandedImages(prev => ({
      ...prev,
      [stepKey]: !prev[stepKey]
    }))
  }

  if (!data || !data.phases) {
    return <div className="procedure-error">Invalid procedure data</div>
  }

  return (
    <article className="procedure">
      <h1 className="procedure-title">{data.title}</h1>
      
      {/* Warnings at top */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="procedure-warnings">
          {data.warnings.map((warning, i) => (
            <div key={i} className="warning-box">
              <span className="warning-icon">⚠️</span>
              <span className="warning-text">{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tools required */}
      {data.toolsRequired && data.toolsRequired.length > 0 && (
        <div className="procedure-tools">
          <h3>Tools Required</h3>
          <div className="tool-list">
            {data.toolsRequired.map((tool, i) => (
              <span key={i} className="tool-badge">{tool}</span>
            ))}
          </div>
        </div>
      )}

      {/* Phases - hide empty phases */}
      {data.phases
        .filter(phase => phase.steps && phase.steps.length > 0)
        .map((phase, phaseIdx) => (
        <PhaseSection 
          key={phaseIdx} 
          phase={phase} 
          phaseIdx={phaseIdx}
          expandedImages={expandedImages}
          toggleImage={toggleImage}
        />
      ))}

      {/* Torque values summary */}
      {data.torqueValues && data.torqueValues.length > 0 && (
        <div className="procedure-torque-summary">
          <h3>Torque Specifications</h3>
          <table className="torque-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Component</th>
                <th>Torque</th>
              </tr>
            </thead>
            <tbody>
              {data.torqueValues.map((tv, i) => (
                <tr key={i}>
                  <td>{tv.stepRef || '-'}</td>
                  <td>{tv.component}</td>
                  <td className="torque-value">{tv.value} {tv.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes at bottom */}
      {data.notes && data.notes.length > 0 && (
        <div className="procedure-notes">
          <h3>Notes</h3>
          {data.notes.map((note, i) => (
            <div key={i} className="note-box">
              <span className="note-icon">📝</span>
              <span className="note-text">{note}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * Renders a single phase (Remove, Install, etc.) with its steps.
 */
function PhaseSection({ phase, phaseIdx, expandedImages, toggleImage }) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <section className="phase-section">
      <button 
        className={`phase-header ${isExpanded ? 'expanded' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {phase.icon && (
          <img src={phase.icon} alt="" className="phase-icon" />
        )}
        <span className="phase-label">{phase.label || phase.phase}</span>
        <span className="phase-count">{phase.steps.length} steps</span>
        <span className="phase-toggle">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="phase-steps">
          {phase.steps.map((step, stepIdx) => (
            <StepItem 
              key={stepIdx}
              step={step}
              stepKey={`${phaseIdx}-${stepIdx}`}
              isExpanded={expandedImages[`${phaseIdx}-${stepIdx}`]}
              toggleImage={toggleImage}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Renders a single step with substeps and image.
 */
function StepItem({ step, stepKey, isExpanded, toggleImage }) {
  // Parse callouts from text
  const renderTextWithCallouts = (text) => {
    if (!text) return null
    
    // Replace (1), (2), etc. with styled callout badges
    const parts = text.split(/(\(\d+\))/g)
    return parts.map((part, i) => {
      const match = part.match(/^\((\d+)\)$/)
      if (match) {
        return <span key={i} className="callout-badge">{match[1]}</span>
      }
      return part
    })
  }

  return (
    <div className={`step-item ${step.image ? 'has-image' : ''}`}>
      <div className="step-content">
        <div className="step-main">
          <span className="step-number">{step.number}</span>
          <div className="step-text">
            <p>{renderTextWithCallouts(step.text)}</p>
            
            {/* Substeps */}
            {step.substeps && step.substeps.length > 0 && (
              <ul className="substep-list">
                {step.substeps.map((substep, i) => (
                  <li key={i} className="substep-item">
                    <span className="substep-bullet">{substep.bullet}</span>
                    <span className="substep-text">{renderTextWithCallouts(substep.text)}</span>
                    
                    {/* Sub-substeps (dash items) */}
                    {substep.substeps && substep.substeps.length > 0 && (
                      <ul className="subsubstep-list">
                        {substep.substeps.map((ss, j) => (
                          <li key={j} className="subsubstep-item">
                            <span className="subsubstep-bullet">{ss.bullet}</span>
                            <span className="subsubstep-text">{ss.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Step image - always visible */}
        {step.image && (
          <div className="step-image-container">
            <img 
              src={step.image.src} 
              alt={step.image.alt || `Step ${step.number}`}
              className="step-image"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default ProcedureViewer
