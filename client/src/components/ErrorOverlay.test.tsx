import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import {
  ErrorOverlay,
  createConnectionError,
  createStateCorrectionError,
  createInsufficientPlayersError,
  createQuestionBankError,
} from './ErrorOverlay';
import type { OverlayError } from './ErrorOverlay';

describe('ErrorOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no errors', () => {
    const { container } = render(
      <ErrorOverlay errors={[]} onRetry={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when errors are present', () => {
    const error = createConnectionError('Connection lost');
    render(
      <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(screen.getByTestId('error-overlay')).toBeTruthy();
  });

  describe('Connection errors (Requirement 2.6)', () => {
    it('displays connection error with retry button', () => {
      const error = createConnectionError('Could not connect to server');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.getByText('Connection Error')).toBeTruthy();
      expect(screen.getByText('Could not connect to server')).toBeTruthy();
      expect(screen.getByTestId('error-retry-button')).toBeTruthy();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn();
      const error = createConnectionError('Connection lost');
      render(
        <ErrorOverlay errors={[error]} onRetry={onRetry} onDismiss={vi.fn()} />
      );

      fireEvent.click(screen.getByTestId('error-retry-button'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('connection errors are not dismissible', () => {
      const error = createConnectionError('Connection lost');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.queryByTestId('error-dismiss-button')).toBeNull();
    });
  });

  describe('State correction notifications (Requirement 12.3)', () => {
    it('displays state correction notification', () => {
      const error = createStateCorrectionError();
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.getByText('State Corrected')).toBeTruthy();
      expect(
        screen.getByText(
          'Your game state was out of sync and has been corrected to match other players.'
        )
      ).toBeTruthy();
    });

    it('state correction is dismissible', () => {
      const onDismiss = vi.fn();
      const error = createStateCorrectionError();
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={onDismiss} />
      );

      const dismissBtn = screen.getByTestId('error-dismiss-button');
      expect(dismissBtn).toBeTruthy();
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledWith(error.id);
    });

    it('auto-dismisses state correction after 5 seconds', () => {
      const onDismiss = vi.fn();
      const error = createStateCorrectionError();
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={onDismiss} />
      );

      expect(screen.getByText('State Corrected')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onDismiss).toHaveBeenCalledWith(error.id);
    });

    it('state correction has no retry button', () => {
      const error = createStateCorrectionError();
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.queryByTestId('error-retry-button')).toBeNull();
    });
  });

  describe('Insufficient players warning (Requirement 10.5)', () => {
    it('displays insufficient players warning with correct count', () => {
      const error = createInsufficientPlayersError(2);
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.getByText('Game Paused')).toBeTruthy();
      expect(
        screen.getByText(
          'The game is paused because only 2 players are connected. At least 3 players are needed to continue.'
        )
      ).toBeTruthy();
    });

    it('handles singular player count', () => {
      const error = createInsufficientPlayersError(1);
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(
        screen.getByText(
          'The game is paused because only 1 player is connected. At least 3 players are needed to continue.'
        )
      ).toBeTruthy();
    });

    it('insufficient players warning is not dismissible or retryable', () => {
      const error = createInsufficientPlayersError(2);
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.queryByTestId('error-retry-button')).toBeNull();
      expect(screen.queryByTestId('error-dismiss-button')).toBeNull();
    });
  });

  describe('Question bank errors (Requirements 13.4, 13.5)', () => {
    it('displays question bank fetch error', () => {
      const error = createQuestionBankError(
        'Failed to load question bank. Please check that questions.json is accessible.'
      );
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.getByText('Question Bank Error')).toBeTruthy();
      expect(
        screen.getByText(
          'Failed to load question bank. Please check that questions.json is accessible.'
        )
      ).toBeTruthy();
    });

    it('displays question bank parse error', () => {
      const error = createQuestionBankError(
        'Question bank is not a valid JSON array of strings.'
      );
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(
        screen.getByText('Question bank is not a valid JSON array of strings.')
      ).toBeTruthy();
    });

    it('displays insufficient questions error', () => {
      const error = createQuestionBankError(
        'Not enough questions. Need at least 5 questions but only 3 are available.'
      );
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(
        screen.getByText(
          'Not enough questions. Need at least 5 questions but only 3 are available.'
        )
      ).toBeTruthy();
    });

    it('question bank errors are dismissible', () => {
      const onDismiss = vi.fn();
      const error = createQuestionBankError('Failed to load');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={onDismiss} />
      );

      const dismissBtn = screen.getByTestId('error-dismiss-button');
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledWith(error.id);
    });
  });

  describe('Multiple errors', () => {
    it('displays multiple errors simultaneously', () => {
      const errors: OverlayError[] = [
        createConnectionError('Connection lost'),
        createInsufficientPlayersError(2),
      ];
      render(
        <ErrorOverlay errors={errors} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      expect(screen.getByText('Connection Error')).toBeTruthy();
      expect(screen.getByText('Game Paused')).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('has role alertdialog with aria-modal', () => {
      const error = createConnectionError('Error');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      const overlay = screen.getByTestId('error-overlay');
      expect(overlay.getAttribute('role')).toBe('alertdialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });

    it('each error item has role alert', () => {
      const error = createConnectionError('Error');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      const item = screen.getByTestId('error-item-connection');
      expect(item.getAttribute('role')).toBe('alert');
    });

    it('retry button has aria-label', () => {
      const error = createConnectionError('Error');
      render(
        <ErrorOverlay errors={[error]} onRetry={vi.fn()} onDismiss={vi.fn()} />
      );

      const btn = screen.getByTestId('error-retry-button');
      expect(btn.getAttribute('aria-label')).toBe('Retry connection');
    });
  });

  describe('Helper functions', () => {
    it('createConnectionError creates correct structure', () => {
      const error = createConnectionError('test message');
      expect(error.type).toBe('connection');
      expect(error.message).toBe('test message');
      expect(error.dismissible).toBe(false);
      expect(error.retryable).toBe(true);
      expect(error.id).toMatch(/^connection-/);
    });

    it('createStateCorrectionError creates correct structure', () => {
      const error = createStateCorrectionError();
      expect(error.type).toBe('state_correction');
      expect(error.dismissible).toBe(true);
      expect(error.retryable).toBe(false);
      expect(error.id).toMatch(/^state-correction-/);
    });

    it('createInsufficientPlayersError creates correct structure', () => {
      const error = createInsufficientPlayersError(2);
      expect(error.type).toBe('insufficient_players');
      expect(error.dismissible).toBe(false);
      expect(error.retryable).toBe(false);
      expect(error.id).toMatch(/^insufficient-players-/);
    });

    it('createQuestionBankError creates correct structure', () => {
      const error = createQuestionBankError('parse error');
      expect(error.type).toBe('question_bank');
      expect(error.message).toBe('parse error');
      expect(error.dismissible).toBe(true);
      expect(error.retryable).toBe(false);
      expect(error.id).toMatch(/^question-bank-/);
    });
  });
});
