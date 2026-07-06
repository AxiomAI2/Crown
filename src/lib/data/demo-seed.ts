/**
 * DEMO DATA for the browser mock (NEXT_PUBLIC_DATA_SOURCE=mock). For UI/UX development only (Phase 1):
 * populates the empty in-browser store with realms, profiles, crowns and messages, so the screens look
 * like a working product (discovery, realm page, leaderboards, profiles, studio, moderation queue).
 *
 * IMPORTANT: these are NOT core fixtures. The server (api/chain) doesn't see them — there identity = the real wallet address,
 * and realms are created by users. The seed is applied exclusively to the browser mock via
 * `createDataProvider("mock")` → `MockDataProvider.seedDemo()`. To disable: NEXT_PUBLIC_DEMO_SEED=off.
 *
 * Numbers/texts are arbitrary demo content, not the spec. Edit freely to suit the UI.
 */
import type { ResolutionReason, TaskOutcome, TaskStatus, VoteChoice } from "../../games/escrow-task/types";
import type { ChannelLinkPlatform } from "./types";

export interface DemoLink {
  platform: ChannelLinkPlatform;
  url: string;
}

export interface DemoDonation {
  /** supporter label (→ deterministic address via demoAddress) */
  donor: string;
  usdc: number;
  daysAgo: number;
  /** optional crown text; without text — a "silent" crown */
  text?: string;
  /** text display state (default SHOWN) */
  state?: "SHOWN" | "HELD" | "HIDDEN";
}

export interface DemoChannel {
  handle: string;
  /** owner label (→ address) */
  owner: string;
  /** owner name (profile) */
  name: string;
  /** owner avatar URL (external image, rendered with a plain <img> in Monogram) */
  avatar: string;
  bio: string;
  /** realm tagline (description) */
  description: string;
  links: DemoLink[];
  donations: DemoDonation[];
  /** Mini-games turned on for this realm — ids from the `src/games` registry (e.g. "escrow-task"). Omitted = none. */
  enabledGames?: string[];
}

/** A juror's vote inside a demo dispute (weight = reputation snapshot, display-only in the mock). */
export interface DemoTaskVote {
  voter: string; // supporter label → deterministic address
  choice: VoteChoice; // "completed" | "not_completed"
  weight: number; // reputation at the snapshot (any plausible number — mock display)
  daysAgo: number;
}

/**
 * A demo escrow task (mini-game G3a). `channel` MUST be a realm with escrow-task enabled. Timings are relative
 * (…DaysAgo); the mock builder turns them into a task with LONG deadlines so it survives the 2-min FAST_TEST_WINDOWS
 * and stays in its seeded state (a fresh task would otherwise expire ~2 min after load).
 */
export interface DemoTask {
  channel: string; // realm handle
  donor: string; // supporter label
  usdc: number;
  text: string;
  status: TaskStatus;
  createdDaysAgo: number;
  textState?: "SHOWN" | "HELD" | "HIDDEN"; // default SHOWN
  /** DISPUTED only: the open dispute + its live tally. */
  dispute?: { by: string; openedDaysAgo: number; quorum: number; votes: DemoTaskVote[] };
  /** RESOLVED only: the final outcome (to_streamer is banked to the ledger; a to_donor refund is reputation-neutral). */
  resolution?: { outcome: TaskOutcome; reason: ResolutionReason; resolvedDaysAgo: number };
}

/** Supporter names by label — shown in the leaderboard/feed if the realm allows display names. */
export const DEMO_NAMES: Record<string, string> = {
  max: "Max R.",
  lena: "Lena ✦",
  kirill: "Kirill",
  sonya: "Sonya",
  artem: "Artem",
  vika: "Vika",
  grisha: "Greg",
  dana: "Dana",
  oleg: "Oleg",
  yulia: "Julia",
  roma: "Roma",
  nastya: "Nastya",
  whalemoon: "WhaleMoon",
  bigbag: "AnonWhale",
  glitch: "glitch_",
  goldwhale: "GoldWhale",
  felix: "Felix",
  mia: "Mia",
  ivan: "Ivan",
  zoe: "Zoe",
  cosmo: "Cosmo",
  luna: "Luna",
  // anon1/anon2 deliberately have no name — we're testing the addresses_only branch (short address instead of a nickname).
};

/**
 * Deterministic pseudo-Solana address (44 base58 chars) from a label. Stable across renders (SSR=CSR),
 * time-independent → the seed is reproducible. Not a real key, only for display in the mock.
 */
export function demoAddress(label: string): string {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // without 0,O,I,l
  let h = 2166136261 >>> 0; // FNV-1a
  const out: string[] = [];
  for (let i = 0; i < 44; i++) {
    for (let j = 0; j < label.length; j++) h = Math.imul(h ^ label.charCodeAt(j), 16777619) >>> 0;
    h = Math.imul(h ^ (i + 7), 16777619) >>> 0;
    out.push(B58.charAt(h % 58));
  }
  return out.join("");
}

export const DEMO_CHANNELS: DemoChannel[] = [
  {
    handle: "pixelqueen",
    owner: "owner-pixel",
    name: "PixelQueen",
    avatar: "https://i.pravatar.cc/300?img=47",
    bio: "Pixel art, live. Thursdays — collab canvases with chat.",
    description: "Pixel art & variety. Come draw with me.",
    links: [
      { platform: "twitch", url: "twitch.tv/pixelqueen" },
      { platform: "x", url: "x.com/pixelqueen" },
      { platform: "instagram", url: "instagram.com/pixelqueen" },
      { platform: "onlyfans", url: "onlyfans.com/pixelqueen" },
    ],
    donations: [
      { donor: "whalemoon", usdc: 61000, daysAgo: 44, text: "For your new tablet — you're the best!", state: "SHOWN" },
      { donor: "lena", usdc: 5400, daysAgo: 30, text: "Best art realm on Solana ✦", state: "SHOWN" },
      { donor: "max", usdc: 3200, daysAgo: 21, text: "This canvas is a masterpiece", state: "SHOWN" },
      { donor: "max", usdc: 900, daysAgo: 4 },
      { donor: "artem", usdc: 640, daysAgo: 26, text: "can't wait for the collab!", state: "SHOWN" },
      { donor: "kirill", usdc: 300, daysAgo: 12 },
      { donor: "sonya", usdc: 220, daysAgo: 6, text: "thanks for the vibe, made my day", state: "HELD" },
      { donor: "vika", usdc: 90, daysAgo: 3, text: "first crown here :)", state: "HELD" },
      { donor: "anon1", usdc: 40, daysAgo: 2 },
      { donor: "glitch", usdc: 15, daysAgo: 1, text: "spam-spam read me on stream", state: "HIDDEN" },
    ],
  },
  {
    handle: "lofimira",
    owner: "owner-mira",
    name: "Mira",
    avatar: "https://i.pravatar.cc/300?img=44",
    bio: "Lo-fi, synths and late-night jams. Live production, taking requests.",
    description: "Lo-fi & synth jams every night.",
    links: [
      { platform: "youtube", url: "youtube.com/@lofimira" },
      { platform: "telegram", url: "t.me/lofimira" },
      { platform: "tiktok", url: "tiktok.com/@lofimira" },
      { platform: "onlyfans", url: "onlyfans.com/lofimira" },
    ],
    donations: [
      { donor: "max", usdc: 8200, daysAgo: 33, text: "your jams save my deadlines", state: "SHOWN" },
      { donor: "dana", usdc: 5100, daysAgo: 28, text: "play something for the rain", state: "SHOWN" },
      { donor: "roma", usdc: 1600, daysAgo: 15 },
      { donor: "yulia", usdc: 780, daysAgo: 9, text: "happy birthday!! 🎂", state: "SHOWN" },
      { donor: "nastya", usdc: 520, daysAgo: 5, text: "request: 80s synthwave", state: "HELD" },
      { donor: "kirill", usdc: 240, daysAgo: 11 },
      { donor: "anon2", usdc: 60, daysAgo: 2 },
      { donor: "vika", usdc: 30, daysAgo: 1, text: "I look for you every evening", state: "HELD" },
    ],
  },
  {
    handle: "raidboss",
    owner: "owner-raid",
    name: "RaidBoss",
    avatar: "https://i.pravatar.cc/300?img=12",
    bio: "Hardcore, no saves. Beat it or delete my account (not).",
    description: "Soulslikes at zero damage. Watch me suffer.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "twitch", url: "twitch.tv/raidboss" },
      { platform: "kick", url: "kick.com/raidboss" },
      { platform: "x", url: "x.com/raidboss" },
    ],
    donations: [
      { donor: "bigbag", usdc: 250000, daysAgo: 60, text: "A legend. Simply a legend.", state: "SHOWN" },
      { donor: "whalemoon", usdc: 42000, daysAgo: 38, text: "no-hit run or nothing", state: "SHOWN" },
      { donor: "oleg", usdc: 6100, daysAgo: 22, text: "you'll beat the boss!", state: "SHOWN" },
      { donor: "max", usdc: 4300, daysAgo: 18 },
      { donor: "grisha", usdc: 1100, daysAgo: 14, text: "one match at the end of stream", state: "SHOWN" },
      { donor: "artem", usdc: 560, daysAgo: 7, text: "GG", state: "SHOWN" },
      { donor: "roma", usdc: 200, daysAgo: 4 },
      { donor: "anon1", usdc: 75, daysAgo: 2, text: "cheat crown read out loud", state: "HELD" },
    ],
  },
  {
    handle: "marinacooks",
    owner: "owner-marina",
    name: "Marina Cooks",
    avatar: "https://i.pravatar.cc/300?img=45",
    bio: "Cooking together, live. Simple recipes and lots of spice.",
    description: "Cooking streams. Tonight — tom yum.",
    links: [
      { platform: "youtube", url: "youtube.com/@marinacooks" },
      { platform: "instagram", url: "instagram.com/marinacooks" },
    ],
    donations: [
      { donor: "yulia", usdc: 5300, daysAgo: 27, text: "the borscht recipe, please", state: "SHOWN" },
      { donor: "max", usdc: 2100, daysAgo: 16, text: "second time cooking your dish", state: "SHOWN" },
      { donor: "nastya", usdc: 900, daysAgo: 10 },
      { donor: "dana", usdc: 610, daysAgo: 6, text: "say hi to your mom!", state: "SHOWN" },
      { donor: "grisha", usdc: 180, daysAgo: 3, text: "add garlic, don't be shy", state: "HELD" },
      { donor: "anon2", usdc: 45, daysAgo: 1 },
    ],
  },
  {
    handle: "devbyte",
    owner: "owner-dev",
    name: "Devbyte",
    avatar: "https://i.pravatar.cc/300?img=33",
    bio: "Writing open source, live. Rust, TypeScript, and too much coffee.",
    description: "Live coding and viewer PR reviews.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "youtube", url: "youtube.com/@devbyte" },
      { platform: "telegram", url: "t.me/devbyte" },
    ],
    donations: [
      { donor: "max", usdc: 5200, daysAgo: 24, text: "thanks for the Solana stream!", state: "SHOWN" },
      { donor: "glitch", usdc: 3400, daysAgo: 19, text: "review my PR pls", state: "SHOWN" },
      { donor: "oleg", usdc: 1300, daysAgo: 12 },
      { donor: "kirill", usdc: 700, daysAgo: 8, text: "which editor font?", state: "SHOWN" },
      { donor: "roma", usdc: 260, daysAgo: 5, text: "types question, for the stream", state: "HELD" },
      { donor: "anon1", usdc: 30, daysAgo: 1 },
    ],
  },
  {
    handle: "latenight",
    owner: "owner-late",
    name: "Late Night",
    avatar: "https://i.pravatar.cc/300?img=51",
    bio: "Late-night talks about everything. Guests, music, calls from chat.",
    description: "After-midnight talk show. Tune in and stay.",
    links: [
      { platform: "twitch", url: "twitch.tv/latenight" },
      { platform: "tiktok", url: "tiktok.com/@latenight" },
    ],
    donations: [
      { donor: "whalemoon", usdc: 51000, daysAgo: 41, text: "best late show, no contest", state: "SHOWN" },
      { donor: "lena", usdc: 4200, daysAgo: 23, text: "invite that astronomer guest again", state: "SHOWN" },
      { donor: "max", usdc: 1500, daysAgo: 13 },
      { donor: "sonya", usdc: 880, daysAgo: 9, text: "play that song at the end ❤", state: "SHOWN" },
      { donor: "vika", usdc: 340, daysAgo: 5 },
      { donor: "nastya", usdc: 120, daysAgo: 2, text: "call from chat, I'm in", state: "HELD" },
      { donor: "anon2", usdc: 25, daysAgo: 1 },
    ],
  },
  {
    handle: "novapaints",
    owner: "owner-nova",
    name: "Nova",
    avatar: "https://i.pravatar.cc/300?img=5",
    bio: "Digital painting from blank canvas to finished piece. Requests open.",
    description: "Digital painting & concept art, live.",
    links: [
      { platform: "youtube", url: "youtube.com/@novapaints" },
      { platform: "instagram", url: "instagram.com/novapaints" },
      { platform: "x", url: "x.com/novapaints" },
    ],
    donations: [
      { donor: "goldwhale", usdc: 38000, daysAgo: 40, text: "your brushwork is unreal", state: "SHOWN" },
      { donor: "max", usdc: 2600, daysAgo: 20 },
      { donor: "mia", usdc: 1400, daysAgo: 12, text: "paint a phoenix pls", state: "SHOWN" },
      { donor: "sonya", usdc: 300, daysAgo: 4 },
      { donor: "anon1", usdc: 20, daysAgo: 1 },
    ],
  },
  {
    handle: "flashrun",
    owner: "owner-flash",
    name: "FlashRun",
    avatar: "https://i.pravatar.cc/300?img=13",
    bio: "Any% speedruns and world-record attempts every weekend.",
    description: "Speedrunning classics. WR or bust.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "twitch", url: "twitch.tv/flashrun" },
      { platform: "x", url: "x.com/flashrun" },
      { platform: "kick", url: "kick.com/flashrun" },
    ],
    donations: [
      { donor: "whalemoon", usdc: 27000, daysAgo: 35, text: "sub-20 or I riot", state: "SHOWN" },
      { donor: "oleg", usdc: 3200, daysAgo: 18 },
      { donor: "ivan", usdc: 900, daysAgo: 9, text: "frame-perfect, insane", state: "SHOWN" },
      { donor: "roma", usdc: 140, daysAgo: 3 },
    ],
  },
  {
    handle: "rooknroll",
    owner: "owner-rook",
    name: "RookNRoll",
    avatar: "https://i.pravatar.cc/300?img=15",
    bio: "Blitz, puzzles and viewer games. GM guest streams monthly.",
    description: "Chess — blitz & puzzles with chat.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "twitch", url: "twitch.tv/rooknroll" },
      { platform: "youtube", url: "youtube.com/@rooknroll" },
    ],
    donations: [
      { donor: "kirill", usdc: 4100, daysAgo: 25, text: "teach the London please", state: "SHOWN" },
      { donor: "max", usdc: 1200, daysAgo: 14 },
      { donor: "zoe", usdc: 520, daysAgo: 6, text: "brilliant sac!", state: "SHOWN" },
      { donor: "anon2", usdc: 35, daysAgo: 2 },
    ],
  },
  {
    handle: "fitwithkira",
    owner: "owner-fit",
    name: "Kira",
    avatar: "https://i.pravatar.cc/300?img=20",
    bio: "Home workouts, no equipment. 30-day challenges with the community.",
    description: "Live workouts. Sweat with me.",
    links: [
      { platform: "instagram", url: "instagram.com/fitwithkira" },
      { platform: "youtube", url: "youtube.com/@fitwithkira" },
      { platform: "tiktok", url: "tiktok.com/@fitwithkira" },
    ],
    donations: [
      { donor: "yulia", usdc: 3300, daysAgo: 22, text: "day 14 done thanks to you!", state: "SHOWN" },
      { donor: "dana", usdc: 1800, daysAgo: 15 },
      { donor: "vika", usdc: 640, daysAgo: 7, text: "abs routine when?", state: "SHOWN" },
      { donor: "luna", usdc: 90, daysAgo: 2 },
    ],
  },
  {
    handle: "astronyx",
    owner: "owner-astro",
    name: "AstroNyx",
    avatar: "https://i.pravatar.cc/300?img=23",
    bio: "Live telescope streams and deep-sky tours. Ask me anything about space.",
    description: "Stargazing from the backyard observatory.",
    links: [
      { platform: "youtube", url: "youtube.com/@astronyx" },
      { platform: "twitch", url: "twitch.tv/astronyx" },
      { platform: "telegram", url: "t.me/astronyx" },
    ],
    donations: [
      { donor: "cosmo", usdc: 15000, daysAgo: 30, text: "for the new telescope mount 🔭", state: "SHOWN" },
      { donor: "max", usdc: 2100, daysAgo: 16 },
      { donor: "lena", usdc: 800, daysAgo: 8, text: "show us Saturn again", state: "SHOWN" },
      { donor: "grisha", usdc: 120, daysAgo: 3 },
    ],
  },
  {
    handle: "beatlab",
    owner: "owner-beat",
    name: "BeatLab",
    avatar: "https://i.pravatar.cc/300?img=25",
    bio: "Making beats from scratch, live. Sample flips and mixing tips.",
    description: "Beat-making & mixing sessions.",
    links: [
      { platform: "youtube", url: "youtube.com/@beatlab" },
      { platform: "instagram", url: "instagram.com/beatlab" },
      { platform: "telegram", url: "t.me/beatlab" },
    ],
    donations: [
      { donor: "roma", usdc: 5600, daysAgo: 26, text: "that flip was filthy 🔥", state: "SHOWN" },
      { donor: "artem", usdc: 1900, daysAgo: 13 },
      { donor: "felix", usdc: 700, daysAgo: 6, text: "drop the sample pack", state: "SHOWN" },
      { donor: "anon1", usdc: 40, daysAgo: 1 },
    ],
  },
  {
    handle: "yarncafe",
    owner: "owner-yarn",
    name: "YarnCafe",
    avatar: "https://i.pravatar.cc/300?img=28",
    bio: "Cozy crochet streams. Beginner-friendly patterns every Sunday.",
    description: "Crochet & crafts. Grab your hook.",
    links: [
      { platform: "youtube", url: "youtube.com/@yarncafe" },
      { platform: "instagram", url: "instagram.com/yarncafe" },
    ],
    donations: [
      { donor: "nastya", usdc: 2200, daysAgo: 21, text: "the amigurumi pattern pls!", state: "SHOWN" },
      { donor: "mia", usdc: 900, daysAgo: 11 },
      { donor: "dana", usdc: 260, daysAgo: 4, text: "so relaxing to watch", state: "SHOWN" },
    ],
  },
  {
    handle: "retroarcade",
    owner: "owner-retro",
    name: "RetroArcade",
    avatar: "https://i.pravatar.cc/300?img=31",
    bio: "80s and 90s classics on original hardware. CRT and all.",
    description: "Retro gaming on real hardware.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "twitch", url: "twitch.tv/retroarcade" },
      { platform: "x", url: "x.com/retroarcade" },
      { platform: "kick", url: "kick.com/retroarcade" },
    ],
    donations: [
      { donor: "bigbag", usdc: 41000, daysAgo: 45, text: "for the arcade cabinet resto", state: "SHOWN" },
      { donor: "oleg", usdc: 2700, daysAgo: 17 },
      { donor: "kirill", usdc: 480, daysAgo: 5, text: "any% on the SNES one?", state: "SHOWN" },
      { donor: "anon2", usdc: 30, daysAgo: 1 },
    ],
  },
  {
    handle: "sushisan",
    owner: "owner-sushi",
    name: "SushiSan",
    avatar: "https://i.pravatar.cc/300?img=36",
    bio: "Sushi and Japanese home cooking, live. Knife skills and plating.",
    description: "Sushi-making streams. Itadakimasu.",
    links: [
      { platform: "youtube", url: "youtube.com/@sushisan" },
      { platform: "instagram", url: "instagram.com/sushisan" },
      { platform: "tiktok", url: "tiktok.com/@sushisan" },
    ],
    donations: [
      { donor: "yulia", usdc: 3900, daysAgo: 24, text: "the nigiri technique 🍣", state: "SHOWN" },
      { donor: "max", usdc: 1100, daysAgo: 12 },
      { donor: "zoe", usdc: 450, daysAgo: 5, text: "where do you get the fish?", state: "SHOWN" },
      { donor: "anon1", usdc: 25, daysAgo: 1 },
    ],
  },
  {
    handle: "paintpal",
    owner: "owner-bob",
    name: "PaintPal",
    avatar: "https://i.pravatar.cc/300?img=40",
    bio: "Happy little landscapes, one stream at a time. Oils and calm vibes.",
    description: "Relaxing landscape painting.",
    links: [
      { platform: "youtube", url: "youtube.com/@paintpal" },
      { platform: "twitch", url: "twitch.tv/paintpal" },
    ],
    donations: [
      { donor: "lena", usdc: 6100, daysAgo: 29, text: "happy little donation ☺", state: "SHOWN" },
      { donor: "sonya", usdc: 1400, daysAgo: 14 },
      { donor: "luna", usdc: 380, daysAgo: 6, text: "add a happy little tree", state: "SHOWN" },
    ],
  },
  {
    handle: "codegolf",
    owner: "owner-golf",
    name: "CodeGolf",
    avatar: "https://i.pravatar.cc/300?img=52",
    bio: "Solving puzzles in the fewest bytes possible. Regex crimes included.",
    description: "Competitive coding & code golf.",
    enabledGames: ["escrow-task"],
    links: [
      { platform: "youtube", url: "youtube.com/@codegolf" },
      { platform: "telegram", url: "t.me/codegolf" },
      { platform: "x", url: "x.com/codegolf" },
    ],
    donations: [
      { donor: "glitch", usdc: 4700, daysAgo: 27, text: "one-liner that in Perl, coward", state: "SHOWN" },
      { donor: "ivan", usdc: 1600, daysAgo: 13 },
      { donor: "felix", usdc: 500, daysAgo: 5, text: "explain the bitwise trick", state: "SHOWN" },
      { donor: "anon2", usdc: 20, daysAgo: 1 },
    ],
  },
  {
    handle: "yogaflow",
    owner: "owner-yoga",
    name: "Maya",
    avatar: "https://i.pravatar.cc/300?img=26",
    bio: "Morning yoga and breathwork. All levels welcome, mats optional.",
    description: "Morning yoga & breathwork.",
    links: [
      { platform: "instagram", url: "instagram.com/yogaflow" },
      { platform: "youtube", url: "youtube.com/@yogaflow" },
    ],
    donations: [
      { donor: "vika", usdc: 2100, daysAgo: 19, text: "best way to start the day", state: "SHOWN" },
      { donor: "nastya", usdc: 760, daysAgo: 9 },
      { donor: "mia", usdc: 200, daysAgo: 3, text: "hold the pose longer!", state: "SHOWN" },
    ],
  },
  {
    handle: "petpals",
    owner: "owner-pet",
    name: "PetPals",
    avatar: "https://i.pravatar.cc/300?img=48",
    bio: "Rescue cats and dogs, live. Adoption updates and a lot of zoomies.",
    description: "Rescue pet streams. Meet the crew.",
    links: [
      { platform: "tiktok", url: "tiktok.com/@petpals" },
      { platform: "instagram", url: "instagram.com/petpals" },
      { platform: "youtube", url: "youtube.com/@petpals" },
    ],
    donations: [
      { donor: "goldwhale", usdc: 22000, daysAgo: 33, text: "for the shelter vet bills 🐾", state: "SHOWN" },
      { donor: "dana", usdc: 1500, daysAgo: 15 },
      { donor: "zoe", usdc: 340, daysAgo: 6, text: "name the tabby after me?", state: "SHOWN" },
      { donor: "anon1", usdc: 15, daysAgo: 1 },
    ],
  },
  {
    handle: "djmix",
    owner: "owner-mix",
    name: "DJ Mix",
    avatar: "https://i.pravatar.cc/300?img=55",
    bio: "Live DJ sets — house, techno, and the occasional guilty-pleasure remix.",
    description: "Live DJ sets every Friday.",
    links: [
      { platform: "twitch", url: "twitch.tv/djmix" },
      { platform: "instagram", url: "instagram.com/djmix" },
      { platform: "tiktok", url: "tiktok.com/@djmix" },
    ],
    donations: [
      { donor: "whalemoon", usdc: 33000, daysAgo: 37, text: "drop the bass at midnight", state: "SHOWN" },
      { donor: "roma", usdc: 2400, daysAgo: 16 },
      { donor: "felix", usdc: 680, daysAgo: 7, text: "track ID pls!!", state: "SHOWN" },
      { donor: "anon2", usdc: 30, daysAgo: 2 },
    ],
  },
  {
    handle: "talehunter",
    owner: "owner-tale",
    name: "TaleHunter",
    avatar: "https://i.pravatar.cc/300?img=60",
    bio: "Live D&D campaigns and improvised stories. Roll for initiative.",
    description: "Tabletop RPG & storytelling nights.",
    links: [
      { platform: "twitch", url: "twitch.tv/talehunter" },
      { platform: "youtube", url: "youtube.com/@talehunter" },
      { platform: "telegram", url: "t.me/talehunter" },
    ],
    donations: [
      { donor: "artem", usdc: 5200, daysAgo: 28, text: "nat 20 for the bard!", state: "SHOWN" },
      { donor: "kirill", usdc: 1700, daysAgo: 14 },
      { donor: "cosmo", usdc: 600, daysAgo: 6, text: "kill the lich already", state: "SHOWN" },
      { donor: "luna", usdc: 50, daysAgo: 2 },
    ],
  },
];

/**
 * DEMO escrow tasks (mini-game G3a) — a stable spread of statuses on the realms that have the game enabled, so the
 * realm Games tab and /admin/games show real activity (task counts, value in escrow, a live dispute, resolved
 * outcomes) instead of zeros. Every `channel` here MUST be a realm whose DemoChannel has `enabledGames:
 * ["escrow-task"]`. The mock builder (MockDataProvider.seedDemo) gives each task long deadlines so it survives the
 * 2-min FAST_TEST_WINDOWS, and banks the one delivered (to_streamer) task to the ledger like the real game bus.
 */
export const DEMO_TASKS: DemoTask[] = [
  // raidboss — one awaiting a response, one delivered and in its dispute window
  {
    channel: "raidboss",
    donor: "kirill",
    usdc: 25,
    text: "Beat the next boss on a dance pad — no keyboard, live on stream.",
    status: "PENDING",
    createdDaysAgo: 1,
  },
  {
    channel: "raidboss",
    donor: "vika",
    usdc: 40,
    text: "No-hit run of the tutorial area tonight.",
    status: "DONE",
    createdDaysAgo: 4,
  },
  // devbyte — one in progress, one delivered (reputation banked to the donor)
  {
    channel: "devbyte",
    donor: "artem",
    usdc: 30,
    text: "Refactor the auth module live and explain each step.",
    status: "ACCEPTED",
    createdDaysAgo: 2,
  },
  {
    channel: "devbyte",
    donor: "lena",
    usdc: 50,
    text: "Review my open-source PR on stream and merge it if it holds up.",
    status: "RESOLVED",
    createdDaysAgo: 12,
    resolution: { outcome: "to_streamer", reason: "completed", resolvedDaysAgo: 10 },
  },
  // flashrun — a live dispute (community voting, quorum met, currently leaning "not delivered")
  {
    channel: "flashrun",
    donor: "oleg",
    usdc: 60,
    text: "Sub-20 any% run of level 1, no shortcuts.",
    status: "DISPUTED",
    createdDaysAgo: 6,
    dispute: {
      by: "grisha",
      openedDaysAgo: 1,
      quorum: 40,
      votes: [
        { voter: "grisha", choice: "not_completed", weight: 22, daysAgo: 1 },
        { voter: "felix", choice: "not_completed", weight: 14, daysAgo: 1 },
        { voter: "nastya", choice: "completed", weight: 9, daysAgo: 0 },
      ],
    },
  },
  // rooknroll — one awaiting, one refunded to the supporter (streamer never delivered)
  {
    channel: "rooknroll",
    donor: "dana",
    usdc: 10,
    text: "Solve today's puzzle rush blindfolded.",
    status: "PENDING",
    createdDaysAgo: 1,
  },
  {
    channel: "rooknroll",
    donor: "roma",
    usdc: 15,
    text: "Win a game opening with the bongcloud.",
    status: "RESOLVED",
    createdDaysAgo: 9,
    resolution: { outcome: "to_donor", reason: "no_show", resolvedDaysAgo: 7 },
  },
  // retroarcade — delivered, in its dispute window
  {
    channel: "retroarcade",
    donor: "mia",
    usdc: 20,
    text: "Clear the first loop of Pac-Man on the cabinet.",
    status: "DONE",
    createdDaysAgo: 3,
  },
  // codegolf — one in progress, one just posted
  {
    channel: "codegolf",
    donor: "zoe",
    usdc: 35,
    text: "Golf FizzBuzz under 60 bytes and explain the tricks.",
    status: "ACCEPTED",
    createdDaysAgo: 2,
  },
  {
    channel: "codegolf",
    donor: "cosmo",
    usdc: 10,
    text: "Walk through yesterday's shortest-path one-liner.",
    status: "PENDING",
    createdDaysAgo: 0,
  },
];
