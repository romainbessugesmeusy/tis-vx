import { useState, useEffect } from 'react'

export function useManifest() {
  const [manifest, setManifest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/data/manifest.json')
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to load manifest')
        }
        return res.json()
      })
      .then(data => {
        setManifest(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { manifest, loading, error }
}

export default useManifest
