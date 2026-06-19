/** Универсальная заглушка экрана для Фазы 0 (каркас навигации). Полный UI — в Фазе 1. */
export function PageStub({
  route,
  title,
  subtitle,
  specRef,
  children,
}: {
  route: string;
  title: string;
  subtitle?: string;
  specRef?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="mono text-caption text-fg-faint">{route}</span>
        <h1 className="text-display-l text-fg">{title}</h1>
        {subtitle ? <p className="max-w-2xl text-fg-muted">{subtitle}</p> : null}
      </div>
      <div className="rounded-lg border border-dashed border-border bg-surface px-5 py-4 text-small text-fg-muted">
        Экран-заглушка Фазы 0. Полный UI и состояния собираются в Фазе 1
        {specRef ? (
          <>
            {" "}
            — спека: <span className="mono text-fg">{specRef}</span>
          </>
        ) : null}
        .
      </div>
      {children}
    </section>
  );
}
