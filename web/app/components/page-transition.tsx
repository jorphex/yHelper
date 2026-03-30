"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isAnimating, setIsAnimating] = useState(false);
  const [displayChildren, setDisplayChildren] = useState(children);

  useEffect(() => {
    if (pathname) {
      setIsAnimating(true);
      setDisplayChildren(children);
      
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, 600);
      
      return () => clearTimeout(timer);
    }
  }, [pathname, children]);

  return (
    <div
      className={`transition-all duration-500 ${
        isAnimating ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
      }`}
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {displayChildren}
    </div>
  );
}
