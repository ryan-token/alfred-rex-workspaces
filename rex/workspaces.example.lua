-- Workspaces for the `workspace` action in workspace_actions.lua: open one from the
-- command palette, with `rex do workspace name=Work`, or from Alfred.
-- Edits apply on the next launch. A running workspace keeps its current state;
-- rebuild it to pick up changes (⌥↩ in Alfred, or `rebuild=true`).
--
-- Workspace:
--   name         the session's label, matched without case
--   description  shown in Alfred
--   cwd          the folder tabs are relative to (default ~)
--   tabs         in order, each a pane with a `title` and optionally `focus = true`
--
-- Pane:
--   cwd          relative to the workspace's cwd for a tab, or the tab's for a split
--   command      typed into the shell, which stays open afterwards
--   split        another pane beside this one, with `direction` (right, left,
--                down or up; default right) and `ratio` (its share, default 0.5)

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
        command = "git status",
        split = {
          direction = "right",
          ratio = 0.4,
          command = "npm run dev",
          split = { direction = "down", cwd = "~/notes" },
        },
      },
    },
  },
  {
    name = "Notes",
    tabs = {
      { title = "Notes", cwd = "~/notes" },
    },
  },
}
