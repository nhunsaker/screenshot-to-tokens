// Shared shapes for every stage. JavaScript + JSDoc only.
//
// Pipeline:  capture → segment → join → cluster → name → emit → rewrite → verify → report
// Each stage reads/writes one JSON file under out/<run>/ so any stage can be re-run alone
// and a provider swap (mock → SAM 3.1 / Muse Spark) only changes one file.

/**
 * A computed-style sample for one visible DOM element (capture stage).
 * @typedef {Object} ElementSample
 * @property {number} i                 Index in capture order.
 * @property {string} tag               Lower-case tag name.
 * @property {string} path              Short CSS-ish path (e.g. "main>section.card>button.btn").
 * @property {string|null} role         ARIA role or implicit role guess.
 * @property {string[]} [classes]        The element's CSS classes (first 8).
 * @property {string} text              First 40 chars of own text.
 * @property {boolean} [clickable]      Behaves clickable (itself or via an ancestor, or pointer cursor). Older captures lack it.
 * @property {[number,number,number,number]} bbox  [x, y, w, h] in page px.
 * @property {Record<string,string>} styles  Raw computed values for STYLE_PROPS.
 */

/**
 * @typedef {Object} Capture
 * @property {string} url
 * @property {{width:number,height:number}} viewport
 * @property {string} screenshot        Path to the full-page PNG (relative to the run dir).
 * @property {ElementSample[]} elements
 * @property {string} capturedAt        ISO time.
 */

/**
 * A UI region in the screenshot (segment stage). SAM 3.1 returns masks; we keep the bbox
 * plus an optional mask path so the join and the overlay stay provider-agnostic.
 * @typedef {Object} Region
 * @property {string} id                "r0", "r1", ...
 * @property {[number,number,number,number]} bbox  [x, y, w, h] in page px.
 * @property {string} label             button | input | card | nav | header | link | text | image | other
 * @property {number} score             0..1 provider confidence.
 * @property {string} source            Provider id ("mock-dom", "sam3.1", ...).
 * @property {string} [mask]            Optional mask PNG path.
 */

/**
 * One raw value as seen on the page, with where it was used.
 * @typedef {Object} ValueUse
 * @property {string} raw               As computed ("rgb(26, 115, 232)", "6px").
 * @property {string} prop              CSS property.
 * @property {number} element           ElementSample.i
 * @property {string|null} region       Region id that contains the element, if any.
 * @property {string|null} regionLabel
 */

/**
 * A group of near-duplicate values (cluster stage). Deterministic; no model.
 * @typedef {Object} Cluster
 * @property {string} id                "color-03", "radius-01", ...
 * @property {'color'|'radius'|'space'|'font-size'|'font-weight'|'font-family'|'shadow'|'line-height'} kind
 * @property {string} value             Representative value (most used member), normalized.
 * @property {{value:string,count:number}[]} members  Distinct normalized values merged here.
 * @property {number} count             Total uses.
 * @property {Record<string,number>} props        Uses per CSS property.
 * @property {Record<string,number>} regionLabels Uses per region label.
 * @property {Record<string,number>} [propRegions] Uses per "prop@label" (e.g. "background-color@button").
 */

/**
 * @typedef {'primitive'|'semantic'|'component'} Tier
 */

/**
 * A proposed token (name stage). Primitives carry a value; semantic/component tokens alias.
 * @typedef {Object} TokenProposal
 * @property {string} name              Dot path, e.g. "color.blue.600", "color.action.primary", "button.radius".
 * @property {Tier} tier
 * @property {string} [value]           Literal (primitives only).
 * @property {string} [alias]           Name of the token this one points to (semantic/component).
 * @property {string[]} clusters        Cluster ids this token covers.
 * @property {string} why               One-sentence reason (shown in the review UI).
 */

/**
 * @typedef {Object} TokenSet
 * @property {TokenProposal[]} tokens
 * @property {string} namer             Provider id that produced it.
 * @property {string[]} [warnings]      Validation repairs / fallbacks.
 */

/**
 * Provider contracts. Each provider module default-exports a factory returning one of these.
 *
 * @typedef {Object} SegmentProvider
 * @property {string} id
 * @property {(capture: Capture, runDir: string) => Promise<Region[]>} segment
 *
 * @typedef {Object} NamerProvider
 * @property {string} id
 * @property {(input: {clusters: Cluster[], regions: Region[], screenshotPath?: string}) => Promise<TokenSet>} name
 *
 * @typedef {Object} CoderProvider
 * @property {string} id
 * @property {(input: {targetDir: string, tokens: TokenSet, clusters: Cluster[], write: boolean, runDir: string}) => Promise<RewriteResult>} rewrite
 */

/**
 * @typedef {Object} RewriteEdit
 * @property {string} file
 * @property {number} line
 * @property {string} prop
 * @property {string} before
 * @property {string} after
 * @property {string} token
 *
 * @typedef {Object} RewriteResult
 * @property {string} coder
 * @property {RewriteEdit[]} edits
 * @property {string[]} files           Files changed (or that would change in dry run).
 * @property {boolean} written
 * @property {string} [outDir]          Where the rewritten copy lives (verify serves it).
 */

/**
 * One element's own text as rendered (capture.walkTexts), for the contrast check.
 * @typedef {Object} TextSample
 * @property {string} path              Same short path as ElementSample.path.
 * @property {string} tag
 * @property {string} text              First 40 chars of own text.
 * @property {[number,number,number,number]} bbox  Element box, page px.
 * @property {number[][]} rects         Boxes of its own text runs [x, y, w, h], page px (one per line fragment).
 * @property {string} color             Painted text color (-webkit-text-fill-color when it differs from color).
 * @property {number} opacity           Product of the element's and its ancestors' opacity.
 * @property {string} fontSize
 * @property {string} fontWeight
 * @property {boolean} disabled         Inside a disabled control/group, or the label of one (exempt from SC 1.4.3).
 */

/**
 * One text pair measured on one render (text-contrast.evaluateTexts).
 * @typedef {Object} ContrastPair
 * @property {string} key               path|text|occurrence; matches the same text across renders.
 * @property {string} text
 * @property {string} path
 * @property {'pass'|'fail'|'disabled'|'decorative'|'offscreen'|'invisible'|'no-glyphs'} status
 * @property {number} [ratio]           Measured ratio against the chosen background cluster.
 * @property {number} required          4.5, or 3 for large text.
 * @property {boolean} large
 * @property {string} [fg]              Text color as painted (composited when translucent).
 * @property {string} [bg]              Background cluster color measured on the pixels.
 * @property {[number,number,number,number]} [bbox]
 * @property {string[]} [tokens]        Tokens whose value is the text color (text-color tokens first).
 */

/**
 * Check 4 of verify (verify.json.contrast).
 * @typedef {Object} ContrastResult
 * @property {number} pairs             Text pairs measured on the original page.
 * @property {number} failingBefore     Of those, below the AA minimum.
 * @property {Record<string,number>} failingAfter  Per after-render: colors (color tokens), all (every token).
 * @property {ContrastPair[]} regressions  Passed before, fail after: blocks the gate.
 * @property {ContrastPair[]} improved     Failed before, pass after.
 * @property {ContrastPair[]} failing      The original page's failing pairs, worst first.
 * @property {Record<string,number>} skipped  Counts of pairs not measured, by status.
 * @property {boolean} pass             No regressions.
 * @property {string} [error]           Set when the check could not run (the other three checks still stand).
 */

/**
 * @typedef {Object} VerifyResult
 * @property {number} diffPixels
 * @property {number} totalPixels
 * @property {number} ratio             diffPixels / totalPixels.
 * @property {boolean} pass             ratio <= threshold.
 * @property {number} threshold
 * @property {string} before
 * @property {string} after
 * @property {string} diff
 * @property {ContrastResult} [contrast]  Text contrast check (pipeline verify only).
 */

export {}
