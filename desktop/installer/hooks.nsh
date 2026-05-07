; desktop/installer/hooks.nsh
;
; NSIS installer/uninstaller hooks for the ClosedMesh desktop bundle.
; Tauri's NSIS template injects these macros at the corresponding
; phases of the installer flow (see Tauri docs: bundle.windows.nsis.installerHooks).
;
; The Tauri template runs the hook AFTER `SetOutPath $INSTDIR` and
; BEFORE the built-in `CheckIfAppIsRunning` macro. CheckIfAppIsRunning
; only kills the main exe (`ClosedMesh.exe`) — it knows nothing about
; the bundled `node.exe` sidecar — so on every upgrade with a running
; instance, NSIS would proceed to copy `node.exe` over a still-locked
; binary and pop:
;
;     Error opening file for writing:
;     C:\Users\…\AppData\Local\ClosedMesh\node.exe
;     Click Abort to stop the installation, Retry to try again, or
;     Ignore to skip this file.
;
; Three previous fix attempts failed:
;
;   - 0.1.63 / 0.1.64: `taskkill /F /T /IM ClosedMesh.exe`. /T walks
;     descendants of an *alive* parent only, so an orphaned node.exe
;     (left behind by a previous crash, or by Tauri's prevent_close
;     handler keeping the parent alive while a hidden window is around)
;     wasn't caught.
;
;   - 0.1.65: added a PowerShell sweep
;       Get-Process -Name node | Where { $_.Path -like '*\ClosedMesh\node.exe' } | Stop-Process
;     NSIS quietly substituted away the `$_` (it treats `$VAR` as a
;     variable reference), so the Where-Object filter ran against
;     `$null.Path` and matched zero items. The popup persisted.
;
;   - 0.1.66: tried `$$_` (the documented NSIS literal-`$` escape).
;     Still didn't reach PowerShell intact on the user's machine —
;     symptom unchanged.
;
; Fix in 0.1.67: stop fighting NSIS string escaping and use the
; `nsis_tauri_utils` plugin that Tauri's own template uses for
; `CheckIfAppIsRunning`. The plugin is already bundled by Tauri so no
; install step is needed; calling its `KillProcessCurrentUser` by
; image name is one line and has no escaping pitfalls.
;
; Trade-off: `KillProcessCurrentUser "node.exe"` kills *all* node.exe
; processes the current user is running — including a Node dev
; server, a VS Code extension host, the Electron renderer of any
; other installed app. Acceptable for an installer flow: the user
; has explicitly accepted the install, the disruption is momentary,
; and other apps recover cleanly. The alternative — keep showing a
; modal mid-install — is worse.
;
; Sleep 1500 ms after the kills to give Windows time to release file
; handles before NSIS opens the destination files for writing. The
; OS' kernel-side handle cleanup is async even after the process
; itself is gone. 800 ms wasn't reliably enough on an NVMe Win11
; machine in testing; 1500 ms keeps a margin without making the
; install perceptibly slower.
;
; DetailPrint lines below show up in the installer's "Show details"
; pane so the next failure mode (if any) is visible to the user
; instead of silent.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "[ClosedMesh] preinstall: terminating any running app instance..."

  nsis_tauri_utils::KillProcessCurrentUser "ClosedMesh.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: KillProcess ClosedMesh.exe -> $0"

  ; Belt-and-braces taskkill for orphaned children that the plugin
  ; might miss (e.g. process group leadership reassigned post-fork).
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill ClosedMesh.exe /T -> $0"

  nsis_tauri_utils::KillProcessCurrentUser "node.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: KillProcess node.exe -> $0"

  Sleep 1500
  DetailPrint "[ClosedMesh] preinstall: ready to install"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "[ClosedMesh] preuninstall: terminating any running app instance..."

  nsis_tauri_utils::KillProcessCurrentUser "ClosedMesh.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: KillProcess ClosedMesh.exe -> $0"

  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill ClosedMesh.exe /T -> $0"

  nsis_tauri_utils::KillProcessCurrentUser "node.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: KillProcess node.exe -> $0"

  Sleep 1500
  DetailPrint "[ClosedMesh] preuninstall: ready to uninstall"
!macroend
