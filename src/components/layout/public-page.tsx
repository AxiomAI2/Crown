import { AppHeader } from "./app-header";
import { PageStub } from "@/components/page-stub";

/** Публичный экран = шапка + контейнер + заглушка (Фаза 0). */
export function PublicPage(props: {
  route: string;
  title: string;
  subtitle?: string;
  specRef?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-content px-4 py-8">
        <PageStub {...props} />
      </main>
    </>
  );
}
