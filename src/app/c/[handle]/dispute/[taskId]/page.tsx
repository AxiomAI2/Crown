"use client";

import { useParams } from "next/navigation";
import { DisputePage } from "@/games/escrow-task/DisputePage";

/** Тонкий роут страницы спора: вся логика — в модуле игры (ADR 0016). */
export default function Page() {
  const { handle, taskId } = useParams<{ handle: string; taskId: string }>();
  // taskId может прийти ещё URL-кодированным (старые id содержат «:» из ISO) — декодируем защитно.
  let id = taskId;
  try {
    id = decodeURIComponent(taskId);
  } catch {
    /* битый %-escape — оставляем как есть */
  }
  return <DisputePage handle={handle} taskId={id} />;
}
