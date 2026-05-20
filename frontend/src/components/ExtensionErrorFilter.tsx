'use client'

import { useEffect } from 'react'

export default function ExtensionErrorFilter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.filename?.startsWith('chrome-extension://') ||
          event.filename?.startsWith('moz-extension://') ||
          event.message?.includes('MetaMask') ||
          event.message?.includes('Failed to connect to MetaMask')) {
        event.stopImmediatePropagation()
        event.preventDefault()
        return true
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message ?? String(event.reason ?? '')
      if (msg.includes('MetaMask') || msg.includes('chrome-extension')) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }

    window.addEventListener('error', handleError, true)
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)

    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
    }
  }, [])

  return null
}
