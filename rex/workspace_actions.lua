-- Workspaces: named Rex sessions, defined in workspaces.lua beside this file.
--
-- `workspace` switches the app to a workspace's session, building the session from
-- its definition first when it isn't running. `workspaces` lists the definitions and
-- which are running, for launchers such as the Rex Workspaces Alfred workflow.
--
-- Both read workspaces.lua each time they run, so an edit applies on the next launch
-- without `rex config reload`. Only the command palette's per-workspace entries are
-- made at load time, so adding or renaming a workspace needs a reload to show there.

local SHELL = "com.superlogical.terminal.shell"
local HOME = os.getenv("HOME")

-- Rex loads modules by full path, so the definitions sit beside this file. The
-- documented config folder is the fallback should that ever change. Rex reports the
-- path bare, where stock Lua prefixes it with `@`, so the prefix is optional.
local function config_dir()
  local dir = debug.getinfo(1, "S").source:match("^@?(/.*)/[^/]*$")
  return dir or (os.getenv("XDG_CONFIG_HOME") or HOME .. "/.config") .. "/rex"
end

local FILE = config_dir() .. "/workspaces.lua"

-- Each direction is the split shape and whether the new pane goes before the old one.
local SPLITS = {
  right = { rex.layout.horizontal, false },
  left = { rex.layout.horizontal, true },
  down = { rex.layout.vertical, false },
  up = { rex.layout.vertical, true },
}

local function fail(where, problem)
  error("workspaces.lua: " .. where .. " " .. problem, 0)
end

-- `~` is the home folder, and a relative path is relative to `base`.
local function resolve(path, base, where)
  if path == nil then return base end
  if type(path) ~= "string" then fail(where, "has a cwd that isn't a string") end
  if path == "~" or path:sub(1, 2) == "~/" then return HOME .. path:sub(2) end
  if path:sub(1, 1) == "/" then return path end
  return base .. "/" .. path
end

-- A pane is a shell in `cwd`, optionally typing `command`, and optionally divided by
-- `split`, which is itself a pane. `cwd` is the pane's resolved folder, and splits at
-- any depth resolve theirs against `tab_cwd`.
local function pane_layout(pane, cwd, tab_cwd, where)
  local options = { cwd = cwd }
  if pane.command ~= nil then
    if type(pane.command) ~= "string" then fail(where, "has a command that isn't a string") end
    -- Typed rather than run, so the shell stays open after the command exits.
    options.initial_input = pane.command .. "\n"
  end
  local block = rex.layout.block{ flavor = SHELL, options = options }

  local split = pane.split
  if split == nil then return block end
  if type(split) ~= "table" then fail(where, "has a split that isn't a table") end

  local direction = split.direction or "right"
  local shape = SPLITS[direction]
  if shape == nil then
    fail(where, 'has split direction "' .. tostring(direction) .. '", which should be right, left, down or up')
  end
  -- `ratio` is the new pane's share; the layout's ratio is the first pane's.
  local share = split.ratio or 0.5
  if type(share) ~= "number" or share <= 0 or share >= 1 then
    fail(where, "has a split ratio that isn't between 0 and 1")
  end

  local build, new_first = shape[1], shape[2]
  local new = pane_layout(split, resolve(split.cwd, tab_cwd, where), tab_cwd, where)
  if new_first then return build(share, new, block) end
  return build(1 - share, block, new)
end

-- The windows to create the workspace's session with, and which of them to focus.
local function build_windows(workspace, where)
  if type(workspace.tabs) ~= "table" or #workspace.tabs == 0 then fail(where, "has no tabs") end

  local base = resolve(workspace.cwd, HOME, where)
  local windows, focus = {}, 1
  for index, tab in ipairs(workspace.tabs) do
    local tab_where = where .. " tab " .. index
    if type(tab) ~= "table" then fail(tab_where, "isn't a table") end
    if tab.title ~= nil and type(tab.title) ~= "string" then fail(tab_where, "has a title that isn't a string") end

    local tab_cwd = resolve(tab.cwd, base, tab_where)
    windows[index] = {
      window_label = tab.title,
      layout = pane_layout(tab, tab_cwd, tab_cwd, tab_where),
    }
    if tab.focus then focus = index end
  end
  return windows, focus
end

-- Reads and checks every definition, so a mistake anywhere is reported before
-- anything is built or closed. Each workspace gains its `windows` and `focus`.
local function load_workspaces()
  local ok, result = pcall(dofile, FILE)
  if not ok then error(tostring(result), 0) end
  if type(result) ~= "table" then error(FILE .. " should return a list of workspaces", 0) end

  local seen = {}
  for index, workspace in ipairs(result) do
    local where = "workspace " .. index
    if type(workspace) ~= "table" then fail(where, "isn't a table") end
    if type(workspace.name) ~= "string" or workspace.name == "" then fail(where, "needs a name") end

    where = workspace.name
    -- Names become session labels, which Rex matches without case.
    local key = workspace.name:lower()
    if seen[key] then fail(where, "is defined twice") end
    seen[key] = true

    workspace.windows, workspace.focus = build_windows(workspace, where)
  end
  return result
end

local function find_workspace(name)
  local wanted = name:lower()
  for _, workspace in ipairs(load_workspaces()) do
    if workspace.name:lower() == wanted then return workspace end
  end
  error("no workspace named " .. name .. " in " .. FILE, 0)
end

-- Labels are matched without case, the same way the CLI matches targets.
local function running_sessions()
  local list, err = rex.call("session.list")
  if err ~= nil then error(err, 0) end
  local sessions = {}
  for _, session in ipairs(list.sessions or {}) do
    if session.label then
      local key = session.label:lower()
      sessions[key] = sessions[key] or session.session_id
    end
  end
  return sessions
end

-- Calls `method` on a session other than the caller's own. The server only accepts
-- such calls from a connection attached to the session, so attach for the call.
-- These go through rex.call because rex.session has no attach in the config file.
local function call_in(session_id, method, args)
  local _, err = rex.call("session.attach", { session_id = session_id })
  if err ~= nil then error(err, 0) end
  args.session_id = session_id
  local result, call_err = rex.call(method, args)
  -- A destroyed session has nothing left to detach from, so this may fail harmlessly.
  rex.call("session.detach", { session_id = session_id })
  if call_err ~= nil then error(call_err, 0) end
  return result
end

local function create(workspace)
  local made, err = rex.call("session.create", { label = workspace.name, initial_windows = workspace.windows })
  if err ~= nil then error(err, 0) end

  -- The last window created is active, so move to the one the definition asks for.
  local window_id = made.initial_windows[workspace.focus].window_id
  call_in(made.session_id, "session.focus_window", { window_id = window_id })
  return made.session_id, window_id
end

local function open(name, rebuild)
  -- Finding the workspace checks its whole definition, so a rebuild never closes a
  -- session it can't replace.
  local workspace = find_workspace(name)
  local session_id = running_sessions()[workspace.name:lower()]

  if session_id and rebuild then
    call_in(session_id, "session.destroy", {})
    session_id = nil
  end

  local created, window_id = false, nil
  if session_id == nil then
    session_id, window_id = create(workspace)
    created = true
  end

  -- Without a client, such as `rex do` with no app open, the session is still built.
  local shown = pcall(rex.client.queue, "session.select", { session_id = session_id, window_id = window_id })
  return { session_id = session_id, created = created, shown = shown }
end

rex.action{
  name = "workspace",
  title = "Open Workspace",
  description = "Switch to a workspace from workspaces.lua, building its session if it isn't running.",
  category = "Workspaces",
  args = { name = "string", rebuild = "boolean?" },
  run = function(ctx, args)
    return open(args.name, args.rebuild)
  end,
}

rex.action{
  name = "workspaces",
  title = "List Workspaces",
  description = "List the workspaces in workspaces.lua and whether each is running.",
  category = "Workspaces",
  run = function(ctx, args)
    local sessions = running_sessions()
    local list = {}
    for _, workspace in ipairs(load_workspaces()) do
      list[#list + 1] = {
        name = workspace.name,
        description = workspace.description,
        tabs = #workspace.tabs,
        running = sessions[workspace.name:lower()] ~= nil,
      }
    end
    return { file = FILE, workspaces = list }
  end,
}

-- One palette entry per workspace. A broken workspaces.lua only costs these entries,
-- not the rest of the configuration.
local ok, workspaces = pcall(load_workspaces)
if not ok then
  rex.log("warn", "workspace palette entries skipped: " .. workspaces)
  workspaces = {}
end

local named = {}
for _, workspace in ipairs(workspaces) do
  local slug = workspace.name:lower():gsub("[^%w]+", "_"):gsub("^_+", ""):gsub("_+$", "")
  -- Distinct names can share a slug, such as "My Work" and "my-work".
  if slug == "" or named[slug] then
    rex.log("warn", "no palette entry for workspace " .. workspace.name .. ": its action name is taken")
  else
    named[slug] = true
    rex.action{
      name = "open_workspace_" .. slug,
      title = "Open Workspace: " .. workspace.name,
      description = workspace.description,
      category = "Workspaces",
      run = function(ctx, args)
        return open(workspace.name, false)
      end,
    }
  end
end
