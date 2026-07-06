#!/usr/bin/env bash
# up.sh — поднять весь локальный стек Standing одной командой (после ребута/выключения).
#   Канистра ICP (эфемерная реплика dfx, стейт стирается при выключении → каждый раз --clean+deploy;
#   журнал репутации пересобирается из devnet сам, ~1-2 мин) + Next dev-сервер (фронт+бэкенд+индексер).
# Использование:  ./up.sh
# Логи:           scratchpad/dfx-start.log, scratchpad/dev-server.log
# Остановить всё: ./up.sh stop
set -u

ROOT="/home/jab/Documents/Reputation Donations"
LOGDIR="/tmp/claude-1000/-home-jab-Documents-Reputation-Donations/8fb30172-4498-451f-948a-07699cd15772/scratchpad"
CANISTER_ID="uxrrr-q7777-77774-qaaaq-cai"
CANISTER_URL="http://${CANISTER_ID}.raw.localhost:4943"

export PATH="$HOME/.local/nodejs/bin:$HOME/.local/share/dfx/bin:$PATH"
export XDG_DATA_HOME="$HOME/.local/share"

mkdir -p "$LOGDIR"

stop_all() {
  echo "→ Останавливаю dev-сервер и канистру…"
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  (cd "$ROOT/canister" && dfx stop >/dev/null 2>&1)
  echo "  готово."
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  exit 0
fi

# ./up.sh web — перезапустить ТОЛЬКО фронт (снести .next + рестарт dev-сервера), канистру не трогать.
# Это лечение ошибки «Cannot find module './vendor-chunks/…'» (битый .next от частых HMR-перекомпиляций).
start_web() {
  echo "→ Dev-сервер: kill + чистка .next + старт…"
  pkill -9 -f "next-server" 2>/dev/null; pkill -9 -f "next dev" 2>/dev/null; sleep 1
  rm -rf "$ROOT/.next"
  (cd "$ROOT" && nohup npm run dev > "$LOGDIR/dev-server.log" 2>&1 & disown)
  echo "→ Жду готовности сервера…"
  for i in $(seq 1 45); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000 2>/dev/null)" = "200" ]; then
      echo "  сервер готов (~$((i*2))с). Открывай http://localhost:3000"
      return 0
    fi
    sleep 2
  done
  echo "  ⚠ сервер не поднялся за 90с — смотри $LOGDIR/dev-server.log"
}

if [ "${1:-}" = "web" ]; then
  start_web
  exit 0
fi

echo "=== Standing up ==="

# 1) Канистра ICP (нужна режиму NEXT_PUBLIC_DATA_SOURCE=icp; для chain-режима её можно не поднимать)
echo "→ Канистра: чистый старт реплики…"
(cd "$ROOT/canister" && dfx stop >/dev/null 2>&1); sleep 1
(cd "$ROOT/canister" && setsid nohup dfx start --clean --background > "$LOGDIR/dfx-start.log" 2>&1 < /dev/null)
sleep 4
if (cd "$ROOT/canister" && dfx ping 2>/dev/null | grep -q healthy); then
  echo "  реплика healthy."
else
  echo "  ⚠ реплика не поднялась — смотри $LOGDIR/dfx-start.log"
fi

echo "→ Канистра: деплой core…"
(cd "$ROOT/canister" && dfx deploy core --argument '(record {
  rpc_url = "https://api.devnet.solana.com";
  treasury_ata = "GzBQqH16CHT5m8v5JWAG6fTPcRohTfZQFvgW8Jx8AoKX";
  usdc_mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
  poll_secs = 20 : nat64;
  escrow_program = opt "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4";
  schnorr_key_name = opt "key_1" })' 2>&1 | grep -E "Installed code|Reinstalled|Error|error" | head -2)

# 2) Dev-сервер (фронт + бэкенд + индексер). .next чистим — ребут = жёсткий kill (грабля runbook).
echo "→ Dev-сервер: чистка .next и старт…"
rm -rf "$ROOT/.next"
(cd "$ROOT" && nohup npm run dev > "$LOGDIR/dev-server.log" 2>&1 & disown)

echo "→ Жду готовности сервера…"
for i in $(seq 1 45); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000 2>/dev/null)" = "200" ]; then
    echo "  сервер готов (~$((i*2))с)."
    break
  fi
  sleep 2
done

echo ""
echo "=== Статус ==="
printf "  dev-сервер :3000  → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000 2>/dev/null || echo down)"
printf "  канистра   :4943  → %s\n" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve ${CANISTER_ID}.raw.localhost:4943:127.0.0.1 ${CANISTER_URL}/status 2>/dev/null || echo down)"
echo ""
echo "Открывай http://localhost:3000"
echo "(Канистра ещё минуту-две добирает журнал репутации из devnet — профиль загрузится сразу, цифры дозаполнятся.)"
