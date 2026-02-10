/**
 * 打字机效果：文案逐字显示，供 AIChatBanner 等使用
 */

import { useEffect, useState, useRef } from 'react';

const TYPING_MS = 28;

export function useTypewriter(text: string, enabled: boolean, key: string): string {
  const [displayedLength, setDisplayedLength] = useState(0);
  const prevKey = useRef(key);

  useEffect(() => {
    if (key !== prevKey.current) {
      prevKey.current = key;
      setDisplayedLength(0);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled || displayedLength >= text.length) return;
    const t = setInterval(() => {
      setDisplayedLength((n) => (n >= text.length ? n : n + 1));
    }, TYPING_MS);
    return () => clearInterval(t);
  }, [enabled, text.length, displayedLength]);

  useEffect(() => {
    if (text.length < displayedLength) setDisplayedLength(text.length);
  }, [text, displayedLength]);

  return text.slice(0, displayedLength);
}
