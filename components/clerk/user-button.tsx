"use client";

import { useEffect, useState } from "react";

import { UserButton } from "@clerk/nextjs";

function ClientUserButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return <UserButton />;
}

export default ClientUserButton;
export { ClientUserButton };
