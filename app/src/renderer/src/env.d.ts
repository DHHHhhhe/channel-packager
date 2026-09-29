/// <reference types="vite/client" />

import type { RendererApi } from '@shared/types/api'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
