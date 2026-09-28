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
- **Fit is a geometry test, not an eyeball check.** Fixture strings are
  short, but real ones ("Dana White's Contender Series", a long workout
  name) spilled out of the bands on the phone. For any clipped or diagonal
  layout, assert that every text box sits inside the shape, at the
  smallest target phone, with long strings. Prove the test fails on the
  broken version.
- **Don't add explanation the user didn't ask for.** The "ON TOP · reason"
  tag was a feature nobody requested. The ordering already carries the
  signal.
- **Screenshot tests must not depend on the network.** The movies header
  shows a line fetched live from the GitHub API. CI has network and this
  sandbox does not, so the baselines differed by a whole header line. It
  stayed hidden under the 2% tolerance until a taller header pushed it
  over. Stub every external call in the shared test fixture, and abort
  with the error code your console checks already treat as offline.
- **Prove "functionality unchanged" with data, not by eye.** Run the same
  scripted session on the old and new builds and diff what gets saved
  (storage and counts). It caught nothing this time, and that is what
  makes it safe to say so.
