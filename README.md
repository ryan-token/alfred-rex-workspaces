# Rex Workspaces for Alfred

An [Alfred workflow](https://www.alfredapp.com/workflows/) that opens your [Rex](https://www.superlogical.com/rex) workspaces. A workspace is a named Rex session with its tabs, splits, working directories and startup commands, so one keyword gets you back to a whole working setup.

Rex sessions keep running when nothing is showing them, so opening a workspace that is already running switches straight to it, exactly as you left it. Only a workspace that isn't running is built, from its definition. That makes this a successor to [Ghostty Launch Configurations](https://github.com/ryan-token/alfred-ghostty-launch-configs) rather than a port: the layout is a starting point, and the session is what you come back to.

## Requirements

- Alfred 5 with the [Powerpack](https://www.alfredapp.com/powerpack/)
- Rex for Mac, with **Remote Control** turned on in Settings → Rex Server

Remote Control lets the workflow tell the Rex app which session to show.

## Install

Rex does the work and Alfred is one way to ask for it, so there are two parts.

1. **The Rex actions.** Copy the files in [`rex/`](rex) into your Rex configuration folder, `~/.config/rex`, renaming the example:

   ```sh
   cp rex/workspace_actions.lua ~/.config/rex/
   cp rex/workspaces.example.lua ~/.config/rex/workspaces.lua
   ```

   Then load the actions from `~/.config/rex/init.lua`, creating it if you don't have one, and reload:

   ```lua
   require("workspace_actions")
   ```

   ```sh
   rex config reload
   ```

2. **The workflow.** Download the latest `.alfredworkflow` from [Releases](https://github.com/ryan-token/alfred-rex-workspaces/releases) and double click it.

## Usage

Browse your workspaces with the `ws` keyword. Each one says whether it's running.

- <kbd>↩</kbd> Open the workspace, building it first if it isn't running
- <kbd>⌘</kbd><kbd>↩</kbd> Edit `workspaces.lua`
- <kbd>⌥</kbd><kbd>↩</kbd> Rebuild the workspace from its definition. A running one is closed first, after you confirm, along with everything running in it.

Workspaces can also be opened from a script or a hotkey using the `open` external trigger:

```sh
osascript -e 'tell application "Alfred 5" to run trigger "open" \
  in workflow "com.ryantoken.rex-workspaces" with argument "Work"'
```

Because the actions live in Rex, the workflow is only one way in. The same workspaces open from Rex's command palette ("Open Workspace: Work"), from a key you bind in `init.lua`, and from the CLI:

```sh
rex do workspace name=Work
rex do workspace name=Work rebuild=true
rex do workspaces --json
```

## Defining workspaces

`workspaces.lua` returns a list of workspaces. Alfred lists them in this order at first, then learns to put the ones you open most at the top:

```lua
return {
  {
    name = "Work",
    description = "The API and the web app",
    cwd = "~/code",
    tabs = {
      { title = "API", cwd = "api", focus = true },
      {
        title = "Web",
        cwd = "web",
        split = { direction = "right", ratio = 0.4, command = "npm run dev" },
      },
    },
  },
}
```

| Field | Where | Meaning |
| --- | --- | --- |
| `name` | workspace | The session's label. Matched without case. |
| `description` | workspace | Subtitle in Alfred. Defaults to the tab count. |
| `cwd` | workspace | The folder tabs are relative to. Defaults to `~`. |
| `tabs` | workspace | The tabs, in order. Each is a pane with a few extra fields. |
| `title` | tab | Tab title. |
| `focus` | tab | Show this tab when the workspace is built. Defaults to the first. |
| `cwd` | pane | Working directory. A tab's is relative to the workspace's, a split's to its tab's. `~` and absolute paths work anywhere. |
| `command` | pane | Typed into the shell at startup. The shell stays open afterwards. |
| `split` | pane | Another pane beside this one. |
| `direction` | split | `right`, `left`, `down` or `up`. Defaults to `right`. |
| `ratio` | split | The new pane's share of the space, from 0 to 1. Defaults to 0.5. |

A split can have its own `split`, so a pane divided right and then down gives one column on the left and two rows on the right.

Both actions read `workspaces.lua` each time they run, so edits apply on the next launch without reloading Rex. The command palette's entries are made when the configuration loads, so adding or renaming a workspace needs `rex config reload` to show there. A running workspace keeps its current state until you rebuild it.

The whole file is checked every time it's read, so a mistake anywhere, from a syntax error to a misspelled split direction, shows up in Alfred straight away with the workspace and tab it's in. Rebuilding checks the definition before it closes anything, so a mistake never costs you a running session.

## Configuration

Open the workflow's configuration in Alfred to change its **Keyword**, `ws` by default.

## Building from source

```sh
./build.sh
```

That writes `dist/alfred-rex-workspaces.alfredworkflow`. The icon is generated rather than stored as source art:

```sh
swift icon/make-icon.swift
```

The workflow is two [JXA](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/) scripts. `list.js` asks Rex for the workspaces and builds Alfred's result list, and `open.js` asks Rex to open one. What they share, such as finding and running `rex`, is in `lib.js`, which each evaluates since JXA has no module system. There are no dependencies to install and no network access.

They find the `rex` CLI on their own, since Alfred doesn't run them with your shell's `PATH`. They prefer the copy installed with the running server, which always matches it, and fall back to the one inside the app.

## Tests

```sh
./tests/run.js
```

The tests run both scripts the way Alfred runs them, against a fake `rex` that answers from a throwaway folder and records every call. Nothing touches a real Rex server or app, so they run anywhere, including CI.

## License

MIT, see [LICENSE](LICENSE).
