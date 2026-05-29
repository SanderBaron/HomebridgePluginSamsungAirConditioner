const API = require('./air-conditioner-api');
const State = require('./state');
const OpMode = require('./op-mode');
const Direction = require('./direction');
const WindLevel = require('./wind-level');
const mapper = require('./mapper');

const FASTCOOL_MAX_PERIODS = 4;              // 4 x ~30 min ≈ 2 hours of sustained turbo
const FASTCOOL_FALLBACK_MS = 32 * 60 * 1000; // safety net if the AC's auto-revert push is missed

var Service, Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    mapper.setCharacteristic(Characteristic);

    homebridge.registerAccessory("homebridge-samsung-ac-port2878", "Samsung Air Conditioner", AirConditioner);
};

function AirConditioner(log, config) {
    this.log = log;
    this.name = config["name"];
    this.duid = config["mac"].replace(/:/g, '').replace(/\-/g, '');
    this.api = new API(
        config["ip_address"],
        config["skip_certificate"] === true,
        this.duid,
        config["token"],
        log,
        config["log_socket_activity"] === true,
        config["keep_alive"]
    );

    this.currentDeviceState = {};

    // Set initial state. Done only to not deal with nulls if getters are called before first connection.
    this.currentDeviceState[State.Active] = 'Off';
    this.currentDeviceState[State.TempNow] = 20;
    this.currentDeviceState[State.TempSet] = 16;
    this.currentDeviceState[State.OpMode] = OpMode.Cool;
    this.currentDeviceState[State.Direction] = Direction.Fixed;
    this.currentDeviceState[State.WindLevel] = WindLevel.Auto;
    this.currentDeviceState[State.Antivirus] = 'Off';
    this.currentDeviceState[State.Comfort] = 'Off';

    // FastCool drives the AC's native TurboMode (AC_FUN_COMODE=TurboMode), which the unit
    // auto-cancels after ~30 min. To sustain ~2 hours we re-issue it for FASTCOOL_MAX_PERIODS
    // turbo periods, then return to normal cooling at the remembered temp with Auto fan.
    this.fastCoolActive = false;
    this.fastCoolPeriods = 0;     // turbo periods started so far in the current routine
    this.fastCoolPrevTemp = null; // TempSet captured when FastCool was switched on
    this.fastCoolTimer = null;    // safety timer in case the auto-revert push is missed
};

AirConditioner.prototype = {
    getServices: function () {
        this.api.connect();

        this.api
            .on('stateUpdate', this.updateState.bind(this));

        this.acService = new Service.HeaterCooler(this.name);

        // ACTIVE STATE
        this.acService
            .getCharacteristic(Characteristic.Active)
            .onGet(this.getActive.bind(this))
            .onSet(this.setActive.bind(this));

        // CURRENT TEMPERATURE
        this.acService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 1
            })
            .onGet(this.getCurrentTemperature.bind(this));

        // TARGET TEMPERATURE
        this.acService
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1
            })
            .onGet(this.getTargetTemperature.bind(this))
            .onSet(this.setTargetTemperature.bind(this));

        this.acService
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1
            })
            .onGet(this.getTargetTemperature.bind(this))
            .onSet(this.setTargetTemperature.bind(this));

        // TARGET STATE
        this.acService
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .onGet(this.getTargetState.bind(this))
            .onSet(this.setTargetState.bind(this));

        // CURRENT STATE
        this.acService
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(this.getCurrentState.bind(this));

        // ROTATION SPEED
        this.acService
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 20,
                maxValue: 100,
                minStep: 20
            })
            .onGet(this.getRotationSpeed.bind(this))
            .onSet(this.setRotationSpeed.bind(this));

        // HORIZONTAL SWING
        this.horizontalSwingService = this.makeSwitchService('Horizontaal', 'horizontal-swing');
        this.horizontalSwingService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getHorizontalSwing.bind(this))
            .onSet(this.setHorizontalSwing.bind(this));

        // VERTICAL SWING
        this.verticalSwingService = this.makeSwitchService('Verticaal', 'vertical-swing');
        this.verticalSwingService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getVerticalSwing.bind(this))
            .onSet(this.setVerticalSwing.bind(this));

        // COMFORT MODE
        this.comfortService = this.makeSwitchService('Comfort Mode', 'comfort');
        this.comfortService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getComfortMode.bind(this))
            .onSet(this.setComfortMode.bind(this));

        // ANTIVIRUS (UV) MODE
        this.antivirusService = this.makeSwitchService('VirusDoc', 'antivirus');
        this.antivirusService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getAntivirusMode.bind(this))
            .onSet(this.setAntivirusMode.bind(this));

        // FASTCOOL (virtual: min temp + Turbo fan)
        this.fastCoolService = this.makeSwitchService('FastCool', 'fastcool');
        this.fastCoolService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getFastCool.bind(this))
            .onSet(this.setFastCool.bind(this));

        const pkg = require('../package.json');
        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.SerialNumber, this.duid)
            .setCharacteristic(Characteristic.Manufacturer, pkg.author)
            .setCharacteristic(Characteristic.Model, pkg.name)
            .setCharacteristic(Characteristic.FirmwareRevision, pkg.version);

        return [
            this.acService,
            this.horizontalSwingService,
            this.verticalSwingService,
            this.comfortService,
            this.antivirusService,
            this.fastCoolService,
            informationService
        ];
    },

    // Service.Switch on the same accessory normally inherits the accessory name in the Home app.
    // Adding ConfiguredName as an optional characteristic restores the per-switch label.
    makeSwitchService: function (label, subtype) {
        const service = new Service.Switch(label, subtype);
        service.setCharacteristic(Characteristic.Name, label);
        if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
            service.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
        service.setCharacteristic(Characteristic.ConfiguredName, label);
        return service;
    },

    // GETTERS
    getActive: async function () {
        const power = this.currentDeviceState[State.Power];
        return power === 'On';
    },

    getCurrentTemperature: async function () {
        return this.currentDeviceState[State.TempNow];
    },

    getTargetTemperature: async function () {
        return this.currentDeviceState[State.TempSet];
    },

    getTargetState: async function () {
        const opMode = this.currentDeviceState[State.OpMode];
        return mapper.targetStateFromOpMode(opMode);
    },

    getCurrentState: async function () {
        return this.currentHeaterCoolerState();
    },

    getVerticalSwing: async function () {
        const direction = this.currentDeviceState[State.Direction];
        return direction === Direction.SwingUpDown || direction === Direction.All;
    },

    getHorizontalSwing: async function () {
        const direction = this.currentDeviceState[State.Direction];
        return direction === Direction.SwingLeftRight || direction === Direction.All;
    },

    getRotationSpeed: async function () {
        const windLevel = this.currentDeviceState[State.WindLevel];
        return mapper.rotationSpeedFromWindLevel(windLevel);
    },

    getAntivirusMode: async function () {
        return this.currentDeviceState[State.Antivirus] === 'On';
    },

    getComfortMode: async function () {
        return this.currentDeviceState[State.Comfort] === 'SoftCool';
    },

    getFastCool: async function () {
        return this.fastCoolActive;
    },

    // SETTERS

    // Promise wrapper around a single deviceControl call (one attribute = one beep).
    control: function (key, value) {
        return new Promise((resolve, reject) => {
            this.api.deviceControl(key, value, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    },

    // Send commands one after another. The AC rejects multi-attribute requests
    // (ErrorCode 210) and beeps per command, so sequential is the only reliable path.
    sendMany: async function (commands) {
        for (const c of commands) {
            try {
                await this.control(c.key, c.value);
            } catch (e) {
                this.log('Command failed:', c.key, '=', c.value, '-', e.message);
            }
        }
    },

    setActive: function (isActive) {
        this.log('Setting active:', isActive);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Power, isActive ? 'On' : 'Off', (err) => {
                if (err) return reject(err);
                this.log('Active set');
                // Mimic the dumb remote's clean slate when switching off via the app/HomeKit:
                // clear any lingering modes so the next power-on starts fresh. (Switching off
                // with the IR remote already resets on its own, so this is scoped to app-offs.)
                if (!isActive) {
                    this.resetModesOnPowerOff();
                }
                resolve();
            });
        });
    },

    setTargetTemperature: function (temperature) {
        this.log('Setting target temperature:', temperature);
        this.cancelFastCoolIfActive('manual temperature change');
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.TempSet, temperature, (err) => {
                if (err) return reject(err);
                this.log('Target temperature set');
                resolve();
            });
        });
    },

    setTargetState: function (state) {
        this.log('Setting target state:', state);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.OpMode, mapper.opModeFromTargetState(state), (err) => {
                if (err) return reject(err);
                this.log('Target state set');
                resolve();
            });
        });
    },

    setVerticalSwing: function (enabled) {
        const horizontal = this.getHorizontalSwingBool();
        const target = this.directionValueFor(enabled, horizontal);
        this.log('Setting vertical swing:', enabled, '->', target);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Direction, target, (err) => {
                if (err) return reject(err);
                this.log('Vertical swing set');
                resolve();
            });
        });
    },

    setHorizontalSwing: function (enabled) {
        const vertical = this.getVerticalSwingBool();
        const target = this.directionValueFor(vertical, enabled);
        this.log('Setting horizontal swing:', enabled, '->', target);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Direction, target, (err) => {
                if (err) return reject(err);
                this.log('Horizontal swing set');
                resolve();
            });
        });
    },

    getVerticalSwingBool: function () {
        const d = this.currentDeviceState[State.Direction];
        return d === Direction.SwingUpDown || d === Direction.All;
    },

    getHorizontalSwingBool: function () {
        const d = this.currentDeviceState[State.Direction];
        return d === Direction.SwingLeftRight || d === Direction.All;
    },

    directionValueFor: function (vertical, horizontal) {
        if (vertical && horizontal) return Direction.All;
        if (vertical) return Direction.SwingUpDown;
        if (horizontal) return Direction.SwingLeftRight;
        return Direction.Fixed;
    },

    setRotationSpeed: function (speed) {
        this.log('Setting rotation speed:', speed);
        this.cancelFastCoolIfActive('manual fan change');
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.WindLevel, mapper.windLevelFromRotationSpeed(speed), (err) => {
                if (err) return reject(err);
                this.log('Rotation speed set');
                resolve();
            });
        });
    },

    setAntivirusMode: function (enabled) {
        this.log('Setting antivirus mode:', enabled);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Antivirus, enabled ? 'On' : 'Off', (err) => {
                if (err) return reject(err);
                this.log('Antivirus mode set');
                resolve();
            });
        });
    },

    setComfortMode: function (enabled) {
        this.log('Setting comfort mode:', enabled);
        // Comfort (SoftCool) and FastCool (TurboMode) share AC_FUN_COMODE, so they are mutually
        // exclusive. Turning Comfort on stops a running FastCool routine; the SoftCool command
        // below overrides TurboMode, so no separate Off is needed.
        if (enabled && this.fastCoolActive) {
            this.log('FastCool cancelled by Comfort mode');
            this._stopFastCoolRoutine();
        }
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Comfort, enabled ? 'SoftCool' : 'Off', (err) => {
                if (err) return reject(err);
                this.log('Comfort mode set');
                resolve();
            });
        });
    },

    setFastCool: async function (enabled) {
        this.log('Setting FastCool:', enabled);
        if (enabled) {
            // Remember the current target temp to restore when the routine ends.
            this.fastCoolPrevTemp = this.currentDeviceState[State.TempSet];
            this.fastCoolActive = true;
            this.fastCoolPeriods = 0;
            // Turn the unit on first if it was off — TurboMode needs a running AC to act on.
            if (this.currentDeviceState[State.Power] !== 'On') {
                await this.control(State.Power, 'On');
            }
            await this._startTurboPeriod();
        } else {
            if (!this.fastCoolActive) return;
            await this._endFastCool(true); // manual stop: turbo may still be running
        }
    },

    // Issue one TurboMode period and arm a safety timer. The AC normally auto-reverts to
    // COMODE=Off after ~30 min; we observe that push in updateCharacteristic and chain the
    // next period. The timer only fires if that push is somehow missed.
    _startTurboPeriod: async function () {
        this.fastCoolPeriods += 1;
        this.log('FastCool: starting turbo period', this.fastCoolPeriods, 'of', FASTCOOL_MAX_PERIODS);
        this._clearFastCoolTimer();
        this.fastCoolTimer = setTimeout(this._onTurboPeriodEnded.bind(this), FASTCOOL_FALLBACK_MS);
        await this.control(State.Comfort, 'TurboMode');
    },

    // A turbo period ended (AC auto-reverted, or the safety timer fired): chain the next one,
    // or finish the routine once all periods are done.
    _onTurboPeriodEnded: function () {
        if (!this.fastCoolActive) return;
        this._clearFastCoolTimer();
        if (this.fastCoolPeriods < FASTCOOL_MAX_PERIODS) {
            this._startTurboPeriod();
        } else {
            this.log('FastCool: completed', FASTCOOL_MAX_PERIODS, 'periods, returning to normal');
            this._endFastCool(false); // COMODE is already Off after the final auto-revert
        }
    },

    // Finish the routine and restore normal cooling. sendTurboOff=true when ending early
    // (turbo may still be running); false after the final auto-revert (COMODE already Off,
    // so we skip that command and its beep).
    _endFastCool: async function (sendTurboOff) {
        const restoreTemp = (this.fastCoolPrevTemp != null)
            ? this.fastCoolPrevTemp
            : this.currentDeviceState[State.TempSet];
        this._stopFastCoolRoutine();
        const commands = [];
        if (sendTurboOff) commands.push({ key: State.Comfort, value: 'Off' });
        commands.push({ key: State.WindLevel, value: WindLevel.Auto });
        commands.push({ key: State.TempSet, value: restoreTemp });
        await this.sendMany(commands);
        this.log('FastCool ended; fan Auto, temp', restoreTemp);
    },

    // Tear down routine state and reflect the switch as off. Sends no AC command.
    _stopFastCoolRoutine: function () {
        this._clearFastCoolTimer();
        this.fastCoolActive = false;
        this.fastCoolPeriods = 0;
        this.fastCoolService.getCharacteristic(Characteristic.On).updateValue(false);
    },

    _clearFastCoolTimer: function () {
        if (this.fastCoolTimer) {
            clearTimeout(this.fastCoolTimer);
            this.fastCoolTimer = null;
        }
    },

    // A manual temp/fan change means the user has taken over: stop the routine and the turbo,
    // without overriding whatever the user is now setting.
    cancelFastCoolIfActive: function (reason) {
        if (!this.fastCoolActive) return;
        this.log('FastCool cancelled by', reason);
        const turboRunning = this.currentDeviceState[State.Comfort] === 'TurboMode';
        this._stopFastCoolRoutine();
        if (turboRunning) {
            this.control(State.Comfort, 'Off').catch((e) => this.log('Turbo off failed:', e.message));
        }
    },

    currentHeaterCoolerState: function() {
        const currentTemperature = this.currentDeviceState[State.TempNow];
        const targetTemperature = this.currentDeviceState[State.TempSet];
        const opMode = this.currentDeviceState[State.OpMode];

        var state;

        if (opMode === OpMode.Cool) {
            if(currentTemperature > targetTemperature) {
                state = Characteristic.CurrentHeaterCoolerState.COOLING;
            } else {
                state = Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        } else if (opMode === OpMode.Heat) {
            if(currentTemperature < targetTemperature) {
                state = Characteristic.CurrentHeaterCoolerState.HEATING;
            } else {
                state = Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        } else if (opMode === OpMode.Auto) {
            if(currentTemperature > targetTemperature) {
                state = Characteristic.CurrentHeaterCoolerState.COOLING;
            } else if(currentTemperature < targetTemperature) {
                state = Characteristic.CurrentHeaterCoolerState.HEATING;
            } else {
                state = Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        } else { // Dry, Wind
            state = Characteristic.CurrentHeaterCoolerState.IDLE;
        }

        return state;
    },

    updateState: function (stateUpdate) {
        this.log("State updated:", JSON.stringify(stateUpdate, Object.values(State)));

        // Merge state update into current device state
        this.currentDeviceState = Object.assign({}, this.currentDeviceState, stateUpdate);

        // Update characteristics which correspond to updated states
        Object.keys(stateUpdate).forEach(function(key) {
            this.updateCharacteristic(key, stateUpdate[key]);
        }.bind(this));

        this.updateDerivedCharacteristics();
    },

    // Reset only the modes that are actually active. Each command beeps once, so a clean AC
    // stays silent and a single active mode costs a single beep (the AC rejects batched
    // multi-attribute commands, so there is no zero-beep path).
    resetModesOnPowerOff: function () {
        // Abort a running FastCool routine; the COMODE reset below stops the turbo itself.
        if (this.fastCoolActive) {
            this._stopFastCoolRoutine();
        }

        const commands = [];

        // COMODE carries both Comfort (SoftCool) and FastCool (TurboMode) — reset either.
        const comode = this.currentDeviceState[State.Comfort];
        if (comode === 'SoftCool' || comode === 'TurboMode') {
            commands.push({ key: State.Comfort, value: 'Off' });
        }
        if (this.currentDeviceState[State.Antivirus] === 'On') {
            commands.push({ key: State.Antivirus, value: 'Off' });
        }
        if (this.currentDeviceState[State.Direction] !== Direction.Fixed) {
            commands.push({ key: State.Direction, value: Direction.Fixed });
        }

        if (commands.length === 0) {
            this.log('Power off: no active modes to reset');
            return;
        }

        this.log('Power off: resetting', commands.length, 'active mode command(s)');
        this.sendMany(commands);
    },

    updateCharacteristic: function(name, value) {
        switch(name) {
        case State.Power:
            this.acService.getCharacteristic(Characteristic.Active).updateValue(value === "On");
            break;
        case State.TempNow:
            this.acService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(value);
            break;
        case State.OpMode:
            this.acService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(mapper.targetStateFromOpMode(value));
            break;
        case State.Direction:
            this.verticalSwingService.getCharacteristic(Characteristic.On)
                .updateValue(value === Direction.SwingUpDown || value === Direction.All);
            this.horizontalSwingService.getCharacteristic(Characteristic.On)
                .updateValue(value === Direction.SwingLeftRight || value === Direction.All);
            break;
        case State.WindLevel:
            this.acService.getCharacteristic(Characteristic.RotationSpeed).updateValue(mapper.rotationSpeedFromWindLevel(value));
            break;
        case State.Antivirus:
            this.antivirusService.getCharacteristic(Characteristic.On).updateValue(value === 'On');
            break;
        case State.Comfort:
            // COMODE is shared: SoftCool drives the Comfort switch; TurboMode is FastCool's turbo.
            this.comfortService.getCharacteristic(Characteristic.On).updateValue(value === 'SoftCool');
            // The FastCool switch reflects the routine flag (not raw COMODE) to avoid flicker
            // between periods. A revert to Off during the routine chains the next turbo period.
            if (value === 'Off' && this.fastCoolActive) {
                this._onTurboPeriodEnded();
            }
            break;
        }
    },

    updateDerivedCharacteristics: function() {
        const targetTemperature = this.currentDeviceState[State.TempSet];

        this.acService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(this.currentHeaterCoolerState());
        this.acService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemperature);
        this.acService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(targetTemperature);
    },
};
