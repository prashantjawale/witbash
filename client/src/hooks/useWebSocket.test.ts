import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "./useWebSocket";
import type { WebSocketMessage } from "../types";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen(new Event("open"));
  }

  simulateMessage(data: WebSocketMessage) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose(new CloseEvent("close"));
  }

  simulateError() {
    if (this.onerror) this.onerror(new Event("error"));
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("should connect automatically when autoConnect is true (default)", () => {
    renderHook(() => useWebSocket({ url: "ws://localhost:3000/ws" }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:3000/ws");
  });

  it("should not connect automatically when autoConnect is false", () => {
    renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws", autoConnect: false })
    );

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("should set connectionStatus to 'connecting' initially", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    expect(result.current.connectionStatus).toBe("connecting");
  });

  it("should set connectionStatus to 'connected' on open", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.connectionStatus).toBe("connected");
  });

  it("should update lastMessage when a message is received", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    const testMessage: WebSocketMessage = {
      type: "player_joined",
      player: {
        id: "p1",
        name: "Alice",
        isHost: false,
        isConnected: true,
        joinOrder: 1,
      },
    };

    act(() => {
      MockWebSocket.instances[0].simulateMessage(testMessage);
    });

    expect(result.current.lastMessage).toEqual(testMessage);
  });

  it("should send messages when connected", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    const message: WebSocketMessage = {
      type: "join_room",
      roomCode: "ABCD",
      playerId: "p1",
    };

    act(() => {
      result.current.send(message);
    });

    expect(MockWebSocket.instances[0].sentMessages).toHaveLength(1);
    expect(JSON.parse(MockWebSocket.instances[0].sentMessages[0])).toEqual(
      message
    );
  });

  it("should buffer messages when disconnected and flush on reconnect", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    // Connection is still in CONNECTING state (not open yet)
    const message: WebSocketMessage = {
      type: "join_room",
      roomCode: "ABCD",
      playerId: "p1",
    };

    act(() => {
      result.current.send(message);
    });

    // Message should not be sent yet
    expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0);

    // Now open the connection - buffered messages should flush
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(MockWebSocket.instances[0].sentMessages).toHaveLength(1);
    expect(JSON.parse(MockWebSocket.instances[0].sentMessages[0])).toEqual(
      message
    );
  });

  it("should attempt reconnection with exponential backoff on close", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Simulate disconnect
    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    expect(result.current.connectionStatus).toBe("reconnecting");

    // First reconnect after 1s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second disconnect
    act(() => {
      MockWebSocket.instances[1].simulateClose();
    });

    // Second reconnect after 2s
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(MockWebSocket.instances).toHaveLength(3);

    // Third disconnect
    act(() => {
      MockWebSocket.instances[2].simulateClose();
    });

    // Third reconnect after 4s
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it("should cap reconnection delay at maxReconnectDelay (10s)", () => {
    // Use a long reconnect timeout so it doesn't interfere
    renderHook(() =>
      useWebSocket({
        url: "ws://localhost:3000/ws",
        reconnectTimeout: 120000,
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Simulate multiple disconnects to reach max delay
    // Attempt 0: 1s, Attempt 1: 2s, Attempt 2: 4s, Attempt 3: 8s, Attempt 4: 10s (capped)
    for (let i = 0; i < 4; i++) {
      act(() => {
        MockWebSocket.instances[MockWebSocket.instances.length - 1].simulateClose();
      });
      const delay = Math.min(1000 * Math.pow(2, i), 10000);
      act(() => {
        vi.advanceTimersByTime(delay);
      });
    }

    // Now at attempt 4, delay should be capped at 10s (not 16s)
    const instancesBefore = MockWebSocket.instances.length;
    act(() => {
      MockWebSocket.instances[MockWebSocket.instances.length - 1].simulateClose();
    });

    // Advance 10s (the cap) - should reconnect
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);

    // Verify another attempt also caps at 10s
    const instancesAfter = MockWebSocket.instances.length;
    act(() => {
      MockWebSocket.instances[MockWebSocket.instances.length - 1].simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(MockWebSocket.instances.length).toBe(instancesAfter + 1);
  });

  it("should timeout after 30 seconds of failed reconnection", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: "ws://localhost:3000/ws",
        reconnectTimeout: 30000,
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Simulate disconnect
    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    expect(result.current.connectionStatus).toBe("reconnecting");

    // Advance past the 30s timeout
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("should allow manual reconnect after timeout", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: "ws://localhost:3000/ws",
        reconnectTimeout: 30000,
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    // Timeout
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.connectionStatus).toBe("disconnected");

    const instancesBefore = MockWebSocket.instances.length;

    // Manual reconnect
    act(() => {
      result.current.reconnect();
    });

    expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);
    expect(result.current.connectionStatus).toBe("connecting");
  });

  it("should reset reconnect attempts on successful connection", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Disconnect and reconnect once
    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Successfully reconnect
    act(() => {
      MockWebSocket.instances[1].simulateOpen();
    });

    expect(result.current.connectionStatus).toBe("connected");

    // Disconnect again - should start from 1s delay again
    act(() => {
      MockWebSocket.instances[1].simulateClose();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should have created a new instance (delay was 1s, not 2s)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(3);
  });

  it("should ignore malformed messages", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Send malformed data
    act(() => {
      if (MockWebSocket.instances[0].onmessage) {
        MockWebSocket.instances[0].onmessage(
          new MessageEvent("message", { data: "not valid json{{{" })
        );
      }
    });

    expect(result.current.lastMessage).toBeNull();
  });

  it("should clean up on unmount", () => {
    const { unmount } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:3000/ws" })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    unmount();

    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
  });
});
