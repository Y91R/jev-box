# jev-box

**English** · [Русский](README.md)

A Claude Code plugin with skills where a cheap pass of [Jev](https://typesafe.ai/) from TypeSafe flags suspicious requirements in a spec and plan steps with no verifiable check. Jev is a model that does not write text but answers questions about a text and returns its confidence. Jev is called either directly at TypeSafe or through [OpenRouter](https://openrouter.ai/typesafe).

## Skills with Jev hints

The plugin ships four skills — copies of the global `analyst-reviewer`, `system-analyst`, `feature-planner` and `review-plan` with a cheap Jev pass:

- `/jev-box:analyst-reviewer <spec.md>` — before the codex review, Jev flags requirements (`- **FR-N.** …`) with no observable result or with an evaluative word lacking a threshold. The flags set the order of the own review and go to the codex prompt as one paragraph; codex and the full review always run.
- `/jev-box:system-analyst` — before handing over, the draft goes through the same pass; every flag is either fixed or kept with a reason in the summary.
- `/jev-box:feature-planner` — before the self-check, the saved plan goes through a step check: code flags steps with no `**Проверка:**` line and no file paths, Jev flags a check with no command and result, manual actions, and reliance on third-party behaviour without a way to verify it.
- `/jev-box:review-plan <plan.md>` — the same step check before the plan goes to codex; the flags set the order of the own review and go to the codex prompt as one paragraph.

Hints never block anything. The thresholds come from a preliminary calibration on `tests/fixtures/calibration` (jev-1.13.0, questions v1, ru, typesafe); with another model or provider the CLI says so in its header. The skills run `bun run ${CLAUDE_PLUGIN_ROOT}/cli/verify.ts` and open the sandbox to `api.typesafe.ai` and `openrouter.ai`; in the default permission mode Claude Code asks you to approve a run outside the sandbox. If Jev is unavailable, the summary says "Слой Jev пропущен: <code>" and the review runs as usual.

If the spec has a local source (a task file, a brief), `analyst-reviewer` makes a second pass that checks the spec against it: it flags requirements the source contradicts (`contradicts`) and requirements with no support in the source (`unsupported`). It only checks that nothing was made up; source constraints the spec left out are not searched for.

The same passes by hand:

```bash
bun run cli/verify.ts requirements <spec.md>
bun run cli/verify.ts sources <spec.md> --source <source.md>
bun run cli/verify.ts plan-steps <plan.md>
```

## Requirements

- **An API key** for TypeSafe or OpenRouter. Only one provider is used — the one set in the config.
- **[Bun](https://bun.sh/) 1.3+.**

## Installation

### 1. Install the plugin

The repository is also a Claude Code plugin marketplace. Add it and install the plugin:

```bash
claude plugin marketplace add Y91R/jev-box
claude plugin install jev-box@jev-box
```

The plugin installs for the user by default (`--scope user`). For a single project use `--scope project` or `--scope local`.

### 2. Create the config

Create `~/.config/jev-box/config.json` from the [`config.example.json`](config.example.json) template, set `provider` and the `apiKey` in that provider's section, and restrict access:

```bash
chmod 700 ~/.config/jev-box && chmod 600 ~/.config/jev-box/config.json
```

The keys live in the same file, so mode `600` is a must: only your user should be able to read it.

## Config

File: `~/.config/jev-box/config.json`. It is read on every CLI run.

| Field | Required | Default | Meaning |
|---|---|---|---|
| `provider` | yes | — | `"typesafe"` or `"openrouter"`: who to call Jev through |
| `timeoutMs` | no | `3000` | How long to wait for Jev, 1 to 9000 ms |
| `typesafe.apiKey` | if `provider = typesafe` | — | TypeSafe key |
| `typesafe.model` | no | `jev-latest` | Jev model at TypeSafe |
| `openrouter.apiKey` | if `provider = openrouter` | — | OpenRouter key |
| `openrouter.model` | no | `~typesafe/jev-latest` | Jev model on OpenRouter |

If the config fails validation, the CLI prints `Слой Jev пропущен: config_rule_N`: 1 — no file or not a JSON object, 2 — `provider`, 3 — `timeoutMs`, 4 — no key for the selected provider, 5 — `typesafe.model`, 6 — `openrouter.model`.

## Worth knowing

- **Text goes to the provider.** Requirements, plan steps and source passages are sent to TypeSafe or OpenRouter.

## Development

```bash
bun install          # in the Claude Code sandbox: BUN_TMPDIR="$TMPDIR" bun install
bun test             # all tests
bun test tests/cli/run.test.ts    # one file
bun test -t "plan"                # tests by name fragment
bun run typecheck                 # type check
claude plugin validate .                           # marketplace manifest
claude plugin validate .claude-plugin/plugin.json  # plugin and skills
```

Notes for Claude Code — [`CLAUDE.md`](CLAUDE.md).
