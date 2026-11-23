"""Windows MIDI (winmm) for the GP-50 command-line runner (winmm.js starts it).

Opens the one port named GP-50 and passes SysEx through, a line each:
  in:  tx <hex>            out: ports <json>, ready <in> | <out>
       close                    rx <driver ms> <hex>, sent <ms taken>,
                                err <text>, fatal <text>
Never opens another pedal's port, and can send nothing but SysEx. What may be
sent is decided by the gates in ../protocol.js and ../write-protocol.js.

With --pedal gp200 it opens the one GP-200 port instead, to READ only
(CLAUDE.md: no GP-200 writes from the runner): it refuses to send anything
but the GP-200's identity query and read requests, whatever it is given
(also gated in gp200-read.js).
"""
import ctypes
import json
import queue
import re
import sys
import threading
import time
from ctypes import wintypes as w

mm = ctypes.WinDLL("winmm")
CALLBACK_FUNCTION = 0x00030000
MIM_CLOSE, MIM_DATA, MIM_LONGDATA, MIM_ERROR, MIM_LONGERROR = range(0x3C2, 0x3C7)
MHDR_DONE = 1
PEDALS = {
    "gp50": ("GP-50", lambda name: re.search(r"GP-50(?!\d)", name, re.I)),  # as isGp50Name in ../device.js
    "gp200": ("GP-200", lambda name: re.search(r"gp", name, re.I) and "200" in name),  # as findGp200Ports
}
PEDAL = "gp50"
BUFFERS, BUFFER_SIZE = 64, 1024
# GP-200: header, then cmd 0x11 (request) with sub 0x04 identity, 0x10 dump
# read or 0x20 name read. Nothing else, ever (no 0x12 = enter editor mode).
GP200_HEADER = bytes([0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32])
GP200_READS = {0x04, 0x10, 0x20}


def gp200_read_only(data):
    return bytes(data[:8]) == GP200_HEADER and len(data) > 10 and data[8] == 0x11 and data[9] in GP200_READS


class Caps(ctypes.Structure):
    _fields_ = [("mid", w.WORD), ("pid", w.WORD), ("version", w.UINT), ("name", w.WCHAR * 32), ("rest", w.BYTE * 64)]


class Header(ctypes.Structure):
    pass


Header._fields_ = [
    ("data", ctypes.c_void_p), ("length", w.DWORD), ("recorded", w.DWORD),
    ("user", ctypes.c_size_t), ("flags", w.DWORD), ("next", ctypes.POINTER(Header)),
    ("reserved", ctypes.c_size_t), ("offset", w.DWORD), ("more", ctypes.c_size_t * 8),
]
HEADER_SIZE = ctypes.sizeof(Header)
CALLBACK = ctypes.WINFUNCTYPE(None, w.HANDLE, w.UINT, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t)
for fn in ("midiInOpen", "midiOutOpen"):
    getattr(mm, fn).argtypes = [ctypes.POINTER(w.HANDLE), w.UINT, ctypes.c_void_p, ctypes.c_size_t, w.DWORD]
for fn in ("midiInPrepareHeader", "midiInUnprepareHeader", "midiInAddBuffer",
           "midiOutPrepareHeader", "midiOutUnprepareHeader", "midiOutLongMsg"):
    getattr(mm, fn).argtypes = [w.HANDLE, ctypes.POINTER(Header), w.UINT]
for fn in ("midiInStart", "midiInStop", "midiInReset", "midiInClose", "midiOutClose"):
    getattr(mm, fn).argtypes = [w.HANDLE]
for fn in ("midiInGetDevCapsW", "midiOutGetDevCapsW"):
    getattr(mm, fn).argtypes = [ctypes.c_size_t, ctypes.c_void_p, w.UINT]

out_lock = threading.Lock()


def say(line):
    with out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def names(direction):
    found = []
    for i in range(getattr(mm, f"midi{direction}GetNumDevs")()):
        caps = Caps()
        getattr(mm, f"midi{direction}GetDevCapsW")(i, ctypes.byref(caps), ctypes.sizeof(caps))
        found.append(caps.name)
    return found


def choose(direction, ports):
    label, match = PEDALS[PEDAL]
    hits = [i for i, name in enumerate(ports) if match(name)]
    if len(hits) != 1:
        raise RuntimeError(f"{len(hits)} MIDI {direction} ports are named {label}, expected 1 (ports: {ports})")
    return hits[0]


def must(rc, what):
    if rc:
        raise RuntimeError(f"{what} failed, winmm error {rc}")


class Bridge:
    def __init__(self):
        self.events = queue.Queue()
        self.hin, self.hout = w.HANDLE(), w.HANDLE()
        self.headers, self.buffers = [], []
        self.callback = CALLBACK(self.on_midi)
        self.closing = False

    # On a Windows thread: copy and hand over, nothing else (no winmm calls).
    def on_midi(self, _handle, msg, _instance, p1, p2):
        if msg in (MIM_LONGDATA, MIM_LONGERROR):
            hdr = ctypes.cast(p1, ctypes.POINTER(Header)).contents
            data = ctypes.string_at(hdr.data, hdr.recorded) if hdr.recorded else b""
            self.events.put(("long" if msg == MIM_LONGDATA else "longerror", hdr.user, data, p2))
        elif msg in (MIM_DATA, MIM_ERROR):
            self.events.put(("short", None, f"{p1 & 0xFFFFFF:06x}", p2))
        elif msg == MIM_CLOSE and not self.closing:
            self.events.put(("gone", None, None, None))

    def open(self):
        ins, outs = names("In"), names("Out")
        say("ports " + json.dumps({"in": ins, "out": outs}))
        i, o = choose("input", ins), choose("output", outs)
        callback = ctypes.cast(self.callback, ctypes.c_void_p)
        must(mm.midiInOpen(ctypes.byref(self.hin), i, callback, 0, CALLBACK_FUNCTION), "Opening the input")
        must(mm.midiOutOpen(ctypes.byref(self.hout), o, None, 0, 0), "Opening the output")
        for n in range(BUFFERS):
            buf = ctypes.create_string_buffer(BUFFER_SIZE)
            hdr = Header(data=ctypes.addressof(buf), length=BUFFER_SIZE, user=n)
            self.buffers.append(buf)
            self.headers.append(hdr)
            must(mm.midiInPrepareHeader(self.hin, ctypes.byref(hdr), HEADER_SIZE), "Preparing a buffer")
            must(mm.midiInAddBuffer(self.hin, ctypes.byref(hdr), HEADER_SIZE), "Adding a buffer")
        must(mm.midiInStart(self.hin), "Starting the input")
        say(f"ready {ins[i]} | {outs[o]}")

    def send(self, data):
        if len(data) < 2 or data[0] != 0xF0 or data[-1] != 0xF7 or any(b > 0x7F for b in data[1:-1]):
            raise RuntimeError("refused to send: not exactly one SysEx message")
        if PEDAL == "gp200" and not gp200_read_only(data):
            raise RuntimeError(f"refused to send to the GP-200: not a read ({data[:12].hex()}...)")
        buf = ctypes.create_string_buffer(bytes(data), len(data))
        hdr = Header(data=ctypes.addressof(buf), length=len(data))
        t0 = time.perf_counter()
        must(mm.midiOutPrepareHeader(self.hout, ctypes.byref(hdr), HEADER_SIZE), "Preparing to send")
        must(mm.midiOutLongMsg(self.hout, ctypes.byref(hdr), HEADER_SIZE), "Sending")
        while not hdr.flags & MHDR_DONE:
            if time.perf_counter() - t0 > 5:
                raise RuntimeError("Windows hasn't finished sending a message after 5 s")
            time.sleep(0.0005)
        mm.midiOutUnprepareHeader(self.hout, ctypes.byref(hdr), HEADER_SIZE)
        say(f"sent {(time.perf_counter() - t0) * 1000:.1f}")

    def run(self):
        threading.Thread(target=self.read_stdin, daemon=True).start()
        while True:
            kind, user, data, stamp = self.events.get()
            if kind == "stop":
                return
            if kind == "gone":
                raise RuntimeError("Windows closed the port")
            if kind == "tx":
                self.send(data)
            elif kind == "short":
                say(f"err unexpected short message {data}")
            else:
                if kind == "longerror":
                    say(f"err damaged SysEx {data.hex()}")
                elif data:
                    say(f"rx {stamp} {data.hex()}")
                must(mm.midiInAddBuffer(self.hin, ctypes.byref(self.headers[user]), HEADER_SIZE), "Adding a buffer back")

    def read_stdin(self):
        for line in sys.stdin:
            cmd, _, rest = line.strip().partition(" ")
            if cmd == "close":
                break
            if cmd == "tx":
                try:
                    self.events.put(("tx", None, bytes.fromhex(rest), None))
                except ValueError:
                    say(f"err not hex: {rest}")
        self.events.put(("stop", None, None, None))

    def close(self):
        self.closing = True
        if self.hin:
            mm.midiInStop(self.hin)
            mm.midiInReset(self.hin)
            for hdr in self.headers:
                mm.midiInUnprepareHeader(self.hin, ctypes.byref(hdr), HEADER_SIZE)
            mm.midiInClose(self.hin)
        if self.hout:
            # Not midiOutReset: it sends note-offs to the pedal.
            mm.midiOutClose(self.hout)


def main():
    global PEDAL
    args = sys.argv[1:]
    if args == ["--list"]:
        say("ports " + json.dumps({"in": names("In"), "out": names("Out")}))
        return 0
    if args[:1] == ["--pedal"]:
        if len(args) != 2 or args[1] not in PEDALS:
            say(f"fatal --pedal takes one of {', '.join(PEDALS)}")
            return 1
        PEDAL = args[1]
    elif args:
        say(f"fatal unknown arguments {args}")
        return 1
    bridge = Bridge()
    try:
        bridge.open()
        bridge.run()
        return 0
    except Exception as err:  # whatever it is, the runner must hear of it
        say(f"fatal {err}")
        return 1
    finally:
        bridge.close()


if __name__ == "__main__":
    sys.exit(main())
