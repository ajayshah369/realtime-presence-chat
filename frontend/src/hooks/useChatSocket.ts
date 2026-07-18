"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface ChatMessage {
  conversationId: string;
  senderId: string;
  senderUsername?: string;
  text: string;
  sentAt?: string;
  timestamp?: string;
}

export interface ConversationSummary {
  conversationId: string;
  type: "dm" | "group";
  name: string;
  otherUserId?: string;
}

type SocketStatus = "idle" | "connecting" | "open";

export function useChatSocket(idToken: string | undefined) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, ChatMessage[]>
  >({});
  const socketRef = useRef<WebSocket | null>(null);
  const conversationIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    conversationIdsRef.current = new Set(
      conversations.map((c) => c.conversationId),
    );
  }, [conversations]);

  useEffect(() => {
    if (!idToken) return;

    const url = `${process.env.NEXT_PUBLIC_WEBSOCKET_URL}?token=${encodeURIComponent(idToken)}`;
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setIsOpen(true);
      socket.send(JSON.stringify({ action: "listConversations" }));
    });

    socket.addEventListener("close", () => setIsOpen(false));

    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "conversationList":
          setConversations(data.conversations);
          break;

        case "conversationStarted":
          setConversations((prev) =>
            prev.some((c) => c.conversationId === data.conversationId)
              ? prev
              : [
                  ...prev,
                  {
                    conversationId: data.conversationId,
                    type: "dm",
                    name: data.otherUser?.email ?? data.otherUser?.userId,
                    otherUserId: data.otherUser?.userId,
                  },
                ],
          );
          break;

        case "groupCreated":
          setConversations((prev) =>
            prev.some((c) => c.conversationId === data.conversationId)
              ? prev
              : [
                  ...prev,
                  {
                    conversationId: data.conversationId,
                    type: "group",
                    name: data.name,
                  },
                ],
          );
          break;

        case "messageHistory":
          setMessagesByConversation((prev) => ({
            ...prev,
            [data.conversationId]: data.messages,
          }));
          break;

        case "message": {
          const message: ChatMessage = data;
          setMessagesByConversation((prev) => ({
            ...prev,
            [message.conversationId]: [
              ...(prev[message.conversationId] ?? []),
              message,
            ],
          }));
          // A message for a conversation we don't know about yet (e.g. someone
          // just started a DM with us and immediately sent something) — refresh
          // the sidebar so it shows up.
          if (!conversationIdsRef.current.has(message.conversationId)) {
            socket.send(JSON.stringify({ action: "listConversations" }));
          }
          break;
        }

        default:
          break;
      }
    });

    return () => socket.close();
  }, [idToken]);

  const status: SocketStatus = !idToken
    ? "idle"
    : isOpen
      ? "open"
      : "connecting";

  const send = useCallback(
    (action: string, payload: Record<string, unknown> = {}) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ action, ...payload }));
      }
    },
    [],
  );

  const sendMessage = useCallback(
    (conversationId: string, text: string) =>
      send("sendMessage", { conversationId, text }),
    [send],
  );
  const startConversation = useCallback(
    (recipientUserId: string) => send("startConversation", { recipientUserId }),
    [send],
  );
  const createGroup = useCallback(
    (name: string, memberUserIds: string[]) =>
      send("createGroup", { name, memberUserIds }),
    [send],
  );
  const fetchMessages = useCallback(
    (conversationId: string) => send("getMessages", { conversationId }),
    [send],
  );

  return {
    status,
    conversations,
    messagesByConversation,
    sendMessage,
    startConversation,
    createGroup,
    fetchMessages,
  };
}
