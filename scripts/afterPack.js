const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

/**
 * afterPack hook that adds UTExportedTypeDeclarations to Info.plist
 * and removes document-level icon references.
 *
 * By declaring the .har UTI *without* a UTTypeIconFile, macOS
 * auto-generates the Big Sur+ document icon: white page with folded
 * corner, the Netscope app icon as a centered badge, and the "HAR"
 * extension as a text label. Providing any icon file (UTTypeIconFile,
 * CFBundleTypeIconFile) causes macOS to use that file as-is instead
 * of generating the native treatment.
 *
 * Conforms to public.data only. Adding public.json would cause macOS
 * to show a JSON text preview instead of our document icon.
 */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const plistPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Info.plist')

  if (!fs.existsSync(plistPath)) {
    console.log('afterPack: Info.plist not found, skipping UTI injection')
    return
  }

  const plistBuddy = '/usr/libexec/PlistBuddy'
  const pb = (cmd) => execSync(`${plistBuddy} -c "${cmd}" "${plistPath}"`)

  // -- Remove any document-type icon references that electron-builder
  //    injected via fileAssociations.icon. These override the native
  //    auto-generated icon if present.
  console.log('Removing CFBundleTypeIconFile from document types...')
  try {
    pb('Delete :CFBundleDocumentTypes:0:CFBundleTypeIconFile')
  } catch {
    // Key may not exist — that's fine
  }

  // -- Add UTExportedTypeDeclarations for .har
  //    No UTTypeIconFile — this is what triggers the native page curl.
  console.log('Injecting UTExportedTypeDeclarations into Info.plist...')

  const cmds = [
    'Add :UTExportedTypeDeclarations array',
    'Add :UTExportedTypeDeclarations:0 dict',
    'Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string com.netscope.har',
    'Add :UTExportedTypeDeclarations:0:UTTypeDescription string HAR File',
    'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array',
    'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string public.data',
    'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict',
    'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array',
    'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string har',
  ]

  for (const cmd of cmds) {
    pb(cmd)
  }

  // -- Link CFBundleDocumentTypes to our UTI
  try {
    pb('Add :CFBundleDocumentTypes:0:LSItemContentTypes array')
    pb('Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string com.netscope.har')
  } catch {
    // LSItemContentTypes might already exist
  }

  console.log('UTI declaration injected successfully')
}
