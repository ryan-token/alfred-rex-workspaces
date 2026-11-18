#!/usr/bin/env -S osascript -l JavaScript

ObjC.import('Foundation')
ObjC.import('AppKit')

// The folder holding this script. Its path follows the language in osascript's
// arguments, and is relative to the folder Alfred runs it from.
const HERE = (() => {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)
  return $(args[args.indexOf('JavaScript') + 1]).stringByDeletingLastPathComponent.js || '.'
})()

const load = name =>
  eval($.NSString.stringWithContentsOfFileEncodingError(`${HERE}/${name}`, $.NSUTF8StringEncoding, null).js)

const {
  REX_BUNDLE_ID, env, rexPath, readText, execute, failureReason, parseJSON, listWorkspaces,
} = load('lib.js')

const CONNECT_TIMEOUT = 15

const manager = $.NSFileManager.defaultManager

// Editors are for a person, so they only open when Alfred runs the script, never
// when the tests do.
const interactive = Boolean(env('alfred_workflow_bundleid'))

const requireRex = () => {
  const rex = rexPath()
  if (!rex) throw new Error('Rex is not installed')
  return rex
}

// Opening a workspace

// The Rex app on this Mac, or null until it has connected. Apps on other devices can
// join over Tailscale, so the local one is the app on the server's Unix socket. A
// failure counts as not connected, since the server may still be starting.
const localApp = rex => {
  const result = execute(rex, ['client', 'ls', '--json'])
  if (result.status !== 0) return null

  const clients = parseJSON(result).clients || []
  return clients.find(client =>
    client.info && client.info.kind === 'app' && client.info.platform === 'macos' &&
    client.principal && client.principal.transport === 'unix') || null
}

const connectApp = rex => {
  const client = localApp(rex)
  if (client) return client

  // Opened in the background, and brought forward once the workspace is selected.
  const launch = execute('/usr/bin/open', ['-g', '-b', REX_BUNDLE_ID])
  if (launch.status !== 0) throw new Error(`Could not open Rex: ${launch.stderr || `open exited with status ${launch.status}`}`)

  const deadline = Date.now() + CONNECT_TIMEOUT * 1000
  while (Date.now() < deadline) {
    $.NSThread.sleepForTimeInterval(0.25)
    const connected = localApp(rex)
    if (connected) return connected
  }
  throw new Error(`Rex did not connect within ${CONNECT_TIMEOUT} seconds`)
}

const activate = client => {
  const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(client.principal.pid)
  if (running.isNil()) return
  // `open` is what reliably brings an app forward from a background process.
  execute('/usr/bin/open', ['-b', running.bundleIdentifier.js])
}

// Asked of Rex now rather than when the list was shown, since the session may have
// started or stopped since, and the external trigger has no list at all.
const isRunning = (rex, name) =>
  listWorkspaces(rex).workspaces.some(workspace => workspace.running && workspace.name.toLowerCase() === name.toLowerCase())

// Rebuilding a running workspace waits for the Confirm Rebuild UI, which runs the
// script again with `confirmed` set once the user agrees.
const open = (name, { rebuild }) => {
  const rex = requireRex()
  if (rebuild && env('confirmed') !== 'true' && isRunning(rex, name)) return { next: 'confirm', arg: name }

  const client = connectApp(rex)
  const args = ['-C', client.client_id, 'do', 'rexws_open', `name=${name}`]
  if (rebuild) args.push('rebuild=true')

  const result = execute(rex, args)
  if (result.status !== 0) throw new Error(failureReason(result))
  activate(client)
  return null
}

// Editing a file

const reveal = path => {
  if (!manager.fileExistsAtPath(path)) throw new Error(`Nothing to open at ${path}`)

  const workspace = $.NSWorkspace.sharedWorkspace
  const url = $.NSURL.fileURLWithPath(path)
  // Falls back to Finder when nothing on the machine claims .lua files.
  if (!workspace.openURL(url)) workspace.activateFileViewerSelectingURLs($([url]))
}

// Setting up Rex: the workflow ships the actions it calls in its rex folder.

const REQUIRE_LINE = 'require("workspace_actions")'

// Copies a file into place unless something is already there, so nothing the user
// has written is ever replaced.
const installFile = (source, destination) => {
  if (manager.fileExistsAtPath(destination)) return
  if (!manager.copyItemAtPathToPathError(source, destination, null)) throw new Error(`Could not create ${destination}`)
}

// Appends to init.lua rather than rewriting it, which keeps it in place when it's a
// symlink into a dotfiles repository.
const addRequire = initFile => {
  if (!manager.fileExistsAtPath(initFile)) {
    manager.createFileAtPathContentsAttributes(initFile, $(), $())
  }
  const current = readText(initFile)
  if (/^\s*require\s*\(?\s*["']workspace_actions["']/m.test(current)) return

  const gap = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n'
  const addition = `${gap}-- Named workspaces, defined in workspaces.lua.\n${REQUIRE_LINE}\n`
  const handle = $.NSFileHandle.fileHandleForUpdatingAtPath(initFile)
  if (handle.isNil()) throw new Error(`Could not update ${initFile}`)
  handle.seekToEndOfFile
  handle.writeData($(addition).dataUsingEncoding($.NSUTF8StringEncoding))
  handle.closeFile
}

// Returns the workspaces.lua that setup leaves in place.
const setup = () => {
  const rex = requireRex()

  // Rex knows where its configuration lives, which XDG_CONFIG_HOME or REX_CONFIG can move.
  const initFile = parseJSON(execute(rex, ['config', 'check', '--json'])).path
  if (!initFile) throw new Error('Rex did not say where its configuration is')
  const folder = $(initFile).stringByDeletingLastPathComponent.js
  manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, true, $(), null)

  installFile(`${HERE}/rex/workspace_actions.lua`, `${folder}/workspace_actions.lua`)
  installFile(`${HERE}/rex/workspaces.example.lua`, `${folder}/workspaces.lua`)
  addRequire(initFile)

  const reload = execute(rex, ['config', 'reload'])
  if (reload.status !== 0) throw new Error(failureReason(reload))
  return `${folder}/workspaces.lua`
}

// Entry point

// What the workflow should do next, as Alfred's JSON for a Run Script's output.
// `next` is matched by the Conditional after this script: "confirm" shows the Confirm
// Rebuild UI with the workspace as its argument, "error" shows the Error UI with the
// message as its argument and `error_title` as its heading, and "" ends the run.
const output = ({ next = '', arg = '', title = '' }) => JSON.stringify({
  alfredworkflow: { arg, variables: { next, error_title: title, confirmed: '' } },
})

// The Error UI's heading for a failed action.
const failureTitle = (action, target) => {
  if (!target && action !== 'setup') return 'Rex Workspaces couldn’t finish'
  switch (action) {
    case 'setup': return 'Couldn’t set up Rex Workspaces'
    case 'edit': return `Couldn’t open ${target.split('/').pop()}`
    case 'rebuild': return `Couldn’t rebuild ${target}`
    case 'open': return `Couldn’t open ${target}`
    default: return 'Rex Workspaces couldn’t finish'
  }
}

const perform = (action, target) => {
  if (action === 'setup') {
    const file = setup()
    // The example workspaces are a starting point, so open them for editing.
    if (interactive) reveal(file)
    return null
  }

  if (!target) throw new Error('No workspace given')

  switch (action) {
    case 'edit': return reveal(target)
    case 'rebuild': return open(target, { rebuild: true })
    case 'open': return open(target, { rebuild: false })
    default: throw new Error(`Unknown action ${action}`)
  }
}

// Failures are output rather than thrown, since Alfred discards a script's errors
// and stops the run, so the Error UI could never show them.
function run(argv) {
  const action = env('action') || 'open'
  const target = argv[0] || ''
  try {
    return output(perform(action, target) || {})
  } catch (error) {
    return output({ next: 'error', arg: error.message, title: failureTitle(action, target) })
  }
}
