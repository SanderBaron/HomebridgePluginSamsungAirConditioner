# homebridge-samsung-ac-port2878

[![npm version](https://badge.fury.io/js/homebridge-samsung-ac-port2878.svg)](https://badge.fury.io/js/homebridge-samsung-ac-port2878)

Homebridge plugin for controlling Samsung Air Conditioners working on port 2878. Allows you to control your AC with HomeKit and Siri.

> **This is a fork** of [SebastianOsinski/HomebridgePluginSamsungAirConditioner](https://github.com/SebastianOsinski/HomebridgePluginSamsungAirConditioner) with the following additions:
> - **VirusDoc (UV)** and **Comfort (SoftCool)** mode switches
> - **Homebridge v2 compatible** (migrated from deprecated callback API to `onGet`/`onSet`)

If you have a Samsung AC that operates on port 8888, use this plugin instead: https://github.com/cicciovo/homebridge-samsung-airconditioner

---

## Installation

### Via Homebridge UI (recommended)

Search for `homebridge-samsung-ac-port2878` in the Homebridge UI plugin search and install from there.

### Manual

```bash
npm install -g homebridge-samsung-ac-port2878
```

---

## Setup

1. Assign a static IP address to your AC (via your router's DHCP settings).
2. Run the token helper and follow the on-screen instructions:
   ```bash
   homebridge-samsung-ac-get-token <your-ac-ip>
   ```
   If you get SSL/certificate errors, add `--skipCertificate`:
   ```bash
   homebridge-samsung-ac-get-token <your-ac-ip> --skipCertificate
   ```
3. Add the accessory to your Homebridge `config.json`. See `config-sample.json` for a full example.

---

## Configuration

```json
{
  "accessory": "Samsung Air Conditioner",
  "name": "Living Room AC",
  "ip_address": "192.168.1.100",
  "mac": "AA:BB:CC:DD:EE:FF",
  "token": "<token from step 2>"
}
```

### Required parameters

| Parameter | Description |
|-----------|-------------|
| `accessory` | Always `"Samsung Air Conditioner"` |
| `name` | Name shown in HomeKit |
| `ip_address` | IP address of the air conditioner |
| `mac` | MAC address in format `AA:BB:CC:DD:EE:FF` or `AA-BB-CC-DD-EE-FF` |
| `token` | Token obtained via `homebridge-samsung-ac-get-token` |

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `skip_certificate` | `false` | Skip SSL certificate validation (try if you get SSL errors) |
| `log_socket_activity` | `false` | Log raw socket data (useful for debugging) |
| `keep_alive.enabled` | `true` | Enable TCP keep-alive |
| `keep_alive.initial_delay` | `10000` | Milliseconds before first keep-alive packet |
| `keep_alive.interval` | `10000` | Milliseconds between keep-alive packets |
| `keep_alive.probes` | `10` | Number of failed probes before treating connection as closed |

---

## Features

- Turn AC on and off
- Get and set target temperature
- Get current temperature
- Get and set operating mode (cool / heat / auto)
- Get and set swing mode
- Get and set wind level (rotation speed)
- **VirusDoc (UV sterilisation)** switch — via `AC_ADD_SPI` attribute
- **Comfort (SoftCool)** switch — via `AC_FUN_COMODE` attribute
- Reacts to changes made via the AC's remote control

---

## Confirmed compatibility

| Model |
|-------|
| AR12HSSFAWKNEU |
| AR18HSFSAWKNEU |
| AR12HSFSAWKN |
| AR24FSSSBWKN |
| AR12FSSEDWUNEU |
| AR09HSSDBWKN |
| AR09HSSFRWKNER |
| MLM-H02 |

If your model works but isn't listed, please open a PR to add it.

---

## Acknowledgements

- Original plugin by [Sebastian Osiński](https://github.com/SebastianOsinski/HomebridgePluginSamsungAirConditioner)
- Protocol research by [CloCkWeRX](https://github.com/CloCkWeRX/node-samsung-airconditioner)
