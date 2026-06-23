import { useEffect, useRef } from "react";

/**
 * Панель закреплена на экране (position: fixed задаётся в CSS) и НЕ двигается при скролле. Чтобы она не
 * налезала на футер, ограничиваем её ВЫСОТУ (не положение!): низ панели упирается в верх футера (или в низ
 * вьюпорта, что выше), а верх остаётся прибит под хедером. Поэтому нет ни «бездны» (верх никогда не уходит
 * под хедер), ни перекрытия футера. Если контент выше доступной высоты — внутренний скролл (ползунок скрыт).
 * Активно только пока панель реально fixed (на мобиле — no-op, maxHeight сбрасывается).
 */
export function usePinAboveFooter<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    const footer = document.querySelector("footer");
    if (!el || !footer) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") {
        if (el.style.maxHeight) el.style.maxHeight = "";
        return;
      }
      const top = parseFloat(cs.top) || 0;
      const footerTop = footer.getBoundingClientRect().top;
      const margin = 12; // небольшой зазор до футера/края
      const bottomLimit = Math.min(window.innerHeight, footerTop) - margin;
      el.style.maxHeight = `${Math.max(120, bottomLimit - top)}px`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
