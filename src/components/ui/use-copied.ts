"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Флаг «скопировано» с авто-сбросом. Таймер очищается при размонтировании — иначе `setCopied(false)`
 * стрелял бы по уже размонтированному компоненту (закрытое меню / уход со страницы). Возвращает [copied, mark]:
 * `mark()` зовётся после успешного `clipboard.writeText`.
 */
export function useCopied(resetMs = 1500): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mark = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetMs);
  };
  return [copied, mark];
}
