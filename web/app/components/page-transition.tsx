"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Remove and re-add the animation class to restart it without remounting
    el.classList.remove("animate-fade-in-up");
    void el.offsetHeight; // force reflow
    el.classList.add("animate-fade-in-up");
  }, [pathname]);

  return (
    <div ref={ref} className="animate-fade-in-up">
      {children}
    </div>
  );
}
