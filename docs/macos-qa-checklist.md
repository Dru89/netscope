# macOS Manual QA Checklist

The Tauri port was developed and verified on Linux; tauri-driver has no
macOS support, so these macOS-specific behaviors need a manual pass on a
real Mac before each stable release (and once after any change to window
management, file handling, menus, or the updater).

Build to test: the signed dmg/app from CI, not a local dev build —
signing, notarization, and file associations only exist on the bundled app.

## Install & launch

- [ ] DMG opens without a Gatekeeper block (notarization worked)
- [ ] First launch shows the welcome window, traffic lights inset at (16,16),
      no white flash before the window appears
- [ ] `codesign --verify --deep --strict /Applications/Netscope.app` passes

## File association & document behaviors

- [ ] Double-clicking a `.har` in Finder opens it (app not running)
- [ ] Double-clicking a `.har` in Finder opens it (app already running)
- [ ] Double-clicking an **already-open** `.har` focuses its window instead
      of opening a copy
- [ ] Dropping a `.har` on the dock icon opens it
- [ ] `open -a Netscope some.har` from a terminal opens it
- [ ] With a focused empty welcome window, an OS open loads into it;
      an **unfocused** welcome window is left alone (new window instead)
- [ ] The title bar shows the proxy icon (represented file); Cmd-clicking
      the title shows the file's path menu
- [ ] `.har` files in Finder show the native page-curl document icon
      (if not: icon cache — see docs/macos-document-icons.md)
- [ ] File > Open Recent lists files, persists across relaunch, and the
      dock icon's right-click menu shows recent documents
- [ ] Opening a deleted file from Open Recent shows the warning dialog and
      prunes the entry

## Windows & menus

- [ ] New windows cascade down-right from the focused window
- [ ] Cmd+N opens exactly **one** window; Cmd+W closes exactly one
- [ ] Closing the last window leaves the app running; clicking the dock
      icon opens a new welcome window
- [ ] Multi-select in the Open dialog: first file loads in place, others
      open in their own windows
- [ ] Right-click on a request row: native context menu; Copy as cURL puts
      a runnable command on the clipboard; Sort By shows the checked field
- [ ] Window menu: Minimize/Zoom/Bring All to Front behave natively
- [ ] Edit menu: copy/paste works in the filter input

## Theme & rendering

- [ ] System/Light/Dark toggle in the summary bar switches instantly,
      persists across relaunch, no flash on launch in dark mode
- [ ] Traffic lights don't overlap the toolbar at any window width
- [ ] With two windows open, switching theme in one switches the other too —
      both the content **and** the native title bar, without needing a reload
- [ ] The other window's toggle also moves its highlight to the new mode
      (it isn't just repainted, its state follows)
- [ ] Switching back to System in one window returns both to following macOS,
      and toggling macOS appearance then moves both
- [ ] A window opened _after_ a theme change starts in that theme, with no
      flash of the previous one
- [ ] Large capture (test/fixtures/github.com.har or bigger): flick-scroll
      hard top to bottom — no blank gaps, no rows drifting out of line with
      the sticky header, and the header stays put during momentum scroll
- [ ] Rubber-band overscroll past the top and bottom of a large capture
      leaves the rows correctly positioned afterwards
- [ ] Holding j / k scrolls smoothly through a large capture; Home and End
      jump to the first and last row with the selection visible

## Updater (needs a newer release to exist)

- [ ] Update prompt appears with Install / Remind Me Later / Skip This Version
- [ ] "Remind Me Later" suppresses the prompt for the rest of the day
- [ ] "Skip This Version" suppresses until a newer version exists
- [ ] Install: dock icon shows progress; Update Ready dialog appears
- [ ] About panel shows "version X is ready — restart to install"
- [ ] Restart Now: app relaunches on the new version with the same files open
