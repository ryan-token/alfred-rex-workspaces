#!/usr/bin/env -S osascript -l JavaScript

ObjC.import('Foundation')
ObjC.import('AppKit')

// Evaluates lib.js from beside this script. The script's path follows the language
// in osascript's arguments, and is relative to the folder Alfred runs it from.
const load = name => {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)
  const folder = $(args[args.indexOf('JavaScript') + 1]).stringByDeletingLastPathComponent.js || '.'
  return eval($.NSString.stringWithContentsOfFileEncodingError(`${folder}/${name}`, $.NSUTF8StringEncoding, null).js)
}

const { REX_BUNDLE_ID, env, rexPath, execute, failureReason, parseJSON, listWorkspaces } = load('lib.js')

const CONNECT_TIMEOUT = 15

const app = Application.currentApplication()
app.includeStandardAdditions = true

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

const confirmRebuild = name => {
  try {
    app.displayDialog(`Rebuild ${name}? This closes its running session and everything running in it.`, {
      withTitle: 'Rex Workspaces',
      buttons: ['Cancel', 'Rebuild'],
      defaultButton: 'Rebuild',
      cancelButton: 'Cancel',
      withIcon: 'caution',
    })
    return true
  } catch (error) {
    // Cancelling raises "User canceled", error -128.
    if (error.errorNumber === -128) return false
    throw error
  }
}

const reveal = path => {
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) throw new Error(`Nothing to open at ${path}`)

  const workspace = $.NSWorkspace.sharedWorkspace
  const url = $.NSURL.fileURLWithPath(path)
  // Falls back to Finder when nothing on the machine claims .lua files.
  if (!workspace.openURL(url)) workspace.activateFileViewerSelectingURLs($([url]))
}

const open = (name, { rebuild }) => {
  const rex = rexPath()
  if (!rex) throw new Error('Rex is not installed')

  if (rebuild && isRunning(rex, name) && !confirmRebuild(name)) return

  const client = connectApp(rex)
  const args = ['-C', client.client_id, 'do', 'workspace', `name=${name}`]
  if (rebuild) args.push('rebuild=true')

  const result = execute(rex, args)
  if (result.status !== 0) throw new Error(failureReason(result))
  activate(client)
}

const perform = argv => {
  const action = env('action') || 'open'
  const target = argv[0]
  if (!target) throw new Error('No workspace given')

  switch (action) {
    case 'edit': return reveal(target)
    case 'rebuild': return open(target, { rebuild: true })
    case 'open': return open(target, { rebuild: false })
    default: throw new Error(`Unknown action ${action}`)
  }
}

function run(argv) {
  try {
    perform(argv)
  } catch (error) {
    // Alfred discards a script's errors, so say what went wrong when it ran us.
    if (env('alfred_workflow_bundleid')) {
      app.displayAlert('Rex Workspaces', { message: error.message, as: 'critical' })
    }
    throw error
  }
}
