# Icons: animated agent status icons for herdr

A [herdr](https://herdr.dev) plugin that replaces the static status dot in the sidebar with small animated icons, one per agent state, and puts the state name next to each agent:

```
⠹ · api          ! · web          ✓ · infra        ○ · docs
  claude · working  codex · blocked  pi · done       claude · idle
```

| state | `minimal` (default) | `classic` | `face` |
|---|---|---|---|
| working | spinner `⠋⠙⠹⠸…` | equalizer bars `⣾⣧⣀` | eyes darting `⠶⠀⠶` |
| blocked (needs your input) | blinking `!` | blinking `!` `⡇⣛⢸` | wide eyes ↔ `> <` |
| done (finished, not seen yet) | `✓` | check mark that draws itself `⢄⡠⠊` | happy `^ ^` |
| idle | `○` | breathing dot `⠀⠶⠀` | blinking eyes |
| unknown | `·` | `⠤⠀⠤` | `⠤⠀⠤` |

`minimal` uses one familiar symbol per state. `classic` and `face` are 6×4 pixel animations drawn with braille characters (3 cells wide). Each state has its own color, and icons show in the Agents panel and, for each space's rolled-up state, in the Spaces panel.

## How it works

herdr plugins can't draw in the sidebar directly, but sidebar rows can show custom `$name` tokens that scripts report as pane or workspace metadata. So:

1. A small animator (the plugin's `[[startup]]` hook) polls `agent.list` / `workspace.list` twice a second and sends the current animation frame as a token: `$icon_working`, `$icon_blocked`, `$icon_done`, `$icon_idle` or `$icon_unknown`. Only the token for the current state has a value, so each state gets its own color in the config.
2. Your `config.toml` sidebar rows show those tokens where `state_icon` used to be.

Details:
- Frames are only sent when they change. Static icons are re-sent every 5 s.
- Tokens expire after 15 s, so if the animator dies, the icons disappear instead of freezing.
- Requests are capped (`maxRequestsPerSecond`). With 4 agents the animator uses about 1% CPU.
- Only one animator runs per herdr socket. It exits on its own about 30 s after herdr stops, and it survives a quick herdr restart.

## Requirements

- herdr ≥ 0.9.5 (`herdr update`), on macOS or Linux
- Node.js ≥ 20

## Install

```sh
git clone https://github.com/dzhiganov/herdr-icons ~/projects/herdr-icons
cd ~/projects/herdr-icons
npm ci && npm run build
herdr plugin link .
npm run setup-sidebar      # adds the icon tokens to ~/.config/herdr/config.toml and reloads it
```

The animator starts with herdr. To start it now without restarting herdr:

```sh
herdr plugin action invoke dima.icons.restart
```

### The sidebar rows

`npm run setup-sidebar` (or the `dima.icons.setup-sidebar` action) appends this block to `config.toml`. It backs the file up to `config.toml.bak` first:

```toml
# >>> herdr-icons
[ui.sidebar.agents]
rows = [
  [{ token = "$icon_working", fg = "#f9e2af" }, { token = "$icon_blocked", fg = "#f38ba8" }, { token = "$icon_done", fg = "#a6e3a1" }, { token = "$icon_idle", fg = "#89b4fa" }, { token = "$icon_unknown", fg = "#6c7086" }, "machine", "workspace", "tab"],
  ["agent", "state_text"],
]

[ui.sidebar.spaces]
rows = [
  [ …same five tokens… , "workspace"],
  ["branch", "git_status"],
]
# <<< herdr-icons
```

These are herdr's default rows with `state_icon` swapped for the five icon tokens, plus `state_text` (the state name) next to the agent. Change the colors, or move the tokens anywhere in your rows.

If your config already has its own `[ui.sidebar.agents]` / `[ui.sidebar.spaces]` rows, setup leaves the file alone. It prints the block instead (`npm run setup-sidebar -- --print`), so you can swap `state_icon` yourself. Undo with `npm run setup-sidebar -- --remove` (or the `dima.icons.remove-sidebar` action).

herdr always puts ` · ` between tokens, so a row reads `⣾⣧⣀ · api`. The collapsed sidebar rail still uses herdr's built-in dots.

## Actions

Bind any of these to a key with `[[keys.command]]`, `type = "plugin_action"`:

| action | does |
|---|---|
| `dima.icons.preview` | popup with every set animating; press `1`–`9` to use a set, `q` to close |
| `dima.icons.setup-sidebar` | add the icon tokens to the sidebar rows |
| `dima.icons.remove-sidebar` | remove them again |
| `dima.icons.restart` | restart the animator (e.g. after `npm run build`) |
| `dima.icons.stop` | stop it and clear the icons |

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "dima.icons.preview"
description = "Icon preview"
```

`npm run preview` shows the same preview in any terminal.

## Config

`~/.config/herdr/plugins/config/dima.icons/config.json` is written with the defaults on first run. The animator re-reads it within 3 s of a change.

```jsonc
{
  "set": "minimal",            // "minimal", "classic" or "face"
  "speed": 1,                  // animation speed multiplier; 0 = static icons
  "spaces": true,              // also animate spaces (Spaces panel)
  "maxRequestsPerSecond": 60   // frames are dropped above this
}
```

Logs: herdr's plugin log (`herdr plugin log list`) for the startup animator, and `~/.local/state/herdr/plugins/dima.icons/animator.log` for one started by `restart`.

## Add an icon set

Sets live in `src/sprites.ts`. Each frame is a 4-row pixel grid (`#` = lit), and `toBraille` turns it into characters:

```ts
const BANG = ['..##..', '..##..', '......', '..##..'];
blocked: anim(4, [BANG, BANG_LOUD, BANG, blank(6)]),  // 4 fps
```

Add the set to `ICON_SETS` and it shows up in the preview and in the `set` option.

## Development

```sh
npm test          # unit tests (vitest)
npm run typecheck
npm run build
```

Socket API notes, verified against herdr 0.9.5:
- One request per connection.
- `pane.report_metadata` / `workspace.report_metadata` take a `seq`, which must increase per source. The animator seeds it from the clock, so a restarted animator isn't ignored.
- `pane.agent_status_changed` subscriptions need a `pane_id`, which is why the animator polls instead.
