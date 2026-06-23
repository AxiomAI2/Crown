import { useEffect, useRef } from "react";

/**
 * Панель закреплена на экране (position: fixed в CSS) и стоит статично при скролле. Когда снизу подходит
 * футер — панель упирается в него низом и едет ВВЕРХ вместе с ним (translateY), а её верхняя часть уходит
 * ПОД хедер (хедер выше по z-index и перекрывает её) — как «отрыв» у sticky. Пока футер далеко — transform
 * пустой, панель неподвижна. Высоту ограничивает CSS max-height (≤ зазор), поэтому подъём начинается ровно
 * когда футер достаёт до низа панели. Активно только пока панель fixed (на мобиле — no-op).
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
        if (el.style.transform) el.style.transform = "";
        return;
      }
      const top = parseFloat(cs.top) || 0;
      const height = el.offsetHeight; // ограничена CSS max-height; не зависит от transform
      const footerTop = footer.getBoundingClientRect().top;
      const overlap = top + height - footerTop; // насколько низ панели зашёл бы на футер
      const next = overlap > 0 ? `translateY(${-overlap}px)` : "";
      if (el.style.transform !== next) el.style.transform = next;
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
