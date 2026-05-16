# Changelog

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
