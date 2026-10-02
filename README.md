# GP-200 Patch Manager Web

A browser-based tool for **bulk backup and restore of Valeton GP-200
patches** over USB-MIDI. It's the web companion to the command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager).

**Open the app: <https://donpark2000.github.io/GP-200-Patch-Manager-Web/>**

**Status: test build.** Backup and restore are verified on real hardware:
full-pedal round trips kept every patch exactly, and a full restore of all
256 slots takes about 30 seconds. It writes to the pedal only after you confirm. So far
tested on one computer; a second is next.

- Runs in **Chrome or Edge** on Windows, macOS, or Linux. Safari isn't
  supported, because it has no Web MIDI.
- Nothing to install. Connect the GP-200 by USB, open the page, and allow
  MIDI access when the browser asks.
- **Back up** exports one slot as a `.prst` or several as a `.zip`, each
  file named after its slot and patch (e.g. `34A_Clean.prst`). **Restore** writes `.prst` files or a `.zip` to
  consecutive slots from a starting slot, shows what will be replaced, and
  checks every patch by reading it back.

This isn't a patch editor. If you want to create or edit patches, look at
[GP200 Studio](https://github.com/kabir0st/gp200-studio) (a full editor) or
[RigSheet](https://github.com/ricardo-mv/rigsheet); this tool covers the
narrower job of backing up and restoring whole banks.

## Credits

The GP-200's SysEx message formats (read requests, upload chunking,
preset-change messages, the nibble encoding) and the way a device dump maps
onto a `.prst` file were reverse-engineered by Kabir S. Tamari's
[GP200 Studio](https://github.com/kabir0st/gp200-studio) (GPL-3.0) from USB
captures of Valeton's own editor. They reached this project through the
command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager),
which ported them and then verified and extended them against real hardware.

[RigSheet](https://github.com/ricardo-mv/rigsheet) served as a second,
independent reverse-engineering of the protocol. It was used only as a
read-only cross-check of facts (for example, the SnapTone/NAM model-code
ranges and the upload addressing); none of RigSheet's code or text is
copied here.

## For contributors

- [`DESIGN.md`](DESIGN.md): what we're building and the decisions behind it.
- [`DEV_JOURNAL.md`](DEV_JOURNAL.md): running notes, findings, and open
  questions.
- The protocol itself is documented in the CLI repo's `PROTOCOL.md` and
  `PROTOCOL_NOTES.md`.

Layout: `src/core/` is the protocol (no UI code), `src/ui/` the page,
`tests/` the Node test suite with a fake pedal, `tools/` helper scripts.

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
the publish step. Add `?dev` to the page address for the developer tools.

## License

GPL-3.0, same as the CLI. See [`LICENSE`](LICENSE).
