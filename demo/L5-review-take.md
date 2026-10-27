# L5: review loop take (about 40 s on screen)

The beat: the tool proposes and a person decides. One accept, one rename and one merge on the acme-shop fixture take
the eval from 20/21 to 21/21, and the safety checks stay at 0 px.

## Before you record

```
cp -R out/demo-review2 out/take-review          # staged run: Muse Spark Open names, 1 merge suggested
open out/take-review/report.html
```

If the staged folder is gone, rebuild it (about 10 s):

```
S2T_SEGMENTER=hybrid S2T_NAMER=baseten node src/cli.js run --fixture acme-shop --run out/take-review
```

## Shot list

1. **Report, Tokens section.** Point at `color.action.primary` and click **Accept**. (The badge turns "accepted".)
2. **Rename.** On `color.surface.muted`, click **Rename** and type `color.surface.input`.
3. **Suggested merges.** "6px (1 use) is close to 4px (14 uses)". Click **Accept merge**. Say: *the tool never merges
   on its own; a person accepts it.*
4. **Export** the decisions (the report saves `review.json`), then in the terminal:

   ```
   node src/cli.js review --run out/take-review --decisions <downloaded review.json>
   node src/cli.js eval --fixture acme-shop --run out/take-review
   ```

5. **End card on the terminal:** `verify fallback-only 0 px (pass); colors 0.000% (pass)` and
   `eval acme-shop: 21/21 (100%)`, which was 20/21 before review.

Backup if the click-through misbehaves: the same three decisions are in `demo/review-take.json`
(`--decisions demo/review-take.json`), and they give the same result (checked 2026-10-26: 20/21 → 21/21, 0 px).
