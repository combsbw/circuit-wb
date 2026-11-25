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
    Schottky (1N5819, 1N5822, SS34), **Zeners** (3.3–27 V), **TVS**, unidirectional (A) and bidirectional (CA): SMAJ5.0, SMBJ5.0/12/15/24/33,
    P6KE6.8/15/33, 1.5KE18.
  - **Transistors**: 2N2222A, 2N3904, BC547, TIP31C, TIP120, 2N3906, BC557, TIP42C.
  - **MOSFETs**: IRLZ44N, IRFB4410, IRF540N, IRFZ44N, IRF3205, IRLB8721, IRFP260N, 2N7000, BSS138,
    AO3400, IRF9540N, IRF4905, AO3401.
  - **Comparators**: LM393, LM339, LM311, LMV393 (open collector) and MCP6561, TLV3201, TLV7011 (push-pull),
    all simulated.
  - **Common ICs**: 74HC595 shift register, 74HC14 Schmitt inverters (simulated), ULN2003A Darlington driver
    (simulated), L293D motor driver, TL431 reference (simulated), LM386 audio amp, TP4056 / TP4054 chargers,
    MCP23017 I/O expander, USBLC6-2 USB ESD protection, DS18B20 and LM35 (simulated) temperature sensors,
    INA219 current monitor, LSM6DS3 IMU, QMC5883P magnetometer, ESP32-S3-WROOM-1 module, and AP2112K-3.3 /
    ME6211C33 LDOs with enable pins.
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
  - Rotate, flip, **duplicate** (⌘/Ctrl D), delete, box-select and undo/redo.
  - Values apply as you type; there is no need to press Enter or use the −/+ buttons.
  - The part drawer has **★ Pinned** parts and your **10 most recently used**.
- Values take engineering notation (`4.7k`, `4k7`, `100n`, `10u`, `1M`), and − / + buttons step
  through E24 values.
- MCU boards: each GPIO can be set to input, pull-up, pull-down, HIGH, LOW or PWM and drives the
  simulation. PWM pins have linked **frequency / pulse width (µs) / duty** fields, a pulse-width
  slider with fine ± steps, and the real timer resolution (ESP32 LEDC 80 MHz, 14–20 bit; AVR 16 MHz).

**Live simulation**
- DC operating point uses modified nodal analysis with damped Newton-Raphson, gain homotopy and source
  stepping. Device models include Shockley diodes and Zener breakdown, Ebers-Moll BJTs, smooth
  square-law MOSFETs with body diodes, op-amps with rail limits and GBW, regulators with dropout,
  gate-driver logic with UVLO, IR2110 bootstrap behaviour, optocouplers, and MCU boards with their
  onboard LDO.
- Wires are coloured by voltage and show voltage tags. LEDs light up when current flows through them.
- Design checks (tap the warning pill) list each issue with **Show** (jump to the part), a one-tap
  **fix** where possible (e.g. connect a loose wire end that stops just short of a pin) and **Ignore**
  (saved with the design; restorable). Design checks catch resistor over-power, LED over-current, reverse-biased electrolytics, regulator
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

**Board designer** (box-select parts → **Build board**)
- Lays the selected parts out on a **solderless breadboard**, a **solderable breadboard**
  (ElectroCookie-style: same strips, drawn as a PCB) or a **perfboard**. Size comes from a preset or
  is entered as columns / holes / mm.
- What "optimal" means is explicit:
  - **Always enforced:** one net per strip or hole (no shorts), at most 5 holes per breadboard strip,
    ICs and dual-header modules straddle the channel, everything stays on the board.
  - **Minimised:** `wJ·jumpers + wL·wire length + wA·space used + wF·deviation from schematic order`.
    Presets: fewest jumpers, shortest wiring, smallest footprint, mirror the schematic, balanced.
    The weights are adjustable.
  - **Search:** simulated annealing with restarts. Breadboards use strip sharing, leads straight
    into the rails and automatic rail assignment. Perfboards get grid-routed bottom-side solder
    trails, optional power buses on the top and bottom rows, and insulated jumpers only where a
    trail can't get through.
- Every layout is re-traced hole by hole and compared with the schematic (✓ matches / list of problems).
- **Design ⇄ Board, both ways.** The schematic and its boards always describe the same circuit. Switch
  with the **Design | Board** control in the board header or the Boards button in the top bar.
  - *Design → board:* box-select parts → **Build board** (or Boards → build from all parts).
  - *Board → design:* Boards → **New blank board**, **Add part** (it is added to the schematic too),
    tap a pin → **Connect to pin** / **Connect to…** / **Disconnect**. Every connection is written to the
    schematic as a wire.
  - *Changing a board:* parts can move between the design and any board without being deleted.
    **Remove from board** (tap a part on the board, or × in its Setup list, or select it in the
    schematic) takes it off the board but keeps it in the design; **Add to board / Move to board**
    (select parts in the schematic) or **Add from schematic…** (inside a board) puts them on an existing
    board or on a **new board**, moving them off any other board. The part's sheet shows which board
    it is on. **Update layout** / **Rebuild** when the schematic changed. After edits the layout
    repairs itself with as little movement as possible (only conflicting parts move).
  - *Optimize:* lock the parts you placed by hand (**Lock all**), then **Optimize** to tidy the rest,
    or unlock and optimize everything for a more efficient version.
- **Jumpers avoid parts:** holes are chosen so a jumper doesn't lie across a part body, and where
  it still would, the wire is routed in right angles around the part (shown as "routed around"). It
  can be switched off in Options; anything that genuinely cannot avoid a part is flagged.
- **Labels never overlap** (references, connection points, bus names); a leader line is drawn when a
  label has to sit away from its part.
- **Rotate** the board view in 90° steps and flip to the bottom view; text stays upright and
  dragging follows your finger.
- **Connect board points to anything:** tap a connection point (or "Connect…" in the Connections
  tab) and pick another board's point, a part outside the board, or an existing wire/net. This adds
  a wire to the schematic, re-optimizes the layout and can be removed again under "Links made here".
- Drag parts to move them (a part only moves to a position that stays valid). Rotate, flip and lock
  parts; Optimize keeps locked parts in place. You can switch to a mirrored bottom view for
  soldering.
- **Build steps:** a checklist with exact holes ("R1 10kΩ: c16 → c20", jumpers, solder trails).
- **Build mode on the board:** switch **Layout | Build** in the board header, then tap parts, jumper
  wires, solder trails and connection points on the board to tick them off. Done items get a ✓ and
  full colour, remaining ones fade, and the next step pulses with **Done / Skip** in the bottom bar.
  Progress ("built 5/30") is shared with the Build steps checklist, and part progress is shared with
  the schematic's Build mode.
- **High-current warnings and wire gauge:** the **Wire & current** tab uses the simulation's DC/average
  currents to find the current in every jumper, strip, rail and trail. Anything above 70 % of its
  rating turns amber, above 100 % red (⚡ chip in the header, highlights on the board). Pick the
  default jumper gauge or a gauge per connection (30–12 AWG); **Suggest gauges** chooses the thinnest
  wire with margin. Solderless boards carry about 1 A per contact/strip/rail and fit 20 AWG or thinner;
  paths no wire here can carry are flagged as "take off the board". PWM and gate-driver peaks are not
  included and ampacity figures are typical, so check your own wire and parts.
- **Connections:** nets that leave the board become labelled connection points or a J1 header, with
  their destinations (other boards, supplies, off-board parts). With several boards it shows a
  board-to-board wiring list.
- Boards appear as labelled frames on the schematic; tap the label to open one.

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
- **Decoupling**: choose what you are decoupling (ESP32-S3, logic, op-amp, gate driver, ADC supply, clock
  generator or your own numbers) and give the supply voltage, load current step, edge time, allowed ripple,
  regulator bandwidth, supply pins, capacitor technology, ceramic dielectric / voltage rating and how the
  parts are mounted (plane via … breadboard wiring). It works out the target impedance ΔV/ΔI, the edge's
  knee frequency, the reservoir and charge-hold capacitance, then builds a capacitor bank (bulk → mid →
  100 nF per pin → small) and checks the combined impedance of regulator and capacitors, with DC-bias
  derating, ESR, ESL and mounting inductance, against the target. It plots |Z| against frequency and tells
  you when the wiring inductance, not the capacitor value, is the limit.
- **Sensor → ADC**: for high-impedance or low-level sensors (pH electrode, thermocouple, pickup coil, bridge,
  microphone, photodiode or your own Rs / cable C / coil L) into an ESP32, ADS1115 / ADS1220 / ADS1256,
  MCP3008 or generic SAR / ΔΣ ADC. Give the target resolution (V, mV, µV or A), signal bandwidth and sample
  rate. It decides direct drive vs buffer, and gives the series R, filter C, SAR charge-reservoir
  capacitor and isolation resistor, gain network or PGA setting, coil damping resistor, transimpedance
  Rf / Cf and candidate op-amps (input bias, noise, GBW, supply). The resolution budget lists thermal,
  op-amp, bias-current and converter noise, the achievable resolution with and without averaging, what
  dominates it, and the offset and gain errors. The designed path can be inserted into the circuit and its
  frequency response is simulated with the real solver.

- **RF link budget**: transmit power, installed antenna gain, return loss (|S11|), enclosure/battery/body loss,
  receiver gain and sensitivity, environment exponent and fade margin give the estimated range, the
  received-power-versus-distance plot and a table of what each fix buys (retune the match, +4 dBm, clear the
  antenna of metal, chip antenna). Enter the range you measured and it reports the loss the model can't
  explain, which is how to tell a detuned antenna from a weak link.

- **Power budget**: the power every part dissipates or delivers, taken from the live simulation (P = V × I at
  each pin), for the whole circuit, the current selection (**Power** button in the selection sheet) or one
  board, with resistor-rating warnings. A battery-life planner then lists each load with its active and
  sleep current and % of time awake (pre-filled from the simulation and typical datasheet figures for MCUs,
  radios, sensors and regulators), for linear or switching regulation, and gives the average current,
  battery life, peak current and energy per day.

**Reference** (book button in the top bar)
- A searchable guide to every kind of part in the library and the theory behind the simulator and the
  calculators, written for curious non-engineers: what each part is for, how it works, how it is wired in,
  the circuits it appears in, wiring tips, traps and common mistakes, what it is used with, and links to
  related topics.
- Category buttons (including **★ In this design**), full-text search with highlighting, and a "search in"
  filter for purpose, how it works, integration, circuits, tips, traps, companions or theory.
- Theory topics include Ohm's and Kirchhoff's laws (and how the solver works), dividers, RC/RL timing,
  impedance, filters, resonance, decibels, op-amps, comparators and hysteresis, semiconductors, transistor
  switching, PWM, oscillators, power supplies, decoupling, batteries and power budgets, ADCs, noise, radio
  links, wire gauge, measurement and digital buses, each with formulas, a worked example and pitfalls.
- Open it from a part's sheet (**Learn**) or info card, and from each calculator ("The theory behind this
  calculator"); part-library chips in an entry add that part to the design.

**Examples** (Files → Examples) include two complete designs: a BLE IMU + magnetometer tag reconstructed from
photos (nRF52832, LSM6DS3, QMC5883P, LiPo charging) and its ESP32-S3 redesign (ESP32-S3-WROOM-1, native USB
with ESD protection, USB/battery load sharing, AP2112K LDO, reset/boot buttons, battery and USB sensing). Toggle
S_USB in the ESP32 design to watch the power path switch between USB and battery.

**Files**
- Saved designs live in IndexedDB on the device. You can name, rename, open, duplicate and delete them.
- Your working session (including build and debug progress) autosaves continuously, so closing the app
  loses nothing.
- Export/import `.cwb.json`, back up all designs at once, and export SVG or PNG images. On iOS these go
  through the share sheet.

## PCB fab hand-off

Files → **PCB fab export** turns the schematic into what a PCB tool needs: a **KiCad netlist** (`.net`) with
footprints, pad numbers and nets, a **JLCPCB-format BOM** (Comment, Designator, Footprint, LCSC Part #) and a
plain pin–net CSV. Footprints default by part (0402 / 0603 / 0805 by value, SOT-23, QFN …) and can be edited,
as can pad numbers and LCSC part numbers. Rows marked ⚠ (functional symbols, polarised parts, guessed
footprints) must be checked: a symbol's pin numbers are not package pad numbers unless the part says so.

The app has no copper layout, so it does not write Gerbers, drill files or pick-and-place data. Import the
netlist into KiCad (Pcbnew → File → Import → Netlist), place and route, then Plot / Fabrication Outputs for
Gerbers, drill and the `.pos` placement file, or import into EasyEDA and order from JLCPCB. Custom parts can
carry `footprint`, `nums` (pad numbers per pin) and `functional` / `fabSkip` flags so they export correctly.

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
| `js/fab.js` | KiCad netlist, JLCPCB BOM and pin–net exports |
| `js/design.js` | Decoupling and sensor-interface design maths (no DOM) |
| `js/store.js` | IndexedDB persistence |
| `js/partEditor.js` | Custom part / board editor and library |
| `js/boards.js` | Board designer: footprints, optimiser, perfboard router, verification, build steps |
| `js/boardView.js` | Board designer UI |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |

## Accuracy notes

Models are idealised and meant for design, visualisation and troubleshooting, not sign-off. Spec-bank
figures are typical values, and MCU board header layouts vary by vendor. Always confirm against the
manufacturer datasheet and your board's silkscreen. The analysis is DC operating point plus
small-signal AC. There is no transient simulation, so PWM is shown as its average value.
