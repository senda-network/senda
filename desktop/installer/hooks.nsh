; desktop/installer/hooks.nsh
;
; NSIS installer/uninstaller hooks for the ClosedMesh desktop bundle.
; Tauri's NSIS template injects these macros at the corresponding
; phases of the installer flow (see Tauri docs: bundle.windows.nsis.installerHooks).
;
; Why this exists: the .exe NSIS installer overwrites every file in
; the install directory. If `ClosedMesh.exe` is still running when a
; user upgrades, the bundled `node.exe` sidecar holds an exclusive
; file lock on itself — and the installer pops a modal:
;
;     Error opening file for writing:
;     C:\Users\…\AppData\Local\ClosedMesh\node.exe
;     Click Abort to stop the installation, Retry to try again, or
;     Ignore to skip this file.
;
; Two-step kill, in this order:
;
;   1. `taskkill /F /T /IM ClosedMesh.exe` — force-kill the desktop
;      window and its child tree. `/T` walks descendants of the
;      currently alive parent only, so when ClosedMesh.exe has
;      already exited (Tauri's prevent_close keeps it alive while
;      a hidden window is around, but a previous upgrade or crash
;      can leave node.exe orphaned and reparented to System) `/T`
;      misses the sidecar — handled by step 2.
;
;   2. PowerShell sweep that finds any `node.exe` whose full path
;      ends with `\ClosedMesh\node.exe` and force-kills it. Path
;      filter (not just image name) protects unrelated `node.exe`
;      processes the user might be running — Node dev server, VS
;      Code extension host, the Electron renderer of any other
;      installed app.
;
; CRITICAL ESCAPING NOTE — `$$_` and `$\"`:
;
;   NSIS treats `$VAR_NAME` as a variable reference inside string
;   literals. PowerShell's pipeline-variable `$_` would be silently
;   eaten by NSIS (resulting in `.Path -like '...'` which PowerShell
;   parses as accessing a Path property on `$null` → Where-Object
;   matches zero items → no kill, no error, file lock survives,
;   "Error opening file for writing" dialog).
;
;   `$$` is the NSIS literal-`$` escape, so `$$_` arrives at
;   PowerShell as `$_`. This is the SOLE reason the v0.1.65 hook
;   appeared to do nothing on the user's machine. Same goes for
;   `$\"` for embedded double quotes.
;
;   Verified by inserting `DetailPrint` lines below — install log
;   now prints the exit code from each step.
;
; Sleep 1500 ms after the kills to give the OS time to drop file
; handles before NSIS opens the destination files for writing.
; 800 ms wasn't reliably enough on the user's machine (Win11 + NVMe
; reportedly still failed 1-in-3 times); 1500 ms is conservative
; without making the install perceptibly slower.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "[ClosedMesh] preinstall: terminating any running app instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill ClosedMesh.exe -> exit $0"

  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like ''*\ClosedMesh\node.exe'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: orphaned node.exe sweep -> exit $0"

  Sleep 1500
  DetailPrint "[ClosedMesh] preinstall: ready to install"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "[ClosedMesh] preuninstall: terminating any running app instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill ClosedMesh.exe -> exit $0"

  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like ''*\ClosedMesh\node.exe'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: orphaned node.exe sweep -> exit $0"

  Sleep 1500
  DetailPrint "[ClosedMesh] preuninstall: ready to uninstall"
!macroend
