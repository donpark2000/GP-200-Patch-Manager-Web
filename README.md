# GP-200 Patch Manager Web

A browser-based tool for **bulk backup and restore of Valeton GP-200
patches** over USB-MIDI. It's the web companion to the command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager).

**Open the app: <https://donpark2000.github.io/GP-200-Patch-Manager-Web/>**

**Tested with one pedal: a GP-200 on firmware 1.8.0.** Other firmware
versions and the other pedals in the GP-200 family (such as the GP-200LT
and GP-200JR, which are said to use the same patch files) haven't been
tested: use it with them at your own risk, and **back up before writing
anything**. If you try it with another model or firmware, please say how it
went, whether it worked or not, by opening an
[issue](https://github.com/donpark2000/GP-200-Patch-Manager-Web/issues/new)
with your pedal's model and firmware (the app can't read them).

On the developer's pedal, full-pedal round trips kept every patch exactly,
and a full restore of all 256 slots takes about 30 seconds.

- Runs in **Chrome or Edge** on a Windows, macOS, or Linux computer.
  Firefox, Safari and phones/tablets can't reach the pedal (no Web MIDI).
- Nothing to install, and nothing is sent anywhere: your patches stay on
  your computer. Connect the GP-200 by USB, open the page, and allow MIDI
  access when the browser asks.
- The list shows all 256 patches on the pedal. Choose slots by dragging
  across the list, clicking the first and last, or typing them in.
- **Back up** saves one slot as a `.prst` or several as a `.zip`, each file
  named after its slot and patch (e.g. `34A_Clean.prst`).
- **Restore** writes `.prst` files or a `.zip` to consecutive slots from a
  starting slot.
- **Template** writes one `.prst` into a range of slots, by default only
  into empty ones ("It's GP-200"), as a starting point for new patches.
- Every write shows what will be replaced, asks you to confirm, and is
  checked by reading the patch back. Your own IRs and NAM captures aren't
  in a backup, only the slot each patch uses (see Help).
- Problems: in the app, Help > Report a problem.

This isn't a patch editor. If you want to create or edit patches, look at
[GP200 Studio](https://gp200studio.com/), a full editor
([source](https://github.com/kabir0st/gp200-studio)); this tool covers the narrower job of backing up and restoring whole banks.

## Credits

The GP-200's SysEx message formats (read requests, upload chunking,
preset-change messages, the nibble encoding) and the way a device dump maps
onto a `.prst` file were reverse-engineered by Kabir S. Tamari's
[GP200 Studio](https://github.com/kabir0st/gp200-studio) (GPL-3.0) from USB
captures of Valeton's own editor. They reached this project through the
command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager),
which ported them and then verified and extended them against real hardware.

The upload addressing (where the target slot goes in a flash upload) was
found by cross-checking against
[RigSheet](https://github.com/ricardo-mv/rigsheet)'s independent
reverse-engineering. Only that fact is used; none of RigSheet's code or
text is copied here.

## For contributors

- [`DESIGN.md`](DESIGN.md): what we're building and the decisions behind it.
- [`DEV_JOURNAL.md`](DEV_JOURNAL.md): running notes, findings, and open
  questions.
- The protocol itself is documented in the CLI repo's `PROTOCOL.md` and
  `PROTOCOL_NOTES.md`.

Layout: `src/core/` is the protocol (no UI code), `src/ui/` the pages'
code (`index.html` is the app; `test.html`, the developer test page that
first proved the core on hardware, is kept for local use and not
published), `tests/` the Node test suite with a fake pedal, `tools/`
helper scripts.

Run the tests (Node.js 20 or newer, no packages to install):

```
npm test
```

Run the page locally. Web MIDI needs `https://` or `localhost`, and ES
modules don't load from `file://`, so serve the folder:

```
python -m http.server 8000
```

then open <http://localhost:8000> in Chrome or Edge.

Compare two exports slot by slot, e.g. a backup with an export made after
a restore (add `--shift 1` after restoring from slot 1B):

```
node tools/compare-zips.js backup.zip gp200_all_patches.zip
```

Publishing: CI runs the tests on every pull request, and publishes the site
to GitHub Pages only from `main`. Work on a branch; merging to `main` is
the publish step. Add `?dev` to the page address for the developer tools,
and `?dev&fake` (localhost only) to use the test suite's fake pedal.

## License

GPL-3.0, same as the CLI. See [`LICENSE`](LICENSE).
