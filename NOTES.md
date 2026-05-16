# Homebridge Samsung AC Plugin — Projectnotities

Fork van [SebastianOsinski/HomebridgePluginSamsungAirConditioner](https://github.com/SebastianOsinski/HomebridgePluginSamsungAirConditioner)  
**Onze fork:** https://github.com/SanderBaron/HomebridgePluginSamsungAirConditioner

---

## Wat is er toegevoegd?

Twee extra schakelaars zichtbaar in de Apple Home app, per airco:

| Schakelaar | Protocol-attribuut | Aan | Uit |
|------------|-------------------|-----|-----|
| **VirusDoc** | `AC_ADD_SPI` | `On` | `Off` |
| **Comfort** | `AC_FUN_COMODE` | `SoftCool` | `Off` |

Gewijzigde bestanden:
- `lib/state.js` — attributen `Antivirus` en `Comfort` toegevoegd
- `lib/air-conditioner.js` — services, getters, setters en updateCharacteristic uitgebreid

---

## Airco's

| Naam | IP-adres | MAC |
|------|----------|-----|
| Sam | 192.168.2.166 | F8:04:2E:A5:6C:EB |
| Kantoor | 192.168.2.160 | F8:04:2E:88:9D:BE |
| Sara | 192.168.2.164 | F8:04:2E:A5:4F:CE |
| Master Bedroom | 192.168.2.162 | F8:04:2E:D8:37:08 |

Homebridge config: `~/.homebridge/config.json`  
Plugin installatie: `/usr/local/lib/node_modules/homebridge-plugin-samsung-air-conditioner/`

---

## Wijzigingen doorvoeren

```bash
# 1. Pas code aan in lib/
# 2. Commit en push naar fork
git add lib/air-conditioner.js lib/state.js
git commit -m "Omschrijving"
git push origin master

# 3. Backup native modules (moeten bewaard blijven — net-keepalive is een native addon)
cp -r /usr/local/lib/node_modules/homebridge-plugin-samsung-air-conditioner/node_modules /tmp/ac-plugin-node_modules

# 4. Installeer vanuit fork
npm install -g --ignore-scripts "git+ssh://git@github.com:SanderBaron/HomebridgePluginSamsungAirConditioner.git"

# 5. Zet native modules terug (net-keepalive v3 compileert niet op Node.js 22+)
cp -r /tmp/ac-plugin-node_modules/* /usr/local/lib/node_modules/homebridge-plugin-samsung-air-conditioner/node_modules/

# 6. Herstart Homebridge
sudo brew services restart homebridge
```

## Homebridge v2 compatibiliteit

Bijgewerkt op 2026-05-16. De plugin gebruikt nu de nieuwe Homebridge v2 API:
- `characteristic.onGet(async () => value)` i.p.v. `.on('get', callback)`
- `characteristic.onSet((value) => Promise)` i.p.v. `.on('set', callback)`

De plugin is hiermee compatibel met zowel Homebridge v1.8+ als v2.x.

---

## Update van het origineel mergen

```bash
git fetch upstream
git merge upstream/master
# Conflicten oplossen indien nodig in lib/air-conditioner.js en lib/state.js
git push origin master
# Dan bovenstaande installatiestappen uitvoeren
```

---

## Diagnose: onbekend protocol-attribuut achterhalen

Voeg tijdelijk toe aan de betreffende AC in `~/.homebridge/config.json`:
```json
"log_socket_activity": true
```

Log live meekijken:
```bash
tail -f ~/.homebridge/homebridge.log | grep -i "naam ac\|Read:"
```

Bedien de gewenste modus op de afstandsbediening. In de log verschijnt het attribuut en de waarde. Daarna `log_socket_activity` weer verwijderen.
