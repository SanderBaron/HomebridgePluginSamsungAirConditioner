# Developer Notes

Fork van [SebastianOsinski/HomebridgePluginSamsungAirConditioner](https://github.com/SebastianOsinski/HomebridgePluginSamsungAirConditioner)  
**Deze fork:** https://github.com/SanderBaron/HomebridgePluginSamsungAirConditioner

---

## Wat is er toegevoegd t.o.v. het origineel?

Twee extra schakelaars per airco, zichtbaar in Apple Home:

| Schakelaar | Protocol-attribuut | Aan | Uit |
|------------|-------------------|-----|-----|
| **VirusDoc** | `AC_ADD_SPI` | `On` | `Off` |
| **Comfort** | `AC_FUN_COMODE` | `SoftCool` | `Off` |

Gewijzigde bestanden:
- `lib/state.js` — attributen `Antivirus` en `Comfort` toegevoegd
- `lib/air-conditioner.js` — services, getters, setters en updateCharacteristic uitgebreid

Homebridge v2 migratie (versie 4.0.0):
- Alle `.on('get'/'set', callback)` vervangen door `.onGet(async fn)` / `.onSet(fn → Promise)`

---

## Wijzigingen doorvoeren

```bash
# 1. Pas code aan in lib/
# 2. Commit en push
git add lib/air-conditioner.js lib/state.js
git commit -m "Omschrijving"
git push origin master

# 3. Backup native modules (net-keepalive is een native addon die niet hercompileert op Node.js 22+)
cp -r /usr/local/lib/node_modules/homebridge-plugin-samsung-air-conditioner/node_modules /tmp/ac-plugin-node_modules

# 4. Installeer vanuit npm (na `npm publish`) of vanuit fork
npm install -g --ignore-scripts homebridge-samsung-ac-port2878
# of vanuit fork:
# npm install -g --ignore-scripts "git+ssh://git@github.com:SanderBaron/HomebridgePluginSamsungAirConditioner.git"

# 5. Zet native modules terug
cp -r /tmp/ac-plugin-node_modules/* /usr/local/lib/node_modules/homebridge-samsung-ac-port2878/node_modules/

# 6. Herstart Homebridge
sudo brew services restart homebridge
```

---

## Update van het origineel mergen

```bash
git fetch upstream
git merge upstream/master
# Conflicten oplossen indien nodig in lib/air-conditioner.js en lib/state.js
git push origin master
```

---

## Diagnose: onbekend protocol-attribuut achterhalen

Voeg tijdelijk toe aan de betreffende AC in je Homebridge `config.json`:
```json
"log_socket_activity": true
```

Log live bekijken:
```bash
tail -f ~/.homebridge/homebridge.log | grep -i "Read:"
```

Bedien de gewenste modus op de afstandsbediening. Het attribuut en de waarde verschijnen in de log. Verwijder `log_socket_activity` daarna weer.
