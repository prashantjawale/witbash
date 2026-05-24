import { useCallback, useEffect, useRef, useState } from "react";
import type { WebSocketMessage } from "../types";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface UseWebSocketReturn {
  send: (message: WebSocketMessage) => void;
  lastMessage: WebSocketMessage | null;
  connectionStatus: ConnectionStatus;
  reconnect: () => void;
}

export interface UseWebSocketOptions {
  /** WebSocket URL to connect to */
  url: string;
  /** Whether to automatically connect on mount. Default: true */
  autoConnect?: boolean;
  /** Maximum reconnection timeout in ms. Default: 10000 */
  maxReconnectDelay?: number;
  /** Total timeout for reconnection attempts in ms. Default: 30000 */
  reconnectTimeout?: number;
}

const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 10000;
const RECONNECT_TIMEOUT = 30000;

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    autoConnect = true,
    maxReconnectDelay = MAX_RECONNECT_DELAY,
    reconnectTimeout = RECONNECT_TIMEOUT,
  } = options;

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageBufferRef = useRef<WebSocketMessage[]>([]);
  const isUnmountedRef = useRef(false);
  const shouldReconnectRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const flushMessageBuffer = useCallback((ws: WebSocket) => {
    const buffered = messageBufferRef.current;
    messageBufferRef.current = [];
    for (const msg of buffered) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    setConnectionStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmountedRef.current) return;
      setConnectionStatus("connected");
      reconnectAttemptRef.current = 0;
      clearTimers();
      flushMessageBuffer(ws);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (isUnmountedRef.current) return;
      try {
        const message = JSON.parse(event.data as string) as WebSocketMessage;
        console.log('[useWebSocket] Message received:', message.type, message);
        setLastMessage(message);
      } catch {
        // Ignore malformed messages
        console.log('[useWebSocket] Failed to parse message:', event.data);
      }
    };

    ws.onclose = () => {
      if (isUnmountedRef.current) return;
      wsRef.current = null;

      if (shouldReconnectRef.current) {
        scheduleReconnect();
      } else {
        setConnectionStatus("disconnected");
      }
    };

    ws.onerror = () => {
      // The onclose handler will fire after onerror, so reconnection
      // logic is handled there. We don't need to do anything extra here.
    };
  }, [url, clearTimers, flushMessageBuffer]);

  const scheduleReconnect = useCallback(() => {
    if (isUnmountedRef.current || !shouldReconnectRef.current) return;

    setConnectionStatus("reconnecting");

    // Start the overall reconnection timeout on first attempt
    if (reconnectAttemptRef.current === 0) {
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isUnmountedRef.current) return;
        // Give up reconnecting after timeout
        shouldReconnectRef.current = false;
        clearTimers();
        setConnectionStatus("disconnected");
      }, reconnectTimeout);
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
      maxReconnectDelay
    );
    reconnectAttemptRef.current += 1;

    reconnectTimerRef.current = setTimeout(() => {
      if (isUnmountedRef.current) return;
      connect();
    }, delay);
  }, [connect, clearTimers, maxReconnectDelay, reconnectTimeout]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      // Buffer messages during brief disconnections
      messageBufferRef.current.push(message);
    }
  }, []);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    clearTimers();
    connect();
  }, [connect, clearTimers]);

  // Auto-connect on mount
  useEffect(() => {
    isUnmountedRef.current = false;
    if (autoConnect) {
      connect();
    }
    return () => {
      isUnmountedRef.current = true;
      shouldReconnectRef.current = false;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect, clearTimers]);

  return {
    send,
    lastMessage,
    connectionStatus,
    reconnect,
  };
}
