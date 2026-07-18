'use client';

import { useEffect, useState } from 'react';

const AVATAR_FALLBACK_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9IiNlMmU4ZjAiLz48cmVjdCB4PSIxNiIgeT0iMTQiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzNiIgcng9IjgiIGZpbGw9IiM2NDc0OGIiLz48cGF0aCBkPSJNMjIgMjVoMjBNMjIgMzJoMjBNMjIgMzloMTMiIHN0cm9rZT0iI2Y4ZmFmYyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIG9wYWNpdHk9Ii43NSIvPjxjaXJjbGUgY3g9IjQ4IiBjeT0iNDgiIHI9IjciIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=';

interface AvatarImageWithFallbackProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
}

export function AvatarImageWithFallback({ src, alt, className }: AvatarImageWithFallbackProps) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  const finalSrc = errored || !src ? AVATAR_FALLBACK_DATA_URL : src;

  return (
    // biome-ignore lint/performance/noImgElement: avatar src may be a runtime upload URL or inline SVG fallback, not suitable for next/image optimization
    // eslint-disable-next-line @next/next/no-img-element
    <img src={finalSrc} alt={alt} className={className} onError={() => setErrored(true)} />
  );
}
