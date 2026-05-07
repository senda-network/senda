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
; That dialog made the upgrade flow look broken to a friend testing
; the .exe. The fix is to terminate the running process tree before
; touching any files.
;
; `taskkill /F` = force-terminate, `/T` = also terminate descendants
; (so the bundled `node.exe` dies cleanly with its parent), `/IM` =
; match by image name. Output is captured by nsExec and discarded.
; The exit code is popped and ignored: on a fresh install (no prior
; ClosedMesh process) taskkill returns 128 ("process not found"),
; which is the expected case and definitely not a reason to abort.
;
; Sleep 600 ms after the kill to give the OS time to drop file locks
; before NSIS opens the destination files for writing. 500 ms was
; consistently enough on a fast NVMe; 600 ms keeps a small margin
; for slower disks without making the install perceptibly slower.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running ClosedMesh instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  Sleep 600
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping any running ClosedMesh instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  Sleep 600
!macroend
