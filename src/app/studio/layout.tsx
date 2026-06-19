import { AppHeader } from "@/components/layout/app-header";
import { StudioSidebar } from "@/components/layout/studio-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8 md:flex-row">
        <StudioSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
