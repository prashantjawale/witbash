import React, { useEffect, useState } from 'react';

// ============================================================
// Error Types
// ============================================================

export type ErrorType =
  | 'connection'
  | 'state_correction'
  | 'insufficient_players'
  | 'question_bank';

export interface OverlayError {
  id: string;
  type: ErrorType;
  message: string;
  /** Whether the error can be dismissed by the user */
  dismissible: boolean;
  /** Whether a retry action is available */
  retryable: boolean;
}

// ============================================================
// Props
// ============================================================

export interface ErrorOverlayProps {
  /** List of active errors to display */
  errors: OverlayError[];
  /** Callback when user clicks retry (for connection errors) */
  onRetry?: () => void;
  /** Callback when user dismisses an error */
  onDismiss?: (errorId: string) => void;
}

// ============================================================
// Styles (inline for zero-dependency overlay)
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '1rem',
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  errorItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1rem',
    borderRadius: '8px',
    border: '1px solid',
  },
  errorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontWeight: 600,
    fontSize: '1rem',
  },
  errorMessage: {
    fontSize: '0.9rem',
    lineHeight: 1.5,
    color: '#333',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '0.5rem',
  },
  retryButton: {
    padding: '0.5rem 1.25rem',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.9rem',
  },
  dismissButton: {
    padding: '0.5rem 1.25rem',
    backgroundColor: 'transparent',
    color: '#555',
    border: '1px solid #ccc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.9rem',
  },
};

// ============================================================
// Helpers
// ============================================================

function getErrorStyles(type: ErrorType): { borderColor: string; backgroundColor: string } {
  switch (type) {
    case 'connection':
      return { borderColor: '#dc2626', backgroundColor: '#fef2f2' };
    case 'state_correction':
      return { borderColor: '#f59e0b', backgroundColor: '#fffbeb' };
    case 'insufficient_players':
      return { borderColor: '#f59e0b', backgroundColor: '#fffbeb' };
    case 'question_bank':
      return { borderColor: '#dc2626', backgroundColor: '#fef2f2' };
  }
}

function getErrorIcon(type: ErrorType): string {
  switch (type) {
    case 'connection':
      return '⚠️';
    case 'state_correction':
      return 'ℹ️';
    case 'insufficient_players':
      return '⏸️';
    case 'question_bank':
      return '❌';
  }
}

function getErrorTitle(type: ErrorType): string {
  switch (type) {
    case 'connection':
      return 'Connection Error';
    case 'state_correction':
      return 'State Corrected';
    case 'insufficient_players':
      return 'Game Paused';
    case 'question_bank':
      return 'Question Bank Error';
  }
}

// ============================================================
// Helper: create error objects
// ============================================================

export function createConnectionError(message: string): OverlayError {
  return {
    id: `connection-${Date.now()}`,
    type: 'connection',
    message,
    dismissible: false,
    retryable: true,
  };
}

export function createStateCorrectionError(): OverlayError {
  return {
    id: `state-correction-${Date.now()}`,
    type: 'state_correction',
    message: 'Your game state was out of sync and has been corrected to match other players.',
    dismissible: true,
    retryable: false,
  };
}

export function createInsufficientPlayersError(connectedCount: number): OverlayError {
  return {
    id: `insufficient-players-${Date.now()}`,
    type: 'insufficient_players',
    message: `The game is paused because only ${connectedCount} player${connectedCount === 1 ? ' is' : 's are'} connected. At least 3 players are needed to continue.`,
    dismissible: false,
    retryable: false,
  };
}

export function createQuestionBankError(message: string): OverlayError {
  return {
    id: `question-bank-${Date.now()}`,
    type: 'question_bank',
    message,
    dismissible: true,
    retryable: false,
  };
}

// ============================================================
// Component
// ============================================================

/**
 * ErrorOverlay — displays errors on top of the current screen without navigation.
 *
 * Supports:
 * - Connection errors with retry option (Requirement 2.6)
 * - State correction notifications (Requirement 12.3)
 * - Insufficient players warning / game paused (Requirement 10.5)
 * - Question bank load/parse errors (Requirements 13.4, 13.5)
 */
export function ErrorOverlay({ errors, onRetry, onDismiss }: ErrorOverlayProps) {
  // Auto-dismiss state correction notifications after 5 seconds
  const [autoDismissIds, setAutoDismissIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const correctionErrors = errors.filter(
      (e) => e.type === 'state_correction' && !autoDismissIds.has(e.id)
    );

    if (correctionErrors.length === 0) return;

    const timers = correctionErrors.map((error) => {
      return setTimeout(() => {
        setAutoDismissIds((prev) => new Set([...prev, error.id]));
        onDismiss?.(error.id);
      }, 5000);
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [errors, autoDismissIds, onDismiss]);

  // Filter out auto-dismissed errors
  const visibleErrors = errors.filter((e) => !autoDismissIds.has(e.id));

  if (visibleErrors.length === 0) {
    return null;
  }

  return (
    <div
      style={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-label="Error notification"
      data-testid="error-overlay"
    >
      <div style={styles.container}>
        {visibleErrors.map((error) => {
          const errorStyles = getErrorStyles(error.type);
          return (
            <div
              key={error.id}
              style={{
                ...styles.errorItem,
                borderColor: errorStyles.borderColor,
                backgroundColor: errorStyles.backgroundColor,
              }}
              role="alert"
              data-testid={`error-item-${error.type}`}
            >
              <div style={styles.errorHeader}>
                <span aria-hidden="true">{getErrorIcon(error.type)}</span>
                <span>{getErrorTitle(error.type)}</span>
              </div>
              <div style={styles.errorMessage}>{error.message}</div>
              {(error.retryable || error.dismissible) && (
                <div style={styles.actions}>
                  {error.retryable && onRetry && (
                    <button
                      style={styles.retryButton}
                      onClick={onRetry}
                      data-testid="error-retry-button"
                      aria-label="Retry connection"
                    >
                      Retry
                    </button>
                  )}
                  {error.dismissible && onDismiss && (
                    <button
                      style={styles.dismissButton}
                      onClick={() => onDismiss(error.id)}
                      data-testid="error-dismiss-button"
                      aria-label="Dismiss notification"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
