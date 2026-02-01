import { useState, useRef, useEffect } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

/**
 * MapViewer - Google Maps style image viewer with zoom, pan, and controls.
 * 
 * Features:
 * - Scroll wheel zoom
 * - Pinch to zoom (touch)
 * - Click and drag to pan
 * - Double-click to zoom in
 * - Keyboard shortcuts (+/- for zoom, arrow keys for pan)
 * - Control buttons (zoom in, zoom out, reset, fit)
 * - Minimap showing current viewport position
 */

// Control buttons component (needs to be inside TransformWrapper context)
function Controls({ onFitToView }) {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  
  return (
    <div className="map-controls">
      <button 
        className="map-control-btn" 
        onClick={() => zoomIn(0.5)}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button 
        className="map-control-btn" 
        onClick={() => zoomOut(0.5)}
        title="Zoom out (-)"
        aria-label="Zoom out"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <div className="map-control-divider" />
      <button 
        className="map-control-btn" 
        onClick={() => resetTransform()}
        title="Reset view (0)"
        aria-label="Reset view"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
      <button 
        className="map-control-btn" 
        onClick={onFitToView}
        title="Fit to view (F)"
        aria-label="Fit to view"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
    </div>
  )
}

// Minimap component showing viewport position
function Minimap({ src, scale, positionX, positionY, containerRef, imageRef }) {
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const minimapSize = 120
  
  useEffect(() => {
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight
      })
    }
  }, [src, imageRef])
  
  if (!imageDimensions.width || !containerRef.current) return null
  
  const containerRect = containerRef.current.getBoundingClientRect()
  const aspectRatio = imageDimensions.width / imageDimensions.height
  
  const minimapWidth = aspectRatio > 1 ? minimapSize : minimapSize * aspectRatio
  const minimapHeight = aspectRatio > 1 ? minimapSize / aspectRatio : minimapSize
  
  // Calculate viewport rectangle on the minimap
  const scaleRatio = minimapWidth / imageDimensions.width
  const viewportWidth = (containerRect.width / scale) * scaleRatio
  const viewportHeight = (containerRect.height / scale) * scaleRatio
  const viewportX = (-positionX / scale) * scaleRatio
  const viewportY = (-positionY / scale) * scaleRatio
  
  return (
    <div 
      className="map-minimap" 
      style={{ width: minimapWidth, height: minimapHeight }}
    >
      <img src={src} alt="Minimap" className="minimap-image" />
      <div 
        className="minimap-viewport"
        style={{
          width: Math.min(viewportWidth, minimapWidth),
          height: Math.min(viewportHeight, minimapHeight),
          left: Math.max(0, Math.min(viewportX, minimapWidth - viewportWidth)),
          top: Math.max(0, Math.min(viewportY, minimapHeight - viewportHeight))
        }}
      />
    </div>
  )
}

// Zoom level indicator
function ZoomIndicator({ scale }) {
  const percentage = Math.round(scale * 100)
  return (
    <div className="map-zoom-indicator">
      {percentage}%
    </div>
  )
}

function MapViewer({ src, alt, onError }) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const containerRef = useRef(null)
  const imageRef = useRef(null)
  const transformRef = useRef(null)
  
  // Handle transform changes
  const handleTransform = (ref, state) => {
    setScale(state.scale)
    setPosition({ x: state.positionX, y: state.positionY })
  }
  
  // Fit image to container
  const handleFitToView = () => {
    if (transformRef.current && imageRef.current && containerRef.current) {
      const container = containerRef.current.getBoundingClientRect()
      const imageWidth = imageRef.current.naturalWidth
      const imageHeight = imageRef.current.naturalHeight
      
      const scaleX = container.width / imageWidth
      const scaleY = container.height / imageHeight
      const newScale = Math.min(scaleX, scaleY, 1) * 0.95 // 95% to add some padding
      
      // Calculate centered position
      const scaledWidth = imageWidth * newScale
      const scaledHeight = imageHeight * newScale
      const x = (container.width - scaledWidth) / 2
      const y = (container.height - scaledHeight) / 2
      
      transformRef.current.setTransform(x, y, newScale, 300, 'easeOut')
    }
  }
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!transformRef.current) return
      
      // Don't handle if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault()
          transformRef.current.zoomIn(0.5)
          break
        case '-':
        case '_':
          e.preventDefault()
          transformRef.current.zoomOut(0.5)
          break
        case '0':
          e.preventDefault()
          transformRef.current.resetTransform()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          handleFitToView()
          break
        case 'ArrowUp':
          e.preventDefault()
          transformRef.current.setTransform(
            position.x,
            position.y + 50,
            scale
          )
          break
        case 'ArrowDown':
          e.preventDefault()
          transformRef.current.setTransform(
            position.x,
            position.y - 50,
            scale
          )
          break
        case 'ArrowLeft':
          e.preventDefault()
          transformRef.current.setTransform(
            position.x + 50,
            position.y,
            scale
          )
          break
        case 'ArrowRight':
          e.preventDefault()
          transformRef.current.setTransform(
            position.x - 50,
            position.y,
            scale
          )
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [scale, position])
  
  // Handle image load
  const handleImageLoad = () => {
    setImageLoaded(true)
    setImageError(false)
    // Auto-fit on initial load - wait for layout to settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        handleFitToView()
      })
    })
  }
  
  // Handle image error
  const handleImageError = () => {
    setImageError(true)
    setImageLoaded(false)
    if (onError) onError()
  }
  
  if (imageError) {
    return (
      <div className="map-viewer-error">
        <div className="map-viewer-error-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <p>Failed to load image</p>
        <p className="map-viewer-error-src">{src}</p>
      </div>
    )
  }
  
  return (
    <div className="map-viewer" ref={containerRef} tabIndex={0}>
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={10}
        centerOnInit={true}
        limitToBounds={false}
        wheel={{ step: 0.1 }}
        doubleClick={{ mode: 'zoomIn', step: 0.7 }}
        panning={{ velocityDisabled: false }}
        onTransformed={handleTransform}
      >
        {() => (
          <>
            <Controls onFitToView={handleFitToView} />
            <ZoomIndicator scale={scale} />
            {imageLoaded && (
              <Minimap 
                src={src}
                scale={scale}
                positionX={position.x}
                positionY={position.y}
                containerRef={containerRef}
                imageRef={imageRef}
              />
            )}
            <TransformComponent
              wrapperStyle={{
                width: '100%',
                height: '100%',
                overflow: 'hidden'
              }}
              contentStyle={{
                cursor: 'grab'
              }}
            >
              <img
                ref={imageRef}
                src={src}
                alt={alt || 'Diagram'}
                className="map-viewer-image"
                onLoad={handleImageLoad}
                onError={handleImageError}
                draggable={false}
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
      
      {!imageLoaded && !imageError && (
        <div className="map-viewer-loading">
          <div className="map-viewer-spinner" />
          <p>Loading diagram...</p>
        </div>
      )}
      
      <div className="map-viewer-help">
        Scroll to zoom | Drag to pan | Double-click to zoom in
      </div>
    </div>
  )
}

export default MapViewer
