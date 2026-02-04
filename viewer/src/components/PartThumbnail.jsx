import { useState, useEffect, useRef, memo } from 'react'

// Cache for loaded images to avoid reloading the same diagram multiple times
const imageCache = new Map()

function loadImage(src) {
  if (imageCache.has(src)) {
    return imageCache.get(src)
  }
  
  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
  
  imageCache.set(src, promise)
  return promise
}

/**
 * Calculate bounding box from polygon points
 */
function getPolygonBounds(points) {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

/**
 * PartThumbnail - Crops a portion of a diagram image based on hotspot data
 * 
 * @param {string} diagramSrc - Path to the diagram image
 * @param {object} hotspot - Hotspot data with type, bbox (for rect) or points (for polygon)
 * @param {number} size - Target size for the thumbnail (default 40)
 * @param {number} padding - Padding around the hotspot in source pixels (default 10)
 */
function PartThumbnail({ diagramSrc, hotspot, size = 40, padding = 10 }) {
  const canvasRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!diagramSrc || !hotspot) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    
    loadImage(diagramSrc)
      .then(img => {
        // Calculate bounds based on hotspot type
        let bounds
        if (hotspot.type === 'polygon' && hotspot.points) {
          bounds = getPolygonBounds(hotspot.points)
        } else if (hotspot.bbox) {
          bounds = hotspot.bbox
        } else {
          setError(true)
          return
        }

        // Add padding
        const srcX = Math.max(0, bounds.x - padding)
        const srcY = Math.max(0, bounds.y - padding)
        const srcW = Math.min(bounds.width + padding * 2, img.width - srcX)
        const srcH = Math.min(bounds.height + padding * 2, img.height - srcY)

        // Calculate scale to fit in target size while maintaining aspect ratio
        const scale = Math.min(size / srcW, size / srcH)
        const destW = Math.round(srcW * scale)
        const destH = Math.round(srcH * scale)

        // Set canvas size
        canvas.width = destW
        canvas.height = destH

        // Clear canvas
        ctx.clearRect(0, 0, destW, destH)

        if (hotspot.type === 'polygon' && hotspot.points) {
          // For polygons: use clip path to mask
          ctx.save()
          
          // Translate points to canvas coordinate system
          ctx.beginPath()
          hotspot.points.forEach((point, i) => {
            const x = (point.x - srcX) * scale
            const y = (point.y - srcY) * scale
            if (i === 0) {
              ctx.moveTo(x, y)
            } else {
              ctx.lineTo(x, y)
            }
          })
          ctx.closePath()
          ctx.clip()

          // Draw the image clipped to polygon
          ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, destW, destH)
          
          ctx.restore()
        } else {
          // For rectangles: simple crop
          ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, destW, destH)
        }

        setLoaded(true)
      })
      .catch(() => {
        setError(true)
      })
  }, [diagramSrc, hotspot, size, padding])

  if (error || !hotspot) {
    return <div className="part-thumbnail part-thumbnail-empty" style={{ width: size, height: size }} />
  }

  return (
    <canvas
      ref={canvasRef}
      className={`part-thumbnail ${loaded ? 'loaded' : 'loading'}`}
      style={{ 
        maxWidth: size, 
        maxHeight: size,
        opacity: loaded ? 1 : 0
      }}
    />
  )
}

export default memo(PartThumbnail)
