import {
  HeroPicture,
  usePictureBox,
  wallpaperPicture,
} from "@/components/HeroPicture";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { fittedBox, ratioOf, type Box } from "@/lib/layout-plan";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useState } from "react";
import {
  flush,
  mockBootedApp,
  renderInApp,
  settings,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The hero picture (#279), driven through its own interface: the box hook and
// the component, mounted inside the real providers and handed a wallpaper the
// way the Review strip and the lightbox hand one over. A step is the wallpaper
// changing under a picture that stays mounted, which is what both surfaces do
// when the curator arrows.
//
// What each surface does around the picture — the strip's filmstrip agreeing
// with it, the lightbox's row staying put under a gone file, the placeholder
// coming back when the lightbox is opened again — is that surface's file to
// assert. This one is about the picture: its phases, when they reset, and the
// crop preview over it.

afterEach(cleanup);

beforeEach(() => {
  // The provider's boot gate; the picture itself asks the backend nothing, and
  // reads only the crop toggle out of the settings it holds.
  mockBootedApp();
});

/** The area the stage's picture is fitted into while nothing measures it. */
const AREA: Box = { width: 1216, height: 680 };

/** Put the stage on another wallpaper, or on none, from outside it. */
let show: (next: Wallpaper | null) => void = () => {};

/** What the stage's gone panel says, which is the surface's to word. */
const NOTICE = "the stage's own notice";

/**
 * A surface with nothing but the picture on it: an area for the hook to
 * measure, and the picture fitted into it for whichever wallpaper is shown.
 * Showing none unmounts the picture, which is how a surface loses it — the
 * strip's worklist emptying, or the lightbox closing.
 *
 * `learns` is whether it hands the decoded size back to the hook, which is the
 * lightbox's arrangement; the strip's is not to.
 */
function Stage({ first, learns }: { first: Wallpaper; learns: boolean }) {
  const [shown, setShown] = useState<Wallpaper | null>(first);
  show = setShown;
  const picture = shown ? wallpaperPicture(shown) : null;
  const { area, box, learnNaturalSize } = usePictureBox(picture, AREA);
  return (
    <div ref={area}>
      {picture && (
        <HeroPicture
          picture={picture}
          box={box}
          fit="contain"
          cropPreview
          gone={<span>{NOTICE}</span>}
          onNaturalSize={learns ? learnNaturalSize : undefined}
        />
      )}
    </div>
  );
}

async function mount(first: Wallpaper, learns = false) {
  await renderInApp(<Stage first={first} learns={learns} />);
}

/** A step: the same picture, handed another wallpaper. */
async function step(next: Wallpaper | null) {
  await act(async () => show(next));
  await flush();
}

const first = wallpaper(7, { filename: "first.jpg" });
const second = wallpaper(8, { filename: "second.jpg" });

const hero = () =>
  document.querySelector('[data-slot="hero"]') as HTMLElement | null;

/** The `medium`: the picture this module exists to show. */
const picture = () =>
  document.querySelector('[data-slot="hero-picture"]') as HTMLImageElement;

/** The `small` painted behind the `medium`, or `null` once that one arrived. */
const placeholder = () =>
  document.querySelector(
    '[data-slot="hero-placeholder"]',
  ) as HTMLImageElement | null;

/** The panel that says the file is gone, or `null` while nothing says so. */
const gonePanel = () =>
  document.querySelector('[data-slot="hero-gone"]') as HTMLElement | null;

const cropPreview = () => document.querySelector('[data-slot="crop-preview"]');

/** Every image request the picture has out, in the order they paint. */
const requests = () =>
  Array.from(hero()?.querySelectorAll("img") ?? []).map(
    (img) => img.getAttribute("src") ?? "",
  );

/**
 * An image arriving. happy-dom loads nothing, so it fires no `load` of its own
 * — a test that needs a picture to have arrived has to say so, which is also
 * the only way to reach the frame where one has not. It decodes nothing
 * either, so a test that needs the decoded size says what it was.
 */
async function loaded(element: Element, natural?: Box) {
  if (natural) {
    Object.defineProperty(element, "naturalWidth", {
      configurable: true,
      value: natural.width,
    });
    Object.defineProperty(element, "naturalHeight", {
      configurable: true,
      value: natural.height,
    });
  }
  await act(async () => {
    fireEvent.load(element);
  });
  await flush();
}

/** The box the picture is drawn in, as the component sized it. */
const drawn = () => ({
  width: Number.parseFloat(hero()!.style.width),
  height: Number.parseFloat(hero()!.style.height),
});

function expectBox(ratio: number) {
  const want = fittedBox(AREA, ratio);
  expect(drawn().width).toBeCloseTo(want.width);
  expect(drawn().height).toBeCloseTo(want.height);
}

/**
 * An image that will not arrive, which is the whole of how the picture learns
 * the file is gone (ADR 0032). Same reason as `loaded`.
 */
async function failed(element: Element) {
  await act(async () => {
    fireEvent.error(element);
  });
  await flush();
}

test("the first frame is the small behind the medium, until the medium arrives", async () => {
  await mount(first);

  // Behind, and not beside: both fill the box, and the order they are in the
  // DOM is the order they paint. So what the curator arrives on is a blurry
  // version of the picture rather than an empty box or a spinner, and it costs
  // no request — the card or the filmstrip painted that `small` a moment ago
  // (ADR 0022).
  expect(requests()).toEqual([
    wallpaperImageUrl(7, "small"),
    wallpaperImageUrl(7, "medium"),
  ]);
  // Announced by nothing: it is the same picture as the `medium`, which is
  // already named.
  expect(placeholder()?.getAttribute("alt")).toBe("");
  expect(picture().getAttribute("alt")).toBe("first.jpg");

  await loaded(picture());

  expect(placeholder()).toBeNull();
});

test("the small stays up until the medium has decoded, not only loaded", async () => {
  await mount(first);
  // `load` is the bytes arriving. WebKit decodes a large image after that,
  // off the main thread, and paints nothing for it until it has: take the
  // `small` down on `load` and the box shows the surface's ground for a frame
  // or two, a flicker on the first open of every file.
  let decoded: () => void = () => {};
  Object.defineProperty(picture(), "decode", {
    configurable: true,
    value: () => new Promise<void>((resolve) => (decoded = resolve)),
  });

  await loaded(picture());
  expect(placeholder()).not.toBeNull();

  await act(async () => decoded());
  await flush();
  expect(placeholder()).toBeNull();
});

test("a step holds the outgoing picture, and asks for nothing but the next one", async () => {
  await mount(first);
  const element = picture();
  await loaded(element);

  await step(second);

  // The same element with a new `src`, which is the whole mechanism: an `<img>`
  // keeps painting the image it has until the new one decodes. A `key` per
  // wallpaper remounts it with nothing painted, which is a held arrow key
  // strobing to black (ADR 0022).
  expect(picture()).toBe(element);
  // One request, and no placeholder in front of it: the arriving wallpaper's
  // thumbnail behind the outgoing picture would show around its edges, and
  // neither neighbour is prefetched, since a speculative request goes into the
  // pipeline ADR 0012 gave a dedicated thread to keep clear.
  expect(requests()).toEqual([wallpaperImageUrl(8, "medium")]);
});

test("a picture mounted again paints its placeholder again", async () => {
  await mount(first);
  await loaded(picture());

  // What a lightbox closing and opening does to it, and the strip's worklist
  // emptying and filling: the `<img>` is new and has nothing painted, so there
  // is no outgoing frame to hold.
  await step(null);
  await step(second);

  expect(requests()).toEqual([
    wallpaperImageUrl(8, "small"),
    wallpaperImageUrl(8, "medium"),
  ]);
});

test("a picture that will not load puts up the surface's gone panel", async () => {
  await mount(first);
  expect(gonePanel()).toBeNull();

  await failed(picture());

  // In the surface's own words: the strip says one line and the lightbox two,
  // and each file asserts its own (ADR 0032).
  expect(gonePanel()?.textContent).toBe(NOTICE);
  // The thumbnail is not held up in front of a picture that is never coming,
  // which would be the spinner that never resolves (ADR 0006).
  expect(placeholder()).toBeNull();
  // And what a failed `<img>` paints, its `alt`, is not left under the panel.
  expect(picture().className).toContain("invisible");
});

test("the crop preview is not drawn over a picture whose file is gone", async () => {
  mockCommand("get_settings", () => settings({ crop_preview: true }));
  await mount(first);

  // Up from the first frame, off the stored toggle both surfaces read (#266).
  expect(cropPreview()).not.toBeNull();

  await failed(picture());

  // The panel says there is no picture, and bars over it would be a claim
  // about one.
  expect(gonePanel()).not.toBeNull();
  expect(cropPreview()).toBeNull();

  // And they are back for the next wallpaper, which has a picture to crop.
  await step(second);
  expect(cropPreview()).not.toBeNull();
});

test("stepping off a gone wallpaper never draws the message over the next one", async () => {
  await mount(first);
  await failed(picture());
  expect(gonePanel()).not.toBeNull();

  // Whether the panel was in the document at the moment the picture took the
  // next wallpaper's `src`.
  //
  // This leans on how React commits, and says so: the panel and the picture
  // are siblings, and within one commit React removes a deleted child before it
  // updates the attributes of the siblings that stay. So "the panel was gone
  // when the `src` changed" is what one commit dropping the panel looks like,
  // and a reset in any later commit is caught. Were React to reorder that, this
  // would fail on a correct implementation rather than pass on a broken one. The `<img>` has no `key`, so it keeps painting the
  // outgoing picture through the step, and a panel that outlives that moment by
  // even one commit is "File is gone" over a wallpaper that is fine. A reset in
  // a passive effect lands a frame late, which is the lightbox's bug this
  // replaced; one in a layout effect never paints but still commits.
  const next = wallpaperImageUrl(8, "medium");
  let goneAtSwitch: boolean | null = null;
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (name === "src" && value === next && goneAtSwitch === null) {
      goneAtSwitch = gonePanel() !== null;
    }
    return setAttribute.call(this, name, value);
  };
  try {
    await step(second);
  } finally {
    Element.prototype.setAttribute = setAttribute;
  }

  expect(goneAtSwitch as boolean | null).toBe(false);
  expect(gonePanel()).toBeNull();
  // The element is still holding the failed request, though, so it stays
  // hidden until the next one lands: shown, it would flash the next
  // wallpaper's `alt` and the broken-image glyph for the length of the decode.
  expect(picture().className).toContain("invisible");

  await loaded(picture());
  expect(gonePanel()).toBeNull();
  expect(picture().className).not.toContain("invisible");
});

test("stepping onto a second gone wallpaper says so again", async () => {
  await mount(first);
  await failed(picture());

  await step(second);
  await failed(picture());

  expect(gonePanel()?.textContent).toBe(NOTICE);
});

// The shape. A wallpaper with Dimensions is drawn at them; one without is the
// 16:9 guess every layout makes (ADR 0044), and a surface that hands the
// decoded size back gets the picture's own shape once the `medium` has loaded.

test("a wallpaper whose Dimensions nothing has read takes the decoded shape, if the surface asks", async () => {
  await mount(wallpaper(7, { width: null, height: null }), true);

  // Nothing is known yet, so the guess.
  expectBox(16 / 9);

  // A portrait, which is the case the guess gets most wrong.
  await loaded(picture(), { width: 1080, height: 1920 });

  expectBox(1080 / 1920);

  // Keyed on the wallpaper it was decoded for, so the next unknown wallpaper
  // is the guess again rather than the last one's shape.
  await step(wallpaper(8, { width: null, height: null }));
  expectBox(16 / 9);
});

test("the guess stands for a surface that does not ask, and Dimensions always win", async () => {
  await mount(wallpaper(7, { width: null, height: null }));
  await loaded(picture(), { width: 1080, height: 1920 });

  // The strip's arrangement: its hero is a frame the picture fills.
  expectBox(ratioOf(null, null));

  cleanup();
  await mount(wallpaper(7, { width: 2560, height: 1080 }), true);
  await loaded(picture(), { width: 1080, height: 1920 });

  expectBox(2560 / 1080);
});
