// PROTOTYPE (#389), throwaway: lives only on prototype/showing-of-four.
//
// Three variants of Rank showing four wallpapers and asking for the best and
// the worst, switchable via `?variant=` (A/B/C) and the floating bar.
//
// Nothing is recorded. The backend has no showing of four yet, so the four
// come from two `getPair` calls and a "vote" only logs what the Comparison
// would be, then draws four more. The readout under the showing surfaces it.
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useApp } from "@/context/AppContext";
import { client, wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Loader2, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { initialVariant, PrototypeSwitcher } from "./PrototypeSwitcher";

const FEEDBACK_MS = 350;
const VARIANTS = [
  { key: "A", name: "2×2, click best then worst" },
  { key: "B", name: "Row of four, best/worst buttons" },
  { key: "C", name: "2×2, left-click best, right-click worst" },
];

type Four = [Wallpaper, Wallpaper, Wallpaper, Wallpaper];

interface Answer {
  best: number | null; // index into the showing
  worst: number | null;
}

interface Logged {
  best: number;
  worst: number;
  ms: number;
}

async function drawFour(exclude: number[]): Promise<Four> {
  const a = await client.getPair(exclude);
  const b = await client.getPair([...exclude, a[0].id, a[1].id]);
  const four = [a[0], a[1], b[0], b[1]] as Four;
  for (const w of four) {
    const img = new Image();
    img.src = wallpaperImageUrl(w.id, "medium");
  }
  return four;
}

export function RankFourPrototype({ active }: { active: boolean }) {
  const { settings } = useApp();
  const ratio = settings.screen.width / settings.screen.height;
  const [variant, setVariant] = useState(() =>
    initialVariant(VARIANTS.map((v) => v.key)),
  );
  const [four, setFour] = useState<Four | null>(null);
  const [answer, setAnswer] = useState<Answer>({ best: null, worst: null });
  const [committing, setCommitting] = useState(false);
  const [log, setLog] = useState<Logged[]>([]);
  const shownAt = useRef(performance.now());

  const next = useCallback(async (exclude: number[]) => {
    const f = await drawFour(exclude);
    setFour(f);
    setAnswer({ best: null, worst: null });
    shownAt.current = performance.now();
  }, []);

  useEffect(() => {
    void next([]);
  }, [next]);

  // Commit once both are named, after a beat of feedback. A half-answered
  // showing records nothing.
  useEffect(() => {
    if (!four || answer.best === null || answer.worst === null) return;
    setCommitting(true);
    const t = setTimeout(() => {
      const entry = {
        best: four[answer.best!].id,
        worst: four[answer.worst!].id,
        ms: Math.round(performance.now() - shownAt.current),
      };
      console.log("[prototype] would record showing of four", entry, four);
      setLog((l) => [entry, ...l].slice(0, 5));
      setCommitting(false);
      void next(four.map((w) => w.id));
    }, FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [answer, four, next]);

  const skip = () => {
    if (four && !committing) void next(four.map((w) => w.id));
  };

  if (!four) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const props = {
    four,
    answer,
    setAnswer,
    committing,
    ratio,
    active,
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-center gap-3 p-4 pb-16">
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}

      <div className="flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={skip}
          disabled={committing}
        >
          <SkipForward />
          Skip these four
        </Button>
        <span className="hidden text-xs text-muted-foreground md:inline">
          <Kbd>S</Kbd>
        </span>
      </div>
      <SkipKey active={active} onSkip={skip} />

      {/* Prototype readout: the state a variant switch or a pick changes. */}
      <pre className="mx-auto max-w-full overflow-x-auto rounded bg-muted px-3 py-1 text-[11px] text-muted-foreground">
        {`variant ${variant} · screen ${settings.screen.width}×${settings.screen.height} · best ${answer.best ?? "–"} worst ${answer.worst ?? "–"}\n`}
        {log
          .map((l) => `recorded? best #${l.best} worst #${l.worst} in ${l.ms} ms`)
          .join("\n") || "no showings answered yet"}
      </pre>

      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        onChange={(k) => {
          setVariant(k);
          setAnswer({ best: null, worst: null });
        }}
      />
    </div>
  );
}

function SkipKey({ active, onSkip }: { active: boolean; onSkip: () => void }) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return null;
}

interface VariantProps {
  four: Four;
  answer: Answer;
  setAnswer: React.Dispatch<React.SetStateAction<Answer>>;
  committing: boolean;
  ratio: number;
  active: boolean;
}

/** Window keydown while Rank is showing, standing down like Rank's arrows. */
function useKeys(active: boolean, handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/** The 2×2 grid, sized so both rows fit the window at the Screen's ratio. */
function gridStyle(ratio: number): React.CSSProperties {
  // 16rem: chrome, page bar, padding, skip row, readout and switcher.
  return {
    maxWidth: `calc(((100dvh - 16rem) / 2) * ${ratio} * 2 + 1rem)`,
  };
}

function Tile({
  wallpaper,
  ratio,
  state,
  committing,
  children,
  className,
  ...button
}: {
  wallpaper: Wallpaper;
  ratio: number;
  state: "best" | "worst" | "none";
  committing: boolean;
  children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      style={{ aspectRatio: ratio }}
      className={cn(
        "relative w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-[transform,opacity,filter] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        state === "best" && "ring-4 ring-emerald-500",
        state === "worst" && "opacity-60 ring-4 ring-rose-500 grayscale",
        committing && state === "none" && "scale-95 opacity-50",
        className,
      )}
      {...button}
    >
      <img
        src={wallpaperImageUrl(wallpaper.id, "medium")}
        alt=""
        className="h-full w-full bg-black/20 object-cover"
      />
      {state !== "none" && (
        <span
          className={cn(
            "absolute top-2 left-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow",
            state === "best" ? "bg-emerald-600" : "bg-rose-600",
          )}
        >
          {state === "best" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {state === "best" ? "Best" : "Worst"}
        </span>
      )}
      {children}
    </button>
  );
}

function stateOf(answer: Answer, i: number): "best" | "worst" | "none" {
  return answer.best === i ? "best" : answer.worst === i ? "worst" : "none";
}

/**
 * A: 2×2. The first pick is the best, the second the worst, and the second one
 * commits. Picking the best again takes it back. Keys 1 2 / 3 4 follow the
 * grid; Backspace or Esc takes the best back too.
 */
function VariantA({ four, answer, setAnswer, committing, ratio, active }: VariantProps) {
  const pick = (i: number) => {
    if (committing) return;
    setAnswer((a) => {
      if (a.best === null) return { best: i, worst: null };
      if (a.best === i) return { best: null, worst: null };
      return { ...a, worst: i };
    });
  };
  useKeys(active, (e) => {
    const n = ["1", "2", "3", "4"].indexOf(e.key);
    if (n >= 0) pick(n);
    else if ((e.key === "Backspace" || e.key === "Escape") && !committing)
      setAnswer({ best: null, worst: null });
  });

  return (
    <>
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        {answer.best === null ? (
          <>Pick the <b className="text-emerald-500">best</b></>
        ) : (
          <>Now the <b className="text-rose-500">worst</b> · click the best again to change it</>
        )}
      </p>
      <div
        className="mx-auto grid w-full grid-cols-2 gap-4"
        style={gridStyle(ratio)}
      >
        {four.map((w, i) => (
          <Tile
            key={w.id}
            wallpaper={w}
            ratio={ratio}
            state={stateOf(answer, i)}
            committing={committing}
            onClick={() => pick(i)}
          >
            <span className="absolute right-2 bottom-2 hidden md:block">
              <Kbd>{i + 1}</Kbd>
            </span>
          </Tile>
        ))}
      </div>
    </>
  );
}

/**
 * B: a row of four, each with a Best and a Worst button under it, in either
 * order. Either can be moved until both are set. Keys: the top letter row
 * Q W E R names the best, the home row A S D F the worst, lined up with the
 * row of wallpapers. S is taken, so skip is the button only.
 */
function VariantB({ four, answer, setAnswer, committing, ratio, active }: VariantProps) {
  const set = (field: "best" | "worst", i: number) => {
    if (committing) return;
    setAnswer((a) => {
      const other = field === "best" ? "worst" : "best";
      return { ...a, [field]: i, [other]: a[other] === i ? null : a[other] };
    });
  };
  useKeys(active, (e) => {
    const k = e.key.toLowerCase();
    const b = ["q", "w", "e", "r"].indexOf(k);
    const w = ["a", "s", "d", "f"].indexOf(k);
    if (b >= 0) set("best", b);
    else if (w >= 0) {
      e.preventDefault(); // S is skip elsewhere
      set("worst", w);
    }
  });

  return (
    <div className="mx-auto grid w-full grid-cols-4 gap-3">
      {four.map((w, i) => (
        <div key={w.id} className="flex flex-col gap-2">
          <Tile
            wallpaper={w}
            ratio={ratio}
            state={stateOf(answer, i)}
            committing={committing}
            tabIndex={-1}
          />
          <div className="flex justify-center gap-2">
            <Button
              size="sm"
              variant={answer.best === i ? "default" : "outline"}
              className={cn(answer.best === i && "bg-emerald-600 hover:bg-emerald-600")}
              onClick={() => set("best", i)}
            >
              <ChevronUp /> Best <Kbd className="ml-1 hidden md:inline-flex">{"QWER"[i]}</Kbd>
            </Button>
            <Button
              size="sm"
              variant={answer.worst === i ? "default" : "outline"}
              className={cn(answer.worst === i && "bg-rose-600 hover:bg-rose-600")}
              onClick={() => set("worst", i)}
            >
              <ChevronDown /> Worst <Kbd className="ml-1 hidden md:inline-flex">{"ASDF"[i]}</Kbd>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * C: 2×2 with a cursor. Left-click is best, right-click is worst, either order;
 * clicking the same one again clears it. On the keyboard the arrows move the
 * cursor, which enlarges the wallpaper under it, Enter or Space names it best
 * and X names it worst.
 */
function VariantC({ four, answer, setAnswer, committing, ratio, active }: VariantProps) {
  const [cursor, setCursor] = useState(0);
  const toggle = (field: "best" | "worst", i: number) => {
    if (committing) return;
    setAnswer((a) => {
      const other = field === "best" ? "worst" : "best";
      if (a[field] === i) return { ...a, [field]: null };
      return { ...a, [field]: i, [other]: a[other] === i ? null : a[other] };
    });
  };
  useKeys(active, (e) => {
    const moves: Record<string, (c: number) => number> = {
      ArrowLeft: (c) => (c % 2 === 1 ? c - 1 : c),
      ArrowRight: (c) => (c % 2 === 0 ? c + 1 : c),
      ArrowUp: (c) => (c >= 2 ? c - 2 : c),
      ArrowDown: (c) => (c < 2 ? c + 2 : c),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setCursor(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle("best", cursor);
    } else if (e.key === "x" || e.key === "X") toggle("worst", cursor);
  });

  return (
    <>
      <p className="text-center text-sm text-muted-foreground">
        <b className="text-emerald-500">Left-click</b> best ·{" "}
        <b className="text-rose-500">right-click</b> worst ·{" "}
        <span className="hidden md:inline">
          arrows move, <Kbd>Enter</Kbd> best, <Kbd>X</Kbd> worst
        </span>
      </p>
      <div
        className="mx-auto grid w-full grid-cols-2 gap-4"
        style={gridStyle(ratio)}
      >
        {four.map((w, i) => (
          <div
            key={w.id}
            onMouseEnter={() => setCursor(i)}
            className={cn(
              "relative transition-transform duration-150",
              cursor === i && "z-10 scale-[1.04]",
            )}
          >
            <Tile
              wallpaper={w}
              ratio={ratio}
              state={stateOf(answer, i)}
              committing={committing}
              className={cn(cursor === i && "outline-2 outline-offset-2 outline-foreground/60")}
              onClick={() => toggle("best", i)}
              onContextMenu={(e) => {
                e.preventDefault();
                toggle("worst", i);
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
