#!/usr/bin/env -S osascript -l JavaScript

ObjC.import('Foundation')

// The folder holding this script. Its path follows the language in osascript's
// arguments, and is relative to the folder Alfred runs it from.
const HERE = (() => {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)
  return $(args[args.indexOf('JavaScript') + 1]).stringByDeletingLastPathComponent.js || '.'
})()

const load = name =>
  eval($.NSString.stringWithContentsOfFileEncodingError(`${HERE}/${name}`, $.NSUTF8StringEncoding, null).js)

const { rexPath, listWorkspaces, actionsMissing } = load('lib.js')

const count = (total, noun) => `${total} ${noun}${total === 1 ? '' : 's'}`

const basename = path => path.split('/').pop()

const feed = items => JSON.stringify({ items })

const problem = (title, subtitle) => feed([{ title, subtitle, valid: false }])

const setupItem = () => feed([{
  title: 'Set up Rex Workspaces',
  subtitle: 'Press return to add the workspace actions to your Rex configuration',
  arg: 'setup',
  variables: { action: 'setup' },
}])

const toItem = (workspace, file) => ({
  uid: workspace.name,
  title: workspace.name,
  subtitle: `${workspace.running ? 'Running' : 'Not open'} · ${workspace.description || count(workspace.tabs, 'tab')}`,
  arg: workspace.name,
  match: `${workspace.name} ${workspace.description || ''}`,
  variables: { action: 'open' },
  mods: {
    cmd: { subtitle: `Edit ${basename(file)}`, arg: file, variables: { action: 'edit' } },
    alt: {
      subtitle: workspace.running
        ? 'Rebuild from its definition, closing the running session'
        : 'Not running, so this opens it fresh',
      variables: { action: 'rebuild' },
    },
  },
})

function run() {
  const rex = rexPath()
  if (!rex) return problem('Rex is not installed', 'Install Rex from superlogical.com/rex')

  let listing
  try {
    listing = listWorkspaces(rex)
  } catch (error) {
    if (actionsMissing(rex)) return setupItem()
    return problem('Could not list workspaces', error.message)
  }

  const { file, workspaces } = listing
  if (workspaces.length === 0) {
    return feed([{
      title: 'No workspaces yet',
      subtitle: `Press return to add some to ${basename(file)}`,
      arg: file,
      variables: { action: 'edit' },
    }])
  }

  return feed(workspaces.map(workspace => toItem(workspace, file)))
}
