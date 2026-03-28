/**
 * Centralized error handling and HTTP response formatting.
 * Ensures consistent error responses across all API endpoints.
 */

import { NextResponse } from 'next/server'
import { ErrorResponse, ValidationError } from './api-types'

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

export class AppError extends Error {
  constructor(
    public message: string,
    public status: number = 500,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationAppError extends AppError {
  constructor(
    public fields: Array<{ field: string; message: string }>
  ) {
    super('Validation failed', 400, 'VALIDATION_ERROR')
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Rate limit exceeded. Please try again later.', 429, 'RATE_LIMIT')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

// ============================================================================
// ERROR RESPONSE FORMATTERS
// ============================================================================

export function formatErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return {
      error: error.message,
      code: error.code,
      details: error.details,
      timestamp: new Date().toISOString(),
    }
  }

  if (error instanceof ValidationAppError) {
    return {
      error: error.message,
      code: 'VALIDATION_ERROR',
      details: {
        fields: error.fields,
      },
      timestamp: new Date().toISOString(),
    }
  }

  if (error instanceof Error) {
    return {
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString(),
    }
  }

  return {
    error: 'Unknown error occurred',
    timestamp: new Date().toISOString(),
  }
}

export function createErrorResponse(error: unknown): NextResponse {
  let status = 500
  let body = formatErrorResponse(error)

  if (error instanceof AppError) {
    status = error.status
  }

  return NextResponse.json(body, { status })
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateUUID(id: string, fieldName = 'id'): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    throw new ValidationAppError([
      {
        field: fieldName,
        message: `Invalid UUID format: ${id}`,
      },
    ])
  }
}

export function validateNonEmptyString(value: string, fieldName: string): void {
  if (!value || value.trim().length === 0) {
    throw new ValidationAppError([
      {
        field: fieldName,
        message: `${fieldName} cannot be empty`,
      },
    ])
  }
}

export function validateEnum<T extends Record<string, unknown>>(
  value: string,
  enumObj: T,
  fieldName: string
): void {
  if (!Object.values(enumObj).includes(value)) {
    throw new ValidationAppError([
      {
        field: fieldName,
        message: `Invalid value for ${fieldName}. Must be one of: ${Object.values(enumObj).join(', ')}`,
      },
    ])
  }
}

export function validateRequest<T extends Record<string, unknown>>(
  data: unknown,
  requiredFields: string[]
): T {
  if (typeof data !== 'object' || data === null) {
    throw new ValidationAppError([
      {
        field: 'body',
        message: 'Request body must be a JSON object',
      },
    ])
  }

  const obj = data as Record<string, unknown>
  const errors: Array<{ field: string; message: string }> = []

  for (const field of requiredFields) {
    if (!(field in obj) || obj[field] === null || obj[field] === undefined) {
      errors.push({
        field,
        message: `Field is required`,
      })
    }
  }

  if (errors.length > 0) {
    throw new ValidationAppError(errors)
  }

  return obj as T
}

// ============================================================================
// SAFE ERROR LOGGING (never expose sensitive data)
// ============================================================================

export function logError(context: string, error: unknown): void {
  const sanitized =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2)

  console.error(`[${context}] ${sanitized}`)
}

export function logErrorWithContext(context: string, error: unknown, context_data?: Record<string, unknown>): void {
  const sanitized =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2)

  const ctx = context_data ? ` | Context: ${JSON.stringify(context_data)}` : ''
  console.error(`[${context}] ${sanitized}${ctx}`)
}
