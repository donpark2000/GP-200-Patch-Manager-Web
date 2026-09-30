# GP-200 Patch Manager Web

A browser-based tool for **bulk backup and restore of Valeton GP-200
patches** over USB-MIDI. It's the web companion to the command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager).

**Status: early development. Nothing to use yet.** The first milestone is a
read-only backup tool.

- Runs in **Chrome or Edge** on Windows, macOS, or Linux. Safari isn't
  supported, because it has no Web MIDI.
- Nothing to install. It will be hosted on GitHub Pages.

## For contributors

- [`DESIGN.md`](DESIGN.md): what we're building and the decisions behind it.
- [`DEV_JOURNAL.md`](DEV_JOURNAL.md): running notes, findings, and open
  questions.
- The protocol itself is documented in the CLI repo's `PROTOCOL.md` and
  `PROTOCOL_NOTES.md`.

## License

GPL-3.0, same as the CLI. See [`LICENSE`](LICENSE).
