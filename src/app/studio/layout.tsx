import { AppHeader } from "@/components/layout/app-header";
import { StudioSidebar } from "@/components/layout/studio-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {/* На md — грид [14rem_1fr]: сайдбар фиксируется (rail-pinned-left), а его трек остаётся
          зарезервированным, поэтому контент не плывёт. На мобиле — стопкой. */}
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 pb-8 pt-4 md:grid md:grid-cols-[14rem_1fr] md:items-start">
        <StudioSidebar />
        {/* col-start-2: сайдбар на md фиксирован (вне грида), поэтому контент ЯВНО кладём во 2-й трек,
            иначе единственный оставшийся ребёнок ушёл бы в 1-й (14rem) и сжался. */}
        <main className="min-w-0 md:col-start-2">{children}</main>
      </div>
    </>
  );
}
