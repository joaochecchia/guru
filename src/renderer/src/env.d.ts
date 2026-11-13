import type { GuruApi } from '../../shared/types'

declare global {
  interface Window {
    guru: GuruApi
  }
}
