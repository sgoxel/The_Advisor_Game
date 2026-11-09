/**
 * Ambient resident chatter (presentation only).
 *
 * The Simulation never needs to know about these lines: they are chosen from
 * the pair of already-rendered resident codes and the fantasy tick, so the
 * same seed and the same moment always produce the same exchange. Nothing here
 * moves, selects or re-labels a resident, and an exchange never becomes a
 * command or an Advisor fact.
 */

export type ChatterActor = {
  readonly code: string;
  readonly name: string;
  readonly role: string;
  /** Canonical render coordinates (metres from the focus), for closeness. */
  readonly x: number;
  readonly z: number;
  /** Current screen position of the painted feet, in CSS pixels. */
  readonly screenX: number;
  readonly screenY: number;
};

export type ChatterLine = {
  readonly speaker: string;
  readonly text: string;
};

/** Hash a string and an integer into a stable 32-bit value (FNV-1a). */
export function chatterHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const OPENERS: readonly string[] = [
  "Fair morning to you. Anything worth hearing on the road?",
  "You are up early. The baker's ovens were smoking before dawn.",
  "Did the cart from the coast get through the gate yet?",
  "Mind the puddles by the well — my boots are still drying.",
  "They say the reeve wants the ditch cleared before harvest.",
  "Have you seen the new banner over the keep?",
  "Quiet day. Too quiet for a market day, if you ask me.",
  "My roof still leaks where the storm took the tiles.",
  "Is the smith taking new work? My plough needs a new shoe.",
  "The orchard apples are nearly ready. Smell that?",
  "Keep an eye on the north field; the deer are bold this year.",
  "One of the grey cats has taken up residence in the granary again.",
  "You look tired. Was the night watch long?",
  "The miller swears the wheel is turning sweeter this week.",
  "Any news of the traders from Greyfield?",
  "They are laying new stones on the high street today.",
];

const REPLIES: readonly string[] = [
  "Nothing yet. Ask me again after the market bell.",
  "Aye, and half the lane is mud because of it.",
  "I heard the same, though I would not swear to it.",
  "Well, the reeve can clear it himself for once.",
  "Give it a day. These things always look worse at dawn.",
  "I saw it. Fancy cloth for a plain gate, if you ask me.",
  "Hush — the walls have ears and the walls are nosy.",
  "Come by the inn later and I will tell you properly.",
  "It is not the roof I mind. It is the bucket under it.",
  "He is. But he charges double when the sun is high.",
  "Then we should pick them before the birds do.",
  "Better deer than wolves, my mother would say.",
  "That cat has more sense than half the council.",
  "Long enough to know I want my bed.",
  "They will be late. They always are when it rains.",
  "About time. My cart rattled half a wheel loose on that road.",
];

const ROLE_LINES: Readonly<Record<string, readonly string[]>> = {
  guard: [
    "Keep clear of the gate after dusk. That is an order, not a rumour.",
    "All quiet at the watch. So far.",
  ],
  merchant: [
    "Good wool today. Good prices too, if you are quick.",
    "I could be persuaded to part with a ribbon for a story.",
  ],
  innkeeper: [
    "There is stew on the fire and room by it, if you are thirsty.",
    "A careful tongue gets a fuller cup. Remember that.",
  ],
  clergy: [
    "Be kind to your neighbour. The bell hears everything.",
    "Peace is not the absence of work. It is the work.",
  ],
  farmer: [
    "The soil is warm. Rain tonight would suit it.",
    "That fence will not mend itself, tempting as it is.",
  ],
  blacksmith: [
    "Bring it back when it is cold and I will look at it.",
    "Iron does not argue. Iron listens.",
  ],
  laborer: [
    "One more barrow and then I am finding shade.",
    "Stone is honest work. It never lies about its weight.",
  ],
};

/** The line pair a resident exchange can draw from. */
export function chatterLinesFor(role: string): readonly string[] {
  return ROLE_LINES[role] ?? [];
}

export type ChatterPlan = {
  /** Stable fantasy-time window this exchange belongs to. */
  readonly window: number;
  readonly line: ChatterLine;
  readonly reply: ChatterLine;
};

/**
 * Deterministic exchange for a pair of resident codes in one time window.
 * `window` is a fantasy-tick bucket (about five real seconds at 24x).
 */
export function chatterPlanFor(
  first: Pick<ChatterActor, "code" | "name" | "role">,
  second: Pick<ChatterActor, "code" | "name" | "role">,
  tick: number,
): ChatterPlan {
  // Canonical pair order makes the exchange independent of who was listed first.
  const [one, two] = first.code <= second.code ? [first, second] : [second, first];
  const window = Math.floor(tick / 128),
    key = [one.code, two.code].sort().join("|");
  const seed = chatterHash(`${key}/${window}`),
    opener = (seed % 1000) / 1000,
    replier = ((seed >>> 10) % 1000) / 1000,
    // Half the windows let the second resident open, so pairs alternate voices.
    firstSpeaks = (seed >>> 24) % 2 === 0,
    // A trade line belongs only to the person actually speaking it.
    speaker = firstSpeaks ? one : two,
    rolePool = chatterLinesFor(speaker.role),
    useRole = rolePool.length > 0 && (seed >>> 20) % 3 === 0;
  const openerText = useRole
    ? rolePool[seed % rolePool.length]
    : OPENERS[Math.floor(opener * OPENERS.length) % OPENERS.length];
  const replyText = REPLIES[Math.floor(replier * REPLIES.length) % REPLIES.length];
  return {
    window,
    line: { speaker: speaker.name, text: openerText },
    reply: { speaker: (firstSpeaks ? two : one).name, text: replyText },
  };
}

export type AmbientChatterOptions = {
  /** Milliseconds each exchange stays on screen. */
  readonly lifetimeMs?: number;
  /** Longest screen distance between two people still "talking". */
  readonly maxScreenGapPx?: number;
  /** Closest screen distance before two cut-outs count as one person. */
  readonly minScreenGapPx?: number;
  readonly maxBubbles?: number;
};

type LiveBubble = {
  element: HTMLElement;
  key: string;
  actors: [string, string];
  shownAt: number;
  phase: 0 | 1;
};

export type AmbientChatter = {
  /** Feed the currently rendered actors; safe to call every frame. */
  update(nowMs: number, tick: number, actors: readonly ChatterActor[]): void;
  /** Number of bubbles currently mounted (diagnostics/tests). */
  readonly mounted: number;
  destroy(): void;
};

/**
 * Mount a chatter layer over the map. Bubbles follow the painted residents,
 * never replace their labels, and disappear as soon as either person leaves
 * the render query.
 */
export function createAmbientChatter(
  root: HTMLElement,
  options: AmbientChatterOptions = {},
): AmbientChatter {
  const lifetime = options.lifetimeMs ?? 4200,
    maxGap = options.maxScreenGapPx ?? 220,
    minGap = options.minScreenGapPx ?? 34,
    maxBubbles = options.maxBubbles ?? 2;
  let live: LiveBubble[] = [],
    candidateKey = "",
    nextAttemptAt = 0;

  const byCode = new Map<string, ChatterActor>();

  const remove = (bubble: LiveBubble) => {
    bubble.element.remove();
  };

  const mount = (pair: [ChatterActor, ChatterActor], tick: number, now: number) => {
    const plan = chatterPlanFor(pair[0], pair[1], tick),
      element = document.createElement("div");
    element.className = "chat-bubble";
    element.dataset.bubbleKey = `${pair[0].code}|${pair[1].code}|${plan.window}`;
    const who = document.createElement("span");
    who.className = "chat-who";
    who.textContent = plan.line.speaker;
    const body = document.createElement("span");
    body.textContent = plan.line.text;
    element.append(who, body);
    root.append(element);
    const bubble: LiveBubble = {
      element,
      key: element.dataset.bubbleKey!,
      actors: [pair[0].code, pair[1].code],
      shownAt: now,
      phase: 0,
    };
    // The second voice answers halfway through the exchange.
    window.setTimeout(() => {
      if (!element.isConnected) return;
      who.textContent = plan.reply.speaker;
      body.textContent = plan.reply.text;
      bubble.phase = 1;
    }, Math.round(lifetime * 0.55));
    return bubble;
  };

  const place = (bubble: LiveBubble) => {
    const first = byCode.get(bubble.actors[0]),
      second = byCode.get(bubble.actors[1]);
    if (!first || !second) return false;
    const x = (first.screenX + second.screenX) / 2,
      y = Math.min(first.screenY, second.screenY) - 46,
      right = Math.min(Math.max(8, x - 12), Math.max(8, root.clientWidth - 160)),
      top = Math.max(96, y);
    bubble.element.style.transform = `translate3d(${Math.round(right)}px, ${Math.round(top)}px, 0)`;
    return true;
  };

  return {
    get mounted() { return live.length; },
    update(now, tick, actors) {
      byCode.clear();
      for (const actor of actors) byCode.set(actor.code, actor);
      // Retire bubbles whose people left the query or whose time is up.
      live = live.filter((bubble) => {
        if (now - bubble.shownAt < lifetime && place(bubble)) return true;
        remove(bubble);
        return false;
      });

      // One deterministic attempt per time window keeps this cheap and calm.
      // Placement above already ran, so an unchanged window is just a no-op.
      const windowKey = `${Math.floor(tick / 128)}`;
      if (windowKey === candidateKey) return;
      candidateKey = windowKey;
      if (now < nextAttemptAt || live.length >= maxBubbles) return;
      nextAttemptAt = now + 2600;

      // Score every visibly separated pair; the lowest score wins, so both
      // which pair talks and what they say are stable for this window.
      let best: { pair: [ChatterActor, ChatterActor]; score: number } | undefined;
      const sorted = [...actors].sort((a, b) => a.code.localeCompare(b.code));
      for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j],
          gap = Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY);
        if (gap < minGap || gap > maxGap) continue;
        const score = chatterHash(`${a.code}|${b.code}|${windowKey}`);
        if (!best || score < best.score) best = { pair: [a, b], score };
      }
      if (!best) return;
      if (live.some((bubble) => bubble.key.startsWith(`${best!.pair[0].code}|${best!.pair[1].code}|`))) return;
      const bubble = mount(best.pair, tick, now);
      place(bubble);
      live.push(bubble);
    },
    destroy() {
      for (const bubble of live) remove(bubble);
      live = [];
      root.replaceChildren();
    },
  };
}
