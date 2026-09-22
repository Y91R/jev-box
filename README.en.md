# jev-box

**English** · [Русский](README.md)

A Claude Code plugin that decides, before every turn, which Claude model the turn needs. Simple requests ("rename this variable") go to a cheap model, hard ones ("design a migration") to a strong one. The decision is made by [Jev](https://typesafe.ai/) from TypeSafe — a model that does not write text but picks an option from a list and returns its confidence. Jev is called either directly at TypeSafe or through [OpenRouter](https://openrouter.ai/typesafe).

The plugin runs on **Function Hooks**, a preview feature of Claude Code enabled by the `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` environment variable. Without it the plugin does nothing.

## What it does

- **Main loop.** For every prompt it asks Jev which model from your list to use and sends every request of that turn to it.
- **Subagents.** For subagents of the listed types (`general-purpose` by default) the model is picked the same way, from the task description. Forks and calls that name a model explicitly are left alone.
- **Context window.** A model is offered only while the current context fills at most a set share of its window (half by default), so a long session never moves to a model with a small window.
- **Failures.** If Jev does not answer within the timeout, returns an error, picks a model outside the list, or the config is broken, the turn runs on the session model as usual, and the failure is written as one line in the transcript.
- **Left alone.** `effort`, and the fallback model Claude Code switches to by itself.

## Requirements

- **Claude Code with the Function Hooks preview runtime.** Tested on 2.1.278; third-party articles say the runtime ships since 2.1.260.
- **An API key** for TypeSafe or OpenRouter. Only one provider is used — the one named in the config.
- **For development only:** [Bun](https://bun.sh/) 1.3+. The plugin itself does not need Bun.

## Installation

### 1. Install the plugin

The repository is also a Claude Code plugin marketplace. Add it and install the plugin:

```bash
claude plugin marketplace add Y91R/jev-box
claude plugin install jev-box@jev-box
```

The plugin is installed for the user by default (`--scope user`); use `--scope project` or `--scope local` for a single project.

### 2. Fill in the config

The config creates itself. On the first Claude Code start with Function Hooks enabled (step 3), the plugin creates `~/.config/jev-box/config.json` from its template, restricts access (`chmod 600` on the file, `700` on the directory) and writes to the transcript:

```
jev-box: created ~/.config/jev-box/config.json, set provider and apiKey to start
```

An existing config is never overwritten. If the line ends with `run chmod 600 …`, the permissions could not be set; run the command yourself.

Open `~/.config/jev-box/config.json` and fill in:

- **`provider`** — `"openrouter"` or `"typesafe"`;
- **`apiKey`** in the section of that provider;
- **`description`** of each model — Jev compares the task against these descriptions, so tailor them to your work.

The keys live in this file, so keep the permissions at `600`: only your user should be able to read it. Until a key is set the plugin does nothing; edits are picked up without a restart.

### 3. Enable Function Hooks

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

To avoid typing it every time, add it to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

### 4. Check it works

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "Reply with the single word: pong" \
  --model claude-opus-5 --output-format json | grep -o '"modelUsage":{"[^"]*'
```

When the plugin works, `modelUsage` shows `claude-haiku-4-5` instead of `claude-opus-5`: Jev judged the request simple. If the model did not change, open an interactive session and send any prompt — the reason appears as a `jev-box: …` line in the transcript (these lines are not printed in `-p` mode).

## Config

File: `~/.config/jev-box/config.json`; template: [`config.example.json`](config.example.json). The config is re-read before every classification, so edits apply without a restart.

| Field | Required | Default | Meaning |
|---|---|---|---|
| `provider` | yes | — | `"typesafe"` or `"openrouter"`: how Jev is called |
| `models` | yes | — | Models Jev chooses from, 1 to 255 |
| `models[].id` | yes | — | Full Claude model ID, e.g. `claude-opus-5` |
| `models[].description` | yes | — | When this model should be picked |
| `models[].contextWindow` | yes | — | Context window of the model, in tokens |
| `subagentTypes` | no | `["general-purpose"]` | Subagent types whose model the plugin picks |
| `timeoutMs` | no | `3000` | How long to wait for Jev, 1 to 9000 ms (a hook has a 10 s budget) |
| `contextReserve` | no | `0.5` | Share of a model's window the current context may fill for the model to stay on the list |
| `logLevel` | no | `"off"` | `"debug"` turns on the [debug log](#debug-log) |
| `minConfidence` | no | — | Jev confidence threshold, 0 to 1; below it the turn stays on the session model |
| `typesafe.apiKey` | if `provider = typesafe` | — | TypeSafe key |
| `typesafe.model` | no | `jev-latest` | Jev model at TypeSafe |
| `openrouter.apiKey` | if `provider = openrouter` | — | OpenRouter key |
| `openrouter.model` | no | `~typesafe/jev-latest` | Jev model at OpenRouter |

## Transcript lines

| Line | Meaning |
|---|---|
| `jev-box: config ignored, rule N failed at <field>` | The config failed validation; the plugin does nothing until it is fixed. Rule numbers follow FR-4 in the [requirements](docs/requirements/model_choice.md) (in Russian) |
| `jev-box: <provider> timeout` | Jev did not answer within `timeoutMs` |
| `jev-box: <provider> network` | The request could not be sent |
| `jev-box: <provider> http_<code>` | The provider returned an error, e.g. `http_401` for a bad key, `http_402` for no OpenRouter credits |
| `jev-box: <provider> bad_response` | The answer could not be parsed |
| `jev-box: <provider> unknown_model` | Jev picked a model outside the list |
| `jev-box: internal`, `jev-box: <provider> internal` | Internal plugin error; the provider is named once the config has been read |

In all these cases the turn runs on the session model.

## Debug log

Set `"logLevel": "debug"` in the config and the plugin logs every session to `~/.config/jev-box/logs/<session id>.jsonl`. The session id is the one `claude --resume` uses and the `session_id` field of `claude -p --output-format json`.

Each line is a JSON object with `ts`, `event` and the event's data:

| Event | Contents |
|---|---|
| `turn_start` | prompt head (first 200 characters and length), context fill, which models stayed candidates and which were dropped by window |
| `jev_request` | provider, URL, Jev model, candidates, timeout |
| `jev_response` / `jev_failure` | status, response time, Jev's choice, confidence and per-model probabilities — or the failure code |
| `decision` | the resulting model or why there is none |
| `step` | which model each step of the turn went to and why: `switched`, `fallback`, `no_decision`, `step0_missing`, `aborted` |
| `spawn` | subagent: type, task head, chosen model or why it was skipped |
| `turn_complete`, `session_start`, `session_end`, `config_invalid`, `internal` | housekeeping |

`jq` makes it easy to read:

```bash
jq -c 'select(.event == "jev_response" or .event == "step")' ~/.config/jev-box/logs/<id>.jsonl
```

Good to know:
- **No keys are logged,** but the head of every prompt is. The plugin cannot set file permissions, so the file follows your umask; lock the directory down with `chmod 700 ~/.config/jev-box`.
- **Each file keeps the session's last 2000 entries.**
- **Old files are not removed:** the Function Hooks API cannot delete files. Clean up yourself, e.g. `find ~/.config/jev-box/logs -name '*.jsonl' -mtime +7 -delete`.
- **To turn it off,** set `"logLevel": "off"` or drop the field.

## Good to know

- **Your text goes to the provider.** Every prompt and every subagent task is sent in full to TypeSafe or OpenRouter.
- **Prompt cache.** Each model has its own prompt cache, so switching models between turns re-writes the context to the cache. Within one turn the model never changes.
- **Latency.** Classification adds Jev's response time to the turn — 1 to 2.5 s in practice.
- **Preview API.** Function Hooks is a preview API and may change in later Claude Code versions.

## Development

```bash
bun install          # in the Claude Code sandbox: BUN_TMPDIR="$TMPDIR" bun install
bun test             # all tests
bun test tests/jev.test.ts        # one file
bun test -t "fork"                # tests matching a name
./node_modules/.bin/tsc -p .      # type check
claude plugin validate .                           # marketplace manifest
claude plugin validate .claude-plugin/plugin.json  # plugin and hooks
```

Behaviour requirements: [`docs/requirements/model_choice.md`](docs/requirements/model_choice.md) (in Russian); notes for Claude Code: [`CLAUDE.md`](CLAUDE.md).
