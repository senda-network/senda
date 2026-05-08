; desktop/installer/hooks.nsh
;
; NSIS installer/uninstaller hooks for the ClosedMesh desktop bundle.
; Tauri's NSIS template injects these macros at the corresponding
; phases of the installer flow (see Tauri docs: bundle.windows.nsis.installerHooks).
;
; The Tauri template runs the hook AFTER `SetOutPath $INSTDIR` and
; BEFORE the built-in `CheckIfAppIsRunning` macro. CheckIfAppIsRunning
; only kills the main exe (`ClosedMesh.exe`) — it knows nothing about
; the bundled Node sidecar — so on every upgrade with a running
; instance NSIS would proceed to copy the sidecar over a still-locked
; binary and pop:
;
;     Error opening file for writing:
;     C:\Users\…\AppData\Local\ClosedMesh\<sidecar>
;     Click Abort to stop the installation, Retry to try again, or
;     Ignore to skip this file.
;
; Five previous fix attempts failed:
;
;   - 0.1.63 / 0.1.64: `taskkill /F /T /IM ClosedMesh.exe`. /T walks
;     descendants of an *alive* parent only, so an orphaned sidecar
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
;   - 0.1.67/0.1.68: switched to `nsis_tauri_utils::KillProcessCurrentUser
;     "node.exe"`. Worked, but indiscriminately killed every node.exe
;     under the current user — including a Node dev server, VS Code's
;     extension host, the Electron renderer of any other installed
;     app. Unacceptable side effect for an installer popup fix.
;
; Fix in 0.1.69 (this file): the sidecar is now bundled as
; `closedmesh-node.exe` (see desktop/scripts/fetch-node.sh and
; desktop/tauri.conf.json::externalBin). That image name is unique to
; us, so a kill-by-image-name is automatically path-filtered: it can
; only match a process started from our own install directory. The
; user's other node.exe processes are completely untouched.
;
; Two-step kill, in this order:
;   1. ClosedMesh.exe — the desktop window. Includes a /T pass for
;      child processes that are still parented to a live ClosedMesh.
;   2. closedmesh-node.exe — the bundled sidecar. /T won't catch it
;      when ClosedMesh has already exited but the sidecar limped on
;      (the actual cause of the file lock pre-0.1.69), so we kill by
;      image name explicitly. Safe now that the name is unique to us.
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

  ; The bundled Node sidecar. Unique image name (closedmesh-node.exe)
  ; means we can kill all matches without disturbing the user's
  ; other node.exe processes. This is the actual fix for the
  ; "Error opening file for writing" popup that 0.1.63-0.1.68 chased.
  nsis_tauri_utils::KillProcessCurrentUser "closedmesh-node.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: KillProcess closedmesh-node.exe -> $0"

  ; Defence in depth in case the plugin missed the sidecar (e.g. it
  ; was started by a different session id and KillProcessCurrentUser's
  ; "current user" filter excluded it). taskkill by image name is
  ; safe for the same reason — the name is ours alone.
  nsExec::Exec 'taskkill /F /IM closedmesh-node.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill closedmesh-node.exe -> $0"

  ; The Rust runtime + its llama.cpp helpers. NEW in 0.1.76. The
  ; Tauri `CheckIfAppIsRunning` macro only knows about the main exe
  ; (ClosedMesh.exe) — it has no concept of the closedmesh.exe / 
  ; rpc-server.exe / llama-server.exe trio that the Scheduled Task
  ; spawns separately and that survives ClosedMesh.exe exiting.
  ; Pre-0.1.76 the runtime kept running through every reinstall:
  ;
  ;   - locked `~/.local/bin\closedmesh.exe` so 0.1.75's migration
  ;     to %LOCALAPPDATA%\closedmesh\bin couldn't move it,
  ;   - kept emitting "rpc-server.exe not found" from the legacy
  ;     path in the Activity panel, making it look like every fix
  ;     we shipped had done nothing,
  ;   - held GPU memory and TCP ports the new install would race.
  ;
  ; First stop the Scheduled Task gracefully, then taskkill the
  ; image names. /T isn't needed (these don't have managed children)
  ; but doesn't hurt. Image names are unique to us, so this can
  ; never hit unrelated user processes.
  nsExec::Exec 'schtasks /End /TN ClosedMesh'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: schtasks /End ClosedMesh -> $0"

  Sleep 600

  nsExec::Exec 'taskkill /F /T /IM llama-server.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill llama-server.exe -> $0"

  nsExec::Exec 'taskkill /F /T /IM rpc-server.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill rpc-server.exe -> $0"

  nsExec::Exec 'taskkill /F /T /IM closedmesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preinstall: taskkill closedmesh.exe -> $0"

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

  nsis_tauri_utils::KillProcessCurrentUser "closedmesh-node.exe"
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: KillProcess closedmesh-node.exe -> $0"

  nsExec::Exec 'taskkill /F /IM closedmesh-node.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill closedmesh-node.exe -> $0"

  ; Same runtime-trio kill as preinstall (see comment there for
  ; why ClosedMesh.exe alone isn't enough).
  nsExec::Exec 'schtasks /End /TN ClosedMesh'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: schtasks /End ClosedMesh -> $0"

  Sleep 600

  nsExec::Exec 'taskkill /F /T /IM llama-server.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill llama-server.exe -> $0"

  nsExec::Exec 'taskkill /F /T /IM rpc-server.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill rpc-server.exe -> $0"

  nsExec::Exec 'taskkill /F /T /IM closedmesh.exe'
  Pop $0
  DetailPrint "[ClosedMesh] preuninstall: taskkill closedmesh.exe -> $0"

  Sleep 1500
  DetailPrint "[ClosedMesh] preuninstall: ready to uninstall"
!macroend
