"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { ChatMessage, ConversationSummary } from "@/hooks/useChatSocket";

interface ChatWindowProps {
  conversation: ConversationSummary | undefined;
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatWindow({
  conversation,
  messages,
  onSend,
}: ChatWindowProps) {
  const { data: session } = useSession();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversation) {
    return (
      <div className='flex flex-1 items-center justify-center text-zinc-400'>
        Select a conversation to start chatting
      </div>
    );
  }

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim());
      setText("");
    }
  };

  return (
    <div className='flex flex-1 flex-col h-full'>
      <div className='border-b px-4 py-3'>
        <p className='font-medium'>{conversation.name}</p>
        <p className='text-xs text-zinc-400'>
          {conversation.type === "group" ? "Group" : "Direct message"}
        </p>
      </div>

      <div className='flex-1 overflow-y-auto p-4 flex flex-col gap-2'>
        {messages.map((m, i) => {
          const isMine = m.senderId === session?.user?.id;
          return (
            <div
              key={i}
              className={`max-w-xs rounded px-3 py-2 text-sm ${isMine ? "self-end bg-blue-500 text-white" : "self-start bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {!isMine && (
                <p className='text-xs font-semibold opacity-70'>
                  {m.senderUsername}
                </p>
              )}
              <p>{m.text}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className='flex gap-2 border-t p-3'>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Type a message'
          className='border px-2 py-1 flex-1'
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button
          onClick={handleSend}
          className='rounded bg-foreground px-4 py-2 text-background'
        >
          Send
        </button>
      </div>
    </div>
  );
}
