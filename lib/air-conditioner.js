const API = require('./air-conditioner-api');
const State = require('./state');
const OpMode = require('./op-mode');
const Direction = require('./direction');
const WindLevel = require('./wind-level');
const mapper = require('./mapper');

var Service, Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    mapper.setCharacteristic(Characteristic);

    homebridge.registerAccessory("homebridge-plugin-samsung-air-conditioner", "Samsung Air Conditioner", AirConditioner);
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

        // SWING MODE
        this.acService
            .getCharacteristic(Characteristic.SwingMode)
            .onGet(this.getSwingMode.bind(this))
            .onSet(this.setSwingMode.bind(this));

        // ROTATION SPEED
        this.acService
            .getCharacteristic(Characteristic.RotationSpeed)
            .onGet(this.getRotationSpeed.bind(this))
            .onSet(this.setRotationSpeed.bind(this));

        // ANTIVIRUS (UV) MODE
        this.antivirusService = new Service.Switch(this.name + ' VirusDoc', 'antivirus');
        this.antivirusService.setCharacteristic(Characteristic.Name, 'VirusDoc');
        this.antivirusService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getAntivirusMode.bind(this))
            .onSet(this.setAntivirusMode.bind(this));

        // COMFORT MODE
        this.comfortService = new Service.Switch(this.name + ' Comfort', 'comfort');
        this.comfortService.setCharacteristic(Characteristic.Name, 'Comfort');
        this.comfortService
            .getCharacteristic(Characteristic.On)
            .onGet(this.getComfortMode.bind(this))
            .onSet(this.setComfortMode.bind(this));

        const pkg = require('../package.json');
        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.SerialNumber, this.duid)
            .setCharacteristic(Characteristic.Manufacturer, pkg.author)
            .setCharacteristic(Characteristic.Model, pkg.name)
            .setCharacteristic(Characteristic.FirmwareRevision, pkg.version);

        return [this.acService, this.antivirusService, this.comfortService, informationService];
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

    getSwingMode: async function () {
        const direction = this.currentDeviceState[State.Direction];
        return direction === Direction.SwingUpDown;
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

    // SETTERS
    setActive: function (isActive) {
        this.log('Setting active:', isActive);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Power, isActive ? 'On' : 'Off', (err) => {
                if (err) return reject(err);
                this.log('Active set');
                resolve();
            });
        });
    },

    setTargetTemperature: function (temperature) {
        this.log('Setting target temperature:', temperature);
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

    setSwingMode: function (enabled) {
        this.log('Setting swing mode:', enabled);
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Direction, enabled ? Direction.SwingUpDown : Direction.Fixed, (err) => {
                if (err) return reject(err);
                this.log('Swing mode set');
                resolve();
            });
        });
    },

    setRotationSpeed: function (speed) {
        this.log('Setting rotation speed:', speed);
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
        return new Promise((resolve, reject) => {
            this.api.deviceControl(State.Comfort, enabled ? 'SoftCool' : 'Off', (err) => {
                if (err) return reject(err);
                this.log('Comfort mode set');
                resolve();
            });
        });
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
            this.acService.getCharacteristic(Characteristic.SwingMode).updateValue(value === Direction.SwingUpDown);
            break;
        case State.WindLevel:
            this.acService.getCharacteristic(Characteristic.RotationSpeed).updateValue(mapper.rotationSpeedFromWindLevel(value));
            break;
        case State.Antivirus:
            this.antivirusService.getCharacteristic(Characteristic.On).updateValue(value === 'On');
            break;
        case State.Comfort:
            this.comfortService.getCharacteristic(Characteristic.On).updateValue(value === 'SoftCool');
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
