import type { Config } from "tailwindcss";

/**
 * Токены — единственный источник истины в `src/app/globals.css` (`:root`, CSS-переменные).
 * Здесь мы лишь пробрасываем их в утилиты Tailwind (design-system.md §8). Никаких сырых hex.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-2)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        // регистр текста: text-fg / text-fg-muted / text-fg-faint
        fg: {
          DEFAULT: "var(--text)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
        },
        // акцент СТАТУСА (заработанное, «отчеканенное»)
        status: {
          DEFAULT: "var(--status)",
          dim: "var(--status-dim)",
          bg: "var(--status-bg)",
        },
        // акцент ДЕНЕГ — строго под подтверждённое/финальное (Crown/транзакции)
        money: {
          DEFAULT: "var(--money)",
          dim: "var(--money-dim)",
          bg: "var(--money-bg)",
          bright: "var(--money-bright)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          bg: "var(--danger-bg)",
        },
        warn: "var(--warn)",
        info: "var(--info)",
        success: {
          DEFAULT: "var(--success)",
          bg: "var(--success-bg)",
        },
      },
      fontFamily: {
        display: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        8: "var(--space-8)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      maxWidth: {
        content: "var(--maxw)",
      },
      transitionTimingFunction: {
        ease: "var(--ease)",
      },
      transitionDuration: {
        fast: "120ms",
        DEFAULT: "200ms",
        slow: "320ms",
      },
    },
  },
  plugins: [],
};

export default config;
