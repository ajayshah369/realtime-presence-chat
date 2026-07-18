"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/hooks/useChatSocket";

interface ConversationListProps {
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onStartConversation: (recipientUserId: string) => void;
  onCreateGroup: (name: string, memberUserIds: string[]) => void;
}

export function ConversationList({
  conversations,
  selectedConversationId,
  onSelect,
  onStartConversation,
  onCreateGroup,
}: ConversationListProps) {
  const [newChatUserId, setNewChatUserId] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [memberIds, setMemberIds] = useState("");

  const handleStartChat = () => {
    if (newChatUserId.trim()) {
      onStartConversation(newChatUserId.trim());
      setNewChatUserId("");
    }
  };

  const handleCreateGroup = () => {
    const ids = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (groupName.trim() && ids.length > 0) {
      onCreateGroup(groupName.trim(), ids);
      setGroupName("");
      setMemberIds("");
      setShowGroupForm(false);
    }
  };

  return (
    <aside className="flex w-80 flex-col border-r h-full">
      <div className="border-b p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={newChatUserId}
            onChange={(e) => setNewChatUserId(e.target.value)}
            placeholder="Start chat with user sub"
            className="border px-2 py-1 flex-1 text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleStartChat()}
          />
          <button onClick={handleStartChat} className="rounded bg-foreground px-3 py-1 text-background text-sm">
            Chat
          </button>
        </div>
        <button onClick={() => setShowGroupForm((v) => !v)} className="text-xs underline self-start text-zinc-500">
          {showGroupForm ? "Cancel" : "+ New group"}
        </button>
        {showGroupForm && (
          <div className="flex flex-col gap-2 border-t pt-2">
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" className="border px-2 py-1 text-sm" />
            <input value={memberIds} onChange={(e) => setMemberIds(e.target.value)} placeholder="Member subs, comma-separated" className="border px-2 py-1 text-sm" />
            <button onClick={handleCreateGroup} className="rounded bg-foreground px-3 py-1 text-background text-sm self-start">
              Create
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && <p className="p-4 text-sm text-zinc-400">No conversations yet</p>}
        {conversations.map((c) => (
          <button
            key={c.conversationId}
            onClick={() => onSelect(c.conversationId)}
            className={`block w-full text-left px-4 py-3 border-b hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
              selectedConversationId === c.conversationId ? "bg-zinc-100 dark:bg-zinc-800" : ""
            }`}
          >
            <p className="text-sm font-medium">{c.name}</p>
            <p className="text-xs text-zinc-400">{c.type === "group" ? "Group" : "Direct message"}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}