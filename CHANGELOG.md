# Changelog

## 4.4.0 - 2026-06-01
### Changed
- Removed `net-keepalive` (and its transitive `ffi-napi` / `ref-napi` native dependencies). Low-level TCP keepalive tuning (`TCP_KEEPINTVL` / `TCP_KEEPCNT`) is replaced by an application-layer dead-socket detector: the plugin tracks the timestamp of the most recent line received from the AC, and if no data has come in for `dead_socket_timeout` ms (default 60 min) it destroys the socket so the existing reconnect flow takes over. The detector is fully passive — no commands are sent to the AC for the purpose of probing, so it cannot trigger AC beeps. Default chosen as a safety net only; Node's `socket.setKeepAlive(true, initial_delay)` plus the OS-level TCP keepalive (~10 min on macOS) handles the common dead-socket cases first.
- Plugin is now pure-JavaScript: no native modules to compile, install is faster and works out of the box on every supported Node.js version.
### Added
- `keep_alive.dead_socket_timeout` config option (milliseconds, default 3600000 = 60 min). Set to 0 to disable the application-layer detector entirely and rely solely on TCP keepalive.
### Deprecated
- `keep_alive.interval` and `keep_alive.probes` config options no longer have any effect (a one-time notice is logged at startup if either is set). They can be safely removed from `config.json`.

## 4.3.0 - 2026-05-29
### Added
- FastCool switch (`AC_FUN_COMODE=TurboMode`) — runs the AC's native turbo mode. Since the unit auto-cancels TurboMode after ~30 min, the routine re-issues it for 4 periods (~2 hours of sustained turbo), then returns to normal cooling at the remembered target temp with Auto fan. Re-issue is event-driven on the AC's auto-revert push, with a 32-min safety timer as fallback. Switching FastCool on powers the AC on first if it was off. A manual temp/fan change cancels the routine.
- Clean-slate auto-reset on power off — when the AC is switched off via Home or a HomeKit automation, lingering modes are reset to mimic the dumb remote's behaviour: Comfort/FastCool (`COMODE`), VirusDoc (`SPI`) and swing (`Direction`) are set off. Only modes actually active are sent (each command beeps once on the unit). Scoped to app/HomeKit power-offs; the IR remote already resets itself.
### Notes
- FastCool and Comfort share `AC_FUN_COMODE` and are therefore mutually exclusive; turning Comfort on cancels a running FastCool routine.
- The AC rejects batched multi-attribute commands with `ErrorCode 210`, so reset commands are sent sequentially — there is no zero-beep path.

## 4.1.0 - 2026-05-27
### Added
- Horizontal swing switch (`AC_FUN_DIRECTION=SwingLR`) and Vertical swing switch (`AC_FUN_DIRECTION=SwingUD`), replacing the single `SwingMode` characteristic. Both can be combined; the setter writes `Direction.All` when both are on (emitted only on AC models that support it — on models without `All`, the switches behave mutually exclusive).
- `ConfiguredName` characteristic on every extra Switch service (Comfort, VirusDoc, Horizontaal, Verticaal) — workaround for the HomeKit bug where additional services on one accessory all inherit the accessory name in the Home app.
### Changed
- Reordered service tiles so Horizontaal/Verticaal sit on row 1 and Comfort/VirusDoc on row 2 in the Home-app grid.
- `.npmignore` excludes `.claude/`, `NOTES.md`, `*.tgz` from the published package.

## 4.0.0 - 2026-05-16
### Added
- VirusDoc (UV sterilisation) switch per AC unit — via `AC_ADD_SPI` attribute
- Comfort (SoftCool) switch per AC unit — via `AC_FUN_COMODE` attribute
### Changed
- Migrated to Homebridge v2 API: replaced deprecated `characteristic.on('get'/'set', callback)` with `onGet`/`onSet` and Promise-based setters
- Compatible with Homebridge v1.8+ and v2.x
- Updated minimum Node.js requirement to v18.15.0

## 3.1.0
### Added
- keep_alive configuration option

## 3.0.0 - 18.11.2018
### Added
- Support for controlling oscillation
### Improved
- Improve response time by introducing local cache for AC state
- Improve error handling
- Improve reconnecting after power loss, networking issues etc.
- Improve project structure

## 1.0.3 - 25.10.2018
### Fixed
- Fix for not reconnecting after socket closes

## 1.0.2 - 14.10.2018
### Fixed
- Fix for connection error caused by too weak DH key

## 1.0.1 - 09.10.2018
### Fixed
- Fix wrong command name in documentation
- Fix crash during reconnection

## 1.0.0 - 08.10.2018
Initial release
