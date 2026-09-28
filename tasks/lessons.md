# Lessons

- **Visual decisions need visuals.** When asking the user to choose an
  aesthetic, show real mockups (Design canvas artboards), not ASCII
  sketches or prose descriptions. They asked for "a mock up static
  preview of each" when given ASCII previews.
- **Preview on the target device.** This user reviews on an iPhone held
  upright. Deliver previews as full-screen, portrait, swipeable pages at
  true phone width, not a pannable multi-board canvas or desktop boards.
- **Business rules come from the owning app, not from one data field.**
  A per-transaction `splitRatio: 0.5` looked authoritative, but the Budget
  app actually uses `catSplits`, `settledSplit` and `excludedFromAvg`. Before
  computing any derived number (spend, share, average), read the app that
  owns the data (budget-together is public, at `docs/mobile.html`) and mirror
  its function. Don't guess.
- **Visual assets get the same bar as the UI.** An app icon is the most-seen
  pixel on the phone. Don't ship "stripes plus a letter". Design a hero
  shape with depth, light and a clear silhouette. Judge it next to real
  iOS icons at 60px before calling it done.
- **Never label illustrative data "real".** Compute every value that a
  brief or mockup calls real from the source file first. (A hand-typed
  W/L order went into the concept brief as "real" and had to be
  corrected mid-build.)
