// Muse Code provider: opens a real PR instead of writing to a local copy. Stubbed until Meta
// Model API access lands — there is no base URL/key to call yet, so this always throws.
//
// TODO once access lands:
//   1. Run the deterministic coder (src/providers/coder/deterministic.js) with write=false to
//      get the edit plan (RewriteEdit[]) — same token-selection rules, no model needed for that part.
//   2. Create a new branch off the current HEAD. Never run on the default branch (check first;
//      refuse with a clear error if `git branch --show-current` is main/master).
//   3. Apply the deterministic edits to targetDir (not a copy) and commit.
//   4. Run the verify stage (src/stages/verify.js) against the branch.
//   5. Open a PR via `gh pr create`; PR body lists the tokens introduced (name + cssVar + count
//      of edits per token) and the verify result (pass/fail, ratio).
//   Muse Code's role is step 1/5 once the API is live: it can refine the edit plan or write the
//   PR body/commit message; the mechanical apply stays deterministic either way.
//
// @type {import('../../types.js').CoderProvider}
export default function metaCodeCoder() {
  return {
    id: 'meta-code',
    async rewrite() {
      throw new Error(
        'Muse Code provider not configured yet: no Meta Model API base URL/key. ' +
        'It will hand the deterministic edit plan to Muse Code to open a PR once Meta Model API ' +
        'access lands — see the TODO block in src/providers/coder/meta-code.js for the intended flow.'
      )
    },
  }
}
