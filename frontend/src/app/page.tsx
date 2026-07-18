"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useChatSocket } from "@/hooks/useChatSocket";
import { Header } from "@/components/Header";
import { ConversationList } from "@/components/ConversationList";
import { ChatWindow } from "@/components/ChatWindow";

export default function Home() {
  const { data: session, status } = useSession();
  const {
    status: socketStatus,
    conversations,
    messagesByConversation,
    sendMessage,
    startConversation,
    createGroup,
    fetchMessages,
  } = useChatSocket(session?.idToken);

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  if (status === "loading") {
    return (
      <main className='flex flex-1 items-center justify-center'>
        Loading...
      </main>
    );
  }

  if (session?.error === "RefreshAccessTokenError") {
    return (
      <main className='flex flex-1 items-center justify-center'>
        <button
          onClick={() => signIn("cognito")}
          className='rounded-full bg-foreground px-5 py-3 text-background'
        >
          Session expired — sign in again
        </button>
      </main>
    );
  }

  if (!session) {
    return (
      <main className='flex flex-1 items-center justify-center'>
        <button
          onClick={() => signIn("cognito")}
          className='rounded-full bg-foreground px-5 py-3 text-background'
        >
          Sign in with Google
        </button>
      </main>
    );
  }

  const handleSelect = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    if (!messagesByConversation[conversationId]) {
      fetchMessages(conversationId);
    }
  };

  const selectedConversation = conversations.find(
    (c) => c.conversationId === selectedConversationId,
  );

  return (
    <div className='flex flex-col h-screen'>
      <Header socketStatus={socketStatus} />
      <div className='flex flex-1 overflow-hidden'>
        <ConversationList
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelect={handleSelect}
          onStartConversation={startConversation}
          onCreateGroup={createGroup}
        />
        <ChatWindow
          conversation={selectedConversation}
          messages={
            selectedConversationId
              ? (messagesByConversation[selectedConversationId] ?? [])
              : []
          }
          onSend={(text) =>
            selectedConversationId && sendMessage(selectedConversationId, text)
          }
        />
      </div>
    </div>
  );
}
