import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";

interface LottiePreviewProps {
  src: string;
  label: string;
  onError?: () => void;
  onLoad?: () => void;
}

export function LottiePreview({
  src,
  label,
  onError,
  onLoad,
}: LottiePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onErrorRef.current = onError;
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let animation: AnimationItem | undefined;

    import("lottie-web")
      .then(({ default: lottie }) => {
        if (cancelled || !containerRef.current) return;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          path: src,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
          },
        });
        animation.addEventListener("DOMLoaded", () => {
          if (!cancelled) onLoadRef.current?.();
        });
        animation.addEventListener("data_failed", () => {
          if (!cancelled) onErrorRef.current?.();
        });
        animation.addEventListener("error", () => {
          if (!cancelled) onErrorRef.current?.();
        });
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [src]);

  return <div ref={containerRef} aria-label={label} className="lottie-preview" />;
}
