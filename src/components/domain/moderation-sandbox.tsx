"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Verdict = "CLEAR" | "FLAG" | "HARD_BLOCK";

const VERDICT: Record<Verdict, { cls: string; note: string }> = {
  CLEAR: { cls: "border-money text-money", note: "Passes — published/allowed." },
  FLAG: { cls: "border-warn text-warn", note: "In HELD — awaiting the content maker's manual decision." },
  HARD_BLOCK: { cls: "border-danger text-danger", note: "Block + quarantine + T&S incident." },
};

interface ModCheck {
  usingOpenAi: boolean;
  engine: string;
  lang: string;
  hash: string;
  message: Verdict;
  task: Verdict;
}

/**
 * Moderation sandbox: type in text → run it through the SAME production pipeline (server-side /api/dev/moderation:
 * crown-message policy + task-text policy) → a CLEAR | FLAG | HARD_BLOCK verdict. With a server-side
 * OPENAI_API_KEY, OpenAI/ChatGPT judges; without one, a local dictionary (highlighted). Nothing is saved.
 */
export function ModerationSandbox() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ModCheck | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/dev/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: "Couldn't check", description: data?.error ?? String(res.status) });
        return;
      }
      setResult(data as ModCheck);
    } catch (e) {
      toast({ variant: "error", title: "Error", description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <Textarea
        label="Text to check"
        placeholder="e.g. great stream! · kill him · child porn"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <Button variant="secondary" loading={loading} disabled={!text.trim()} onClick={check}>
          Check
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Donation message</span>
              <span className={cn("rounded border px-1.5 py-0.5 text-caption", VERDICT[result.message].cls)}>
                {result.message}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Task text</span>
              <span className={cn("rounded border px-1.5 py-0.5 text-caption", VERDICT[result.task].cls)}>
                {result.task}
              </span>
            </div>
          </div>
          <p className="text-small text-fg-muted">{VERDICT[result.message].note}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-faint">
            <span>engine: {result.engine}</span>
            <span>lang: {result.lang}</span>
            <span className="mono">hash: {result.hash}</span>
          </div>
          {!result.usingOpenAi ? (
            <p className="rounded border border-border bg-surface-raised p-2 text-caption text-fg-muted">
              A local dictionary is currently active (a couple of explicit markers + a CSAM regex). To check via
              OpenAI/ChatGPT, set a server-side <span className="mono">OPENAI_API_KEY</span>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
