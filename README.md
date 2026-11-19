# Circuit Workbench

An offline-first circuit design, build-tracking, troubleshooting and measurement app. It's a static
Progressive Web App (plain HTML/CSS/ES modules, no build step or dependencies), made to run on GitHub
Pages and from the iOS Home Screen with no connection.

## Features

**Schematic editor**
- Standard symbols and a searchable part bank, grouped by category:
  - **Passives / coils**: resistors (incl. 5 W power), potentiometer, ceramic & electrolytic caps,
    inductors / coils (10 µH – 10 mH presets, 12 V relay coil).
  - **Switches & fuses**: toggle (SPST), changeover (SPDT), push buttons NO / NC, fuses 0.5–10 A
    (mark a fuse "blown" to troubleshoot).
  - **LEDs** (red, yellow, green, blue, white).
  - **Diodes**: switching (1N4148, 1N914, BAT54), rectifier (1N4001, 1N4007, 1N5408, UF4007, FR107),
    Schottky (1N5819, 1N5822, SS34), **Zeners** (3.3–27 V), **TVS** (SMAJ/SMBJ 5–24 V incl.
    bidirectional SMBJ12CA, P6KE6.8A/15A/33A, 1.5KE18A).
  - **Transistors**: 2N2222A, 2N3904, BC547, TIP31C, TIP120, 2N3906, BC557, TIP42C.
  - **MOSFETs**: IRLZ44N, IRFB4410, IRF540N, IRFZ44N, IRF3205, IRLB8721, IRFP260N, 2N7000, BSS138,
    AO3400, IRF9540N, IRF4905, AO3401.
  - **Op-amps** (symbol + real packages): TL072/TL074/TL082, LM358/LM324, NE5532, LM741, OPA2134 and
    low-voltage / rail-to-rail MCP6001/6002/6004, LMV358, TLV9002, TLV2372, OPA2340, AD8606; LM393.
  - **Sensors**: photoresistors (GL55xx, light slider), photodiodes (BPW34, SFH203, BPW21),
    phototransistors (TEPT5600, PT334-6C), pickup coils (L/DCR entered or calculated from turns,
    diameter, length, AWG and core µr), Hall sensors (A3144, SS49E, DRV5032), accelerometers
    (ADXL335 analog, ADXL345, MPU-6050), magnetometers (QMC5883L, HMC5883L).
  - **ADCs**: ADS1115 (module & chip), ADS1220, ADS1256 — live per-channel voltage → output code,
    full-scale and over-voltage warnings.
  - **Signal sources**: Si5351 clock generator (module & chip), DC / signal generator / current
    sources, ground, power rails, net labels; voltage regulators.
- **Custom parts**: define any ESP32 / dev board / module / IC pinout (two headers or DIP numbering,
  logic level, VIN & rail pins, supply current). Saved to the on-device library, reusable from the
  part drawer, and embedded in designs you save/export so they open on other devices.
- IC blocks drawn with their real physical pinouts: TC4420 / TC4429 / TC4427 / TC4426, IR2110 / IR2104,
  TL072 / LM358 / NE5532 / MCP6002 / TL074 / LM393, NE555, PC817, ESP32-S3 SuperMini,
  ESP32-S3-DevKitC-1, ESP32 DevKit V1 (30-pin), ESP32-C3 SuperMini, Arduino Nano, and a Generic IC
  with custom pin names.
- A spec bank for every named part (key specs, pinout, package drawing, notes). It pops up when you add
  a part; long-press a part or tap ⓘ to see it again.
- Touch-first editing:
  - **Tap** a part to select it, tap again to unselect. Drag a part by its body to move it. Small
    parts such as grounds, rails and labels can be dragged by their body at any zoom.
  - **Drag from a pin tip** to draw a wire. Drop it on a pin, a wire (creates a junction) or empty
    space (leaves a loose end).
  - **Tap to connect**: tap a pin or node (it highlights), then tap another pin, node or wire.
  - **Long-press a wire** to insert a node there.
  - Drag a wire's end handles to reconnect or disconnect it. **Detach** pulls a part out of the
    circuit and leaves its wires behind.
  - **Copy / Paste** (also ⌘/Ctrl C, X, V) parts with the wiring between them, including into
    another design. Rotate, flip, duplicate, delete, box-select and undo/redo are also available.
  - Values apply as you type; there is no need to press Enter or use the −/+ buttons.
  - The part drawer has **★ Pinned** parts and your **10 most recently used**.
- Values take engineering notation (`4.7k`, `4k7`, `100n`, `10u`, `1M`), and − / + buttons step
  through E24 values.
- MCU boards: each GPIO can be set to input, pull-up, pull-down, HIGH, LOW or PWM (average) and drives
  the simulation.

**Live simulation**
- DC operating point uses modified nodal analysis with damped Newton-Raphson, gain homotopy and source
  stepping. Device models include Shockley diodes and Zener breakdown, Ebers-Moll BJTs, smooth
  square-law MOSFETs with body diodes, op-amps with rail limits and GBW, regulators with dropout,
  gate-driver logic with UVLO, IR2110 bootstrap behaviour, optocouplers, and MCU boards with their
  onboard LDO.
- Wires are coloured by voltage and show voltage tags. LEDs light up when current flows through them.
- Design checks catch resistor over-power, LED over-current, reverse-biased electrolytics, regulator
  dropout and dissipation, gates driven below the RDS(on) spec, floating gates or inputs, saturated
  op-amps, gate-driver UVLO, low bootstrap voltage, 3.3 V GPIO over-voltage and GPIO over-current.

**Modes**
- **Edit**: build the schematic.
- **Build**: tap parts and wires as you place them on the board. Faded means still to do, ✓ means
  placed. It includes a checklist and progress bar, and saves with the design.
- **Debug**: tap parts and wires to cycle OK / Suspect / Fault, and add notes. Shows the expected
  (simulated) values for the selected item, the design-check list and a readings log.
- **Measure**: a virtual DMM, LCR meter and network analyser. Tap two nodes (red/black probes) to read:
  - **V⎓**: DC voltage between the probes, each probe to GND, and their ratio.
  - **Ω**: in-circuit resistance with power off (sources removed or shorted, semiconductors open).
  - **C · L · Z**: series C/L, |Z|, phase, ESR, D/Q at an adjustable test frequency, plus an |Z|(f)
    sweep that finds resonances.
  - **Freq. response**: a Bode plot from the actual circuit between IN and OUT. It uses the existing
    source as the stimulus when there is one and includes real loading and op-amp bandwidth. It
    classifies the response (low-pass, high-pass, band-pass, notch or flat) and reports f−3dB, f₀, Q,
    bandwidth and roll-off.
  - **Node / divider**: the Thevenin equivalent (Vth, Rth) at a node and the divider ratio relative to
    another node.
  - **Isolate selection**: analyse only the selected parts.
  - Tap switches to toggle them. Type in a real meter reading to log it against the expected value.

**Calculators** (slider + typed value for every input)
- **Op-amp designer**: buffer, non-inverting, inverting, summing, difference, integrator / low-pass,
  photodiode transimpedance and Sallen-Key; single or dual supply (auto VREF), any op-amp model.
  Shows gain, ideal vs simulated output (clipping), swing limits, bandwidth from GBW and a Bode /
  transimpedance plot, and inserts the circuit with probes placed.
- Filters (RC, RL, LC, series-RLC band-pass, LC trap, parallel-tank band-stop, Twin-T). These show the
  theoretical value and the response simulated on the actual template circuit, and can insert it into
  your design with probes already placed.
- Voltage divider (with load, and solving R2 for a target voltage), LED resistor, Ohm's law,
  reactance, op-amp gain, LM317, 555 astable, MOSFET gate drive.

**Files**
- Saved designs live in IndexedDB on the device. You can name, rename, open, duplicate and delete them.
- Your working session (including build and debug progress) autosaves continuously, so closing the app
  loses nothing.
- Export/import `.cwb.json`, back up all designs at once, and export SVG or PNG images. On iOS these go
  through the share sheet.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to *Deploy from a branch*, then choose your branch and
   **/ (root)**.
3. Open `https://<user>.github.io/<repo>/`.

All paths are relative, so it works from a project sub-path. `.nojekyll` makes Pages serve the files
as they are.

## Install on iPhone / iPad (offline)

Open the site in **Safari**, tap **Share → Add to Home Screen**, and launch it from the icon. The
service worker caches the whole app on the first visit, so it then runs with no connection. Tap the
**download icon** in the toolbar to see offline status, install help and the backup options.

> When you change any file, bump `VERSION` in `sw.js` so installed copies pick up the update.
> The app offers "Update ready — tap to reload".

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Project layout

| File | Purpose |
| --- | --- |
| `js/library.js` | Symbols, pinouts, spec bank, device models, part palette |
| `js/sim.js` | MNA solver (DC Newton-Raphson, complex AC) |
| `js/analysis.js` | DMM, LCR, Thevenin, Bode and filter classification, design checks |
| `js/netlist.js` | Connectivity (wires, net labels, rails, internal IC bridges) |
| `js/editor.js` | SVG canvas rendering and touch/mouse interaction |
| `js/doc.js` | Design document operations and geometry |
| `js/app.js` | App controller: modes, panels, meter, build/debug tracking, files |
| `js/tools.js` | Calculators and circuit templates |
| `js/store.js` | IndexedDB persistence |
| `js/partEditor.js` | Custom part / board editor and library |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |

## Accuracy notes

Models are idealised and meant for design, visualisation and troubleshooting, not sign-off. Spec-bank
figures are typical values, and MCU board header layouts vary by vendor. Always confirm against the
manufacturer datasheet and your board's silkscreen. The analysis is DC operating point plus
small-signal AC. There is no transient simulation, so PWM is shown as its average value.
