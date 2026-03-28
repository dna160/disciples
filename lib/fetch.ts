/**
 * Enhanced fetch wrapper with retry logic, error handling, and logging.
 */

interface FetchOptions extends RequestInit {
  timeout?: number
  retries?: number
  retryDelay?: number
}

interface FetchResponse<T> {
  data: T
  status: number
  headers: Headers
}

class FetchError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
    message: string
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

/**
 * Enhanced fetch with timeout, retries, and error handling.
 */
async function enhancedFetch<T>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResponse<T>> {
  const {
    timeout = 30_000,
    retries = 3,
    retryDelay = 1_000,
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const body = await response.text()
        throw new FetchError(
          response.status,
          response.statusText,
          body,
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const data = await response.json() as T

      return {
        data,
        status: response.status,
        headers: response.headers,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on 4xx errors (client errors)
      if (error instanceof FetchError && error.status >= 400 && error.status < 500) {
        throw error
      }

      // Retry on network errors or 5xx
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
        continue
      }

      throw lastError
    }
  }

  throw lastError || new Error('Unknown fetch error')
}

/**
 * Create a fetch client with a base URL and default headers.
 */
export function createFetchClient(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
  return {
    get: async <T,>(path: string, options?: FetchOptions) => {
      const response = await enhancedFetch<T>(`${baseUrl}${path}`, {
        ...options,
        method: 'GET',
        headers: defaultHeaders,
      })
      return response.data
    },

    post: async <T,>(path: string, body?: any, options?: FetchOptions) => {
      const response = await enhancedFetch<T>(`${baseUrl}${path}`, {
        ...options,
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
        headers: defaultHeaders,
      })
      return response.data
    },

    put: async <T,>(path: string, body?: any, options?: FetchOptions) => {
      const response = await enhancedFetch<T>(`${baseUrl}${path}`, {
        ...options,
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
        headers: defaultHeaders,
      })
      return response.data
    },

    delete: async <T,>(path: string, options?: FetchOptions) => {
      const response = await enhancedFetch<T>(`${baseUrl}${path}`, {
        ...options,
        method: 'DELETE',
        headers: defaultHeaders,
      })
      return response.data
    },
  }
}

export { FetchError, enhancedFetch }
export type { FetchOptions, FetchResponse }
