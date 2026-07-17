"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function Home() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <main className='flex flex-1 items-center justify-center'>
        Loading...
      </main>
    );
  }

  return (
    <main className='flex flex-1 flex-col items-center justify-center gap-4'>
      {session ? (
        <>
          <p>Signed in as {session.user?.email}</p>
          <button
            onClick={() => signOut()}
            className='rounded-full bg-foreground px-5 py-3 text-background'
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          onClick={() => signIn("cognito")}
          className='rounded-full bg-foreground px-5 py-3 text-background'
        >
          Sign in with Google
        </button>
      )}
    </main>
  );
}
