"use client";

import { DevToolbar } from "@/components/layout/dev-toolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useData } from "@/lib/data/context";
import { useSession } from "@/lib/data/hooks";
import { formatPoints, formatUSDC, shortAddress, toMicro } from "@/lib/utils";

const COLORS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--border",
  "--border-strong",
  "--text",
  "--text-muted",
  "--text-faint",
  "--status",
  "--status-dim",
  "--money",
  "--money-dim",
  "--danger",
  "--warn",
  "--info",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="text-h2 text-fg">{title}</h2>
      {children}
    </section>
  );
}

export default function KitchenSink() {
  const session = useSession();
  const data = useData();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <span className="mono text-caption text-fg-faint">/dev/kitchen-sink</span>
        <h1 className="text-display-l text-fg">Kitchen sink</h1>
        <p className="text-fg-muted">Все токены и примитивы Фазы 0 в одном месте — для визуального ревью.</p>
      </header>

      <Section title="Цвет (токены)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {COLORS.map((name) => (
            <div key={name} className="flex flex-col gap-2">
              <div
                className="h-14 rounded border border-border"
                style={{ background: `var(${name})` }}
              />
              <span className="mono text-small text-fg-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Типографика">
        <div className="flex flex-col gap-2">
          <p className="text-display-xl">Display XL</p>
          <p className="text-display-l">Display L</p>
          <p className="text-h1">H1 — заголовок секции</p>
          <p className="text-h2">H2 — подсекция</p>
          <p className="text-h3">H3 — карточка</p>
          <p className="text-body">Body — основной текст интерфейса.</p>
          <p className="text-small text-fg-muted">Small — мета-информация.</p>
          <p className="text-caption">Caption / eyebrow</p>
          <p className="mono text-fg">Mono · 1,234.56 · 7xKp…3fQa</p>
        </div>
      </Section>

      <Section title="Форматирование (utils)">
        <div className="mono flex flex-col gap-1 text-small text-fg">
          <span>formatUSDC(toMicro(12.5)) → {formatUSDC(toMicro(12.5))}</span>
          <span>formatUSDC(9_700_000n) → {formatUSDC(9_700_000n)}</span>
          <span>formatPoints(5000) → {formatPoints(5000)}</span>
          <span>shortAddress(&quot;7xKpHnQ9aR4dF2sV3fQa&quot;) → {shortAddress("7xKpHnQ9aR4dF2sV3fQa")}</span>
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="money">Money (финальное)</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Поля ввода">
        <div className="grid max-w-xl gap-4">
          <Input label="Handle канала" placeholder="my-channel" helper="Латиница, цифры, дефис" />
          <Input label="Сумма" mono placeholder="0.00" defaultValue="10.00" />
          <Input label="С ошибкой" defaultValue="bad" error="Адрес невалиден" />
          <Textarea
            label="Сообщение к донату"
            placeholder="Текст…"
            maxLength={200}
            showCount
            helper="Текст приватен до показа (HELD)"
          />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All-time</TabsTrigger>
            <TabsTrigger value="month">Месяц</TabsTrigger>
            <TabsTrigger value="top">Топ-донатёр</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <p className="text-small text-fg-muted">Лидерборд за всё время (заглушка).</p>
          </TabsContent>
          <TabsContent value="month">
            <p className="text-small text-fg-muted">Лидерборд за месяц (заглушка).</p>
          </TabsContent>
          <TabsContent value="top">
            <p className="text-small text-fg-muted">Топ-донатёр месяца (заглушка).</p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Tooltip · Dialog · Toast">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">Наведи (tooltip)</Button>
            </TooltipTrigger>
            <TooltipContent>Standing нельзя купить или передать.</TooltipContent>
          </Tooltip>

          <Dialog>
            <DialogTrigger asChild>
              <Button>Открыть Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Подтверждение</DialogTitle>
                <DialogDescription>
                  Донат необратим. Возврата нет. (Демо диалога, действий нет.)
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Отмена</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="money">Подтвердить</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="secondary"
            onClick={() => toast({ variant: "success", title: "Показано", description: "Сообщение опубликовано." })}
          >
            Toast success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ variant: "error", title: "Ошибка", description: "Не удалось выполнить." })}
          >
            Toast error
          </Button>
        </div>
      </Section>

      <Section title="Состояния (loading / empty / error)">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
          <EmptyState
            title="Пока пусто"
            description="Подключи кошелёк и активируй канал."
            action={<Button size="sm">Активировать</Button>}
          />
          <ErrorState description="Не удалось загрузить." onRetry={() => toast({ title: "Повтор" })} />
        </div>
      </Section>

      <Section title="useData() — смоук-проверка (пустой мок)">
        <div className="mono flex flex-col gap-1 rounded border border-border bg-surface p-4 text-small text-fg">
          <span>getSession(): {session.isLoading ? "loading…" : JSON.stringify(session.data)}</span>
          <span className="text-fg-muted">
            Запрос идёт через useData() → MockDataProvider (NEXT_PUBLIC_DATA_SOURCE).
          </span>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await data.createDonation({ channelId: "demo", amountUSDC: 10 });
              } catch (e) {
                toast({
                  variant: "error",
                  title: "Мутация не реализована (Фаза 0)",
                  description: e instanceof Error ? e.message : String(e),
                });
              }
            }}
          >
            Вызвать createDonation (на guest ожидаем «подключи кошелёк»)
          </Button>
        </div>
      </Section>

      <Section title="Dev-тулбар (сессии · ошибки · фикстуры)">
        <DevToolbar />
      </Section>
    </main>
  );
}
