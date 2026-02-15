import { useState, useEffect } from 'react'

const DATA_CACHE_NAME = 'tis-data'
const STORAGE_KEY = 'tis-offline-downloads'

export function useOnline() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

export function useOffline() {
  const isOnline = useOnline()
  return { isOnline, isOffline: !isOnline }
}

export function getDataCacheName() {
  return DATA_CACHE_NAME
}

export async function openDataCache() {
  if (!('caches' in window)) return null
  return caches.open(DATA_CACHE_NAME)
}

export function getStoredSectionUrls() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function setStoredSectionUrls(sectionKey, urls) {
  try {
    const prev = getStoredSectionUrls()
    const next = { ...prev, [sectionKey]: urls }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e) {
    console.warn('Failed to store section URLs:', e)
  }
}

export function clearStoredSection(sectionKey) {
  try {
    const prev = getStoredSectionUrls()
    const { [sectionKey]: _, ...rest } = prev
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
  } catch (e) {
    console.warn('Failed to clear section URLs:', e)
  }
}

export async function addToCache(urls, onProgress) {
  if (!urls.length) return
  const cache = await openDataCache()
  if (!cache) return

  const base = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''
  const total = urls.length

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].startsWith('http') ? urls[i] : base + urls[i]
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (res.ok) {
        await cache.put(url, res)
      }
    } catch (e) {
      console.warn('Failed to cache:', url, e)
    }
    if (onProgress) onProgress(i + 1, total, url)
  }
}

export async function removeUrlsFromCache(urls) {
  if (!urls.length) return
  const cache = await openDataCache()
  if (!cache) return

  const base = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''

  for (const u of urls) {
    const url = u.startsWith('http') ? u : base + u
    try {
      await cache.delete(url)
    } catch (e) {
      console.warn('Failed to delete from cache:', url, e)
    }
  }
}

export async function removeCachedSection(sectionKey) {
  const stored = getStoredSectionUrls()
  const urls = stored[sectionKey]
  if (urls && urls.length) {
    await removeUrlsFromCache(urls)
  }
  clearStoredSection(sectionKey)
}

export async function getStorageEstimate() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate()
    return {
      usage: est.usage ?? 0,
      quota: est.quota ?? 0,
    }
  }
  return { usage: 0, quota: 0 }
}

export async function requestPersistentStorage() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    return navigator.storage.persist()
  }
  return false
}
