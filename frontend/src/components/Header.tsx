"use client";

import { useSession, signOut } from "next-auth/react";

export function Header({
  socketStatus,
}: {
  socketStatus: "idle" | "connecting" | "open";
}) {
  const { data: session } = useSession();

  const statusColor =
    socketStatus === "open"
      ? "bg-green-500"
      : socketStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-gray-400";

  return (
    <header className='flex items-center justify-between border-b px-4 py-3'>
      <div className='flex items-center gap-2'>
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className='text-sm text-zinc-500'>{socketStatus}</span>
      </div>
      <div className='flex items-center gap-3'>
        <span className='text-sm'>{session?.user?.email}</span>
        <button
          onClick={() => signOut()}
          className='rounded-full bg-foreground px-3 py-1.5 text-background text-xs'
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
