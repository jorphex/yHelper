"use client";

import { useCallback, useEffect, useState } from "react";

export function useInViewOnce<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [isInView, setIsInView] = useState(false);
  const ref = useCallback((value: T | null) => {
    setNode(value);
  }, []);

  useEffect(() => {
    if (!node) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsInView(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { root: null, threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, isInView };
}
