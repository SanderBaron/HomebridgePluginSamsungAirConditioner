const events = require('events');
const util = require('util');
const tls = require('tls');
const carrier = require('carrier');
const shortid = require('shortid');
const connectionHelper = require('./connection-helper');

function AirConditionerApi(ipAddress, skipCertificate, duid, token, log, logSocketActivity, keepAliveConfig) {
    this.connectionOptions = connectionHelper.createConnectionOptions(
        ipAddress,
        skipCertificate,
        log
    );
    this.duid = duid;
    this.token = token;
    this.log = log;
    this.logSocketActivity = logSocketActivity;

    const defaultKeepAliveConfig = {
        "enabled": true,
        "initial_delay": 10000,
        "heartbeat_interval": 30000,   // DeviceState ping every 30 s keeps NAT tables + AC WiFi alive
        "dead_socket_timeout": 180000  // force-reconnect if nothing heard for 3 min (3 missed beats)
    }

    this.keepAliveConfig = Object.assign({}, defaultKeepAliveConfig, keepAliveConfig);

    if (keepAliveConfig && ('interval' in keepAliveConfig || 'probes' in keepAliveConfig)) {
        log('Note: keep_alive.interval and keep_alive.probes are deprecated as of v4.4.0 and have no effect. Configure inactivity-based detection via keep_alive.dead_socket_timeout (ms).');
    }

    log('Keep alive config:', this.keepAliveConfig);

    this.authenticated = false;
};

AirConditionerApi.prototype = {
    connect: function () {
        this.log('Connecting...');

        this.controlCallbacks = {};
        this._clearDeadSocketDetector();
        this._clearConnectTimer();

        this.socket = tls.connect(this.connectionOptions, function () {
            this._clearConnectTimer(); // handshake complete — cancel the connect timeout
            this.log('Connected');

            this.socket.setKeepAlive(this.keepAliveConfig.enabled, this.keepAliveConfig.initial_delay);
            this._startDeadSocketDetector();

            // All responses from AC are received here as lines
            carrier.carry(this.socket, this._readLine.bind(this));
        }.bind(this));

        // Safety net: if the TLS handshake doesn't complete within 90 s, force a retry.
        // 90 s > the macOS TCP ETIMEDOUT (~75 s) so the OS usually fires first for hard-down
        // hosts; our timer only catches the TLS-hang case (TCP up, handshake stalled).
        this._connectTimer = setTimeout(function () {
            this.log('Connect attempt timed out after 90s — forcing retry');
            try { this.socket.destroy(); } catch (e) { /* close/error handler will reconnect */ }
        }.bind(this), 90000);

        this.socket
            .on('end', this._connectionEnded.bind(this))
            .on('close', this._connectionClosed.bind(this))
            .on('error', this._errorOccured.bind(this));
    },

    deviceControl: function (key, value, callback) {
        if (!this.authenticated) {
            callback(new Error('Connection not established'));

            return;
        }

        // Create id for callback. It will be passed to request and returned by AC in response
        // It allows us to match callbacks to responses received in `carrier.carry` callback above
        const id = shortid.generate()

        if (!!callback) {
            this.controlCallbacks[id] = callback;
        }

        this._send(
            '<Request Type="DeviceControl"><Control CommandID="' + id + '" DUID="' + this.duid + '"><Attr ID="' + key + '" Value="' + value + '" /></Control></Request>'
        );
    },

    _send: function (line) {
        if (this.logSocketActivity) { this.log('Write:', line); }

        this.socket.write(line + "\r\n");
    },

    _readLine: function (line) {
        this._lastReceivedAt = Date.now();
        if (this.logSocketActivity) { this.log('Read:', line); }

        if (line.match(/Update Type="InvalidateAccount"/)) { // Returned in the beginning of connection. We need to send auth request with token.
            this._handleInvalidateAccount();
        } else if (line.match(/Response Type="AuthToken" Status="Okay"/)) { // Auth success
            this._handleAuthSuccessResponse();
        } else if (line.match(/Update Type="Status"/)) { // Status update received - AC sends them when some setting is changed via remote. 
            this._handleDeviceStatusUpdate(line);
        } else if (line.match(/Response Type="DeviceState" Status="Okay"/)) { // Status response received - AC sends it after receiving request for status
            this._handleDeviceStateResponse(line);
        } else if (line.match(/Response Type="DeviceControl" Status="Okay"/)) { // Control confirmation received - AC sends it to confirm control success
            this._handleDeviceControlResponse(line);
        };
    },

    _handleInvalidateAccount: function() {
        this.log("Auth request received - Authenticating...");

        this._send('<Request Type="AuthToken"><User Token="' + this.token + '"/></Request>');
    },

    _handleAuthSuccessResponse: function() {
        this.log("Authentication succeeded");

        this.authenticated = true;
        this._lastErrorCode = null; // reset backoff after a successful connection

        this.log("Requesting full state summary...");

        // Request full state summary;
        this._send('<Request Type="DeviceState" DUID="' + this.duid + '"></Request>');

        // Start heartbeat: periodic DeviceState requests keep the TCP connection alive through
        // router NAT tables and keep the AC's WiFi module from sleeping, replicating what the
        // old net-keepalive TCP probes did — without native Node.js modules.
        this._startHeartbeat();
    },

    _handleDeviceStateResponse: function (line) {
        this.log("Full state summary received");

        const attributes = line.split("><");
        const state = {};
        attributes.forEach(function (attr) {
            if ((matches = attr.match(/Attr ID="(.*)" Type=".*" Value="(.*)"/))) {
                const id = matches[1];
                state[id] = matches[2];
            }
        }.bind(this));

        this.emit('stateUpdate', state);
    },

    _handleDeviceControlResponse: function (line) {
        if ((matches = line.match(/CommandID="(.*)"/))) {
            id = matches[1];

            if (!this.controlCallbacks[id]) return;
            callback = this.controlCallbacks[id];
            delete (this.controlCallbacks[id]);

            callback(null);
        }
    },

    _handleDeviceStatusUpdate: function(line) {
        if ((matches = line.match(/Attr ID="(.*)" Value="(.*)"/))) {
            const state = {};
            state[matches[1]] = matches[2];

            this.emit('stateUpdate', state);
        }
    },

    _errorOccured: function(error) {
        this.log('Error occured:', error.message);

        // Remember the error code so _connectionClosed can use the right backoff delay.
        this._lastErrorCode = error.code;

        // Error all callbacks
        Object.keys(this.controlCallbacks).forEach(function(id) {
            this.controlCallbacks[id](error);
        }.bind(this));

        this.controlCallbacks = {};
    },

    _connectionEnded: function () {
        this.log('Connection ended');
    },

    _connectionClosed: function (hadError) {
        this.authenticated = false;
        this._clearDeadSocketDetector();
        this._clearConnectTimer();
        this._clearHeartbeat();

        this.log('Connection closed' + (hadError ? ' because error occured' : ''));

        // ECONNRESET means the AC accepted the TCP connection but immediately rejected it —
        // usually because it still has a stale session from a previous rapid-reconnect loop.
        // Back off for 30 s to give the AC time to clear its connection state.
        const delay = (this._lastErrorCode === 'ECONNRESET') ? 30000 : 5000;
        this._lastErrorCode = null;
        this.log('Trying to reconnect in ' + (delay / 1000) + 's...');

        setTimeout(this.connect.bind(this), delay);
    },

    _startDeadSocketDetector: function () {
        this._lastReceivedAt = Date.now();

        const timeout = this.keepAliveConfig.dead_socket_timeout;
        if (!timeout || timeout <= 0) return;

        const checkEvery = Math.min(30000, Math.max(1000, Math.floor(timeout / 2)));

        this._deadSocketTimer = setInterval(function () {
            const silentFor = Date.now() - this._lastReceivedAt;
            if (silentFor > timeout) {
                this.log('No data received for ' + Math.round(silentFor / 1000) + 's — assuming socket is dead, forcing reconnect');
                this._clearDeadSocketDetector();
                try { this.socket.destroy(); } catch (e) { /* close handler will reconnect */ }
            }
        }.bind(this), checkEvery);
    },

    _clearDeadSocketDetector: function () {
        if (this._deadSocketTimer) {
            clearInterval(this._deadSocketTimer);
            this._deadSocketTimer = null;
        }
    },

    _clearConnectTimer: function () {
        if (this._connectTimer) {
            clearTimeout(this._connectTimer);
            this._connectTimer = null;
        }
    },

    // Send a DeviceState request on a fixed interval to keep the TCP session alive through
    // router NAT tables and prevent the AC's WiFi module from going to deep sleep.
    // This is the application-layer equivalent of what net-keepalive did with TCP probes.
    _startHeartbeat: function () {
        this._clearHeartbeat();
        const interval = this.keepAliveConfig.heartbeat_interval;
        if (!interval || interval <= 0) return;
        this._heartbeatTimer = setInterval(function () {
            if (!this.authenticated) return;
            this._send('<Request Type="DeviceState" DUID="' + this.duid + '"></Request>');
        }.bind(this), interval);
    },

    _clearHeartbeat: function () {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }
};

util.inherits(AirConditionerApi, events.EventEmitter);

module.exports = AirConditionerApi;