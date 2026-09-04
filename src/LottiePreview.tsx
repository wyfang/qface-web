import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";

interface LottiePreviewProps {
  src: string;
  label: string;
}

export function LottiePreview({ src, label }: LottiePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let animation: AnimationItem | undefined;

    import("lottie-web").then(({ default: lottie }) => {
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
    });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [src]);

  return <div ref={containerRef} aria-label={label} className="lottie-preview" />;
}
