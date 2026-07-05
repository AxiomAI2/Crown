import fs from "fs";
import path from "path";
import { decode, encode } from "@/lib/data/codec";

/**
 * Лёгкая локальная персистентность (ADR 0013). Стенд-ин под Postgres (схема — yellow-paper §13): вместо БД —
 * атомарные JSON-снимки на диск в `.data/` (gitignored). Стор/сессии остаются быстрым in-memory, но
 * ПЕРЕЖИВАЮТ перезапуск процесса (раньше всё сбрасывалось при каждом рестарте dev-сервера).
 *
 * Только серверный модуль (использует node:fs) — в клиентский bundle не попадает. bigint-safe (codec).
 * Цена решения честна: один файл целиком в памяти (ок для dev-масштаба), запись троттлится (≤1/250мс),
 * так что при жёстком kill можно потерять последние <250мс изменений. Для прод-масштаба → реальная БД.
 */
const DIR = path.join(process.cwd(), ".data");

/** Синхронное чтение снимка при старте (один раз, маленький файл). null — нет файла или он битый. */
export function readSnapshot<T>(name: string): T | null {
  try {
    return decode<T>(fs.readFileSync(path.join(DIR, name), "utf8"));
  } catch {
    return null; // нет файла / повреждён → стартуем с чистого состояния
  }
}

/** Атомарная запись: tmp + rename — не оставляет полуфайл при сбое посреди записи. */
function writeAtomic(name: string, data: string): void {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Троттл-сейвер: при вызове планирует атомарную запись свежего getData() не чаще раза в 250мс, коалесцируя
 * всплески мутаций; последнее изменение всегда долетает (флаг снимается ПЕРЕД записью). Ошибку записи не
 * пробрасываем в запрос — логируем (диск не должен ронять RPC).
 */
export function makeSaver(name: string, getData: () => unknown): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        writeAtomic(name, encode(getData()));
      } catch (e) {
        console.error(`[persist] не удалось сохранить ${name}:`, e);
      }
    }, 250);
  };
}
