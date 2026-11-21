# Windows native original-Joy — first milestone

## Release boundary

The accepted maintenance changes are staged locally as 2.1.1. Nothing is committed, tagged or published. Staged tree: `2c3e79eb44a69fc03f128b2094552c7282fee0bc`.

Windows-native development starts after that snapshot and remains unstaged. Do not mix it into 2.1.1 accidentally. Existing Windows legacy routing and all native platform/approval gates remain unchanged.

## Implemented foundation

`packages/joy-runtime/runtime/bluetooth/windows_endpoint.py` implements the Windows `SOCKADDR_BTH` address ABI, with explicit fixed-width fields, packed layout, Bluetooth address validation and exactly one resolution mode: an explicitly supplied service UUID or a previously discovered remote RFCOMM channel. It performs no discovery, DLL loading, connection, crypto reset or motion. There is no assumed default Joy service/channel.

This pure ABI component is deliberately not a usable transport or enabled runtime backend. It is the input structure for the next Winsock boundary, not a stub claiming device support.

Seven new portable tests check exact bytes, field offsets/size, explicit channel vs service resolution, malformed addresses, channel/UUID rejection and continued fail-closed Windows runtime admission before transport construction. Meaningful RED recorded against the minimal unimplemented API; GREEN after implementation. Full Python runtime suite passes: 442 tests, 53 modules, no platform exclusions on the current macOS host.

## Sources and limits

- Microsoft `SOCKADDR_BTH`: https://learn.microsoft.com/en-us/windows/win32/api/ws2bth/ns-ws2bth-sockaddr_bth
- Microsoft Bluetooth `connect`: https://learn.microsoft.com/en-us/windows/win32/bluetooth/bluetooth-and-connect
- Layout packing reference (secondary/open-source header): https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-headers/include/ws2bth.h — wraps the structure with `pshpack1.h` / `poppack.h`.

Documented Windows behavior: channel zero plus an explicit non-null service UUID lets Windows resolve the remote service using SDP; an explicit remote channel requires prior resolution. This does not prove the Joy's service discovery or connection behavior on Windows. Packed ABI tests have not yet been compared to a compiled Windows SDK probe.

## Transport audit findings

Independent read-only audit completed; no Windows execution or device access was performed. Parent confirmed the existing macOS helper selects SPP UUID `0x1101` (`runtime/bluetooth/joy_rfcomm.m:107`), which gives a source-backed candidate service UUID for the Windows adapter. That is not proof of Windows SDP/connect behavior.

- Use a concrete Windows Winsock binding, not an assumed Python `socket.AF_BTH`: the Python socket documentation lists Bluetooth availability on Linux/FreeBSD, not Windows. A lazy-loaded `ctypes` binding is the proposed dependency-free route; it still needs implementation and Windows ABI validation.
- Reuse `FramedChannel` and existing Joy session crypto. The current ECB/checksum protocol is not authenticated encryption or peer-identity proof; this port must not strengthen that claim or silently change framing.
- Worker connect currently rejects non-Darwin platforms before transport creation (`runtime/worker.py`). Loading/job task guards and the trusted host's service/routing gates also need deliberate, tested admission changes; switching one platform condition is insufficient.
- Discovery currently invokes the macOS helper through `apps/desktop/src/shell/joy-discovery.ts` and `main.ts`. Implement equivalent paired-device metadata/SPP discovery on Windows, without startup inquiry or automatic pairing.
- `packages/joy-runtime/scripts/build-runtime.cjs:7–10` explicitly exits outside macOS and builds an Objective-C helper. Windows packaging needs a real native-runtime build/resource path, not reuse of a Mac executable. Windows virtualenv setup alone does not solve this.

Next complete transport slice must implement the existing `open/read/write/close` byte-stream contract: inert construction, approval before open, bounded calls, partial-read/write accounting, no replay after uncertain completion, cancel/close retirement, and shared framed initialization. Keep live Windows admission disabled until that slice and host/build wiring are verified.

## Byte-stream adapter progress

`runtime/bluetooth/windows_transport.py` now implements the approved byte-stream adapter above the Winsock binding. Fourteen inert-peer regressions pass: denied/no-I/O construction, explicit open, bounded partial reads/writes, one total write deadline, uncertain-write retirement without replay, cancellation during connect/read/write, late-reply rejection, idempotent close and the actual shared `FramedChannel` consumer. Failed cleanup retains a quarantined backend reference; a retired adapter cannot reopen.

The default worker now uses `create_transport` rather than constructing the Mac helper directly. Four platform/factory tests pass, including the real `JoyInitializer` over the Windows adapter with an explicitly synthetic peer. Windows worker/host admission remains disabled; this integration test uses the worker's already admitted platform with an injected inert adapter, not a Windows-executed connection.

The lazy Winsock binding is now implemented in `runtime/bluetooth/windows_winsock.py`: fixed-width API declarations, pointer-sized SOCKET handles, System32-only DLL loading after explicit approval, nonblocking connect with SO_ERROR/exception readiness, bounded read/write and cancellation-aware cleanup. Parent review found the first delegated version insufficiently tested; 12 additional inert-DLL tests exercised the actual ctypes function calls and reproduced 11 failing cases before correction. Those API regressions now pass alongside the initial four guard/layout tests. EOF, immediate connect failure, invalid socket handles, finite timeout validation, interrupted startup/select, partial send, failed-close quarantine and balanced WSAStartup/WSACleanup are covered. No real Windows DLL was called.

Full repository `npm run check` passed after integration: 952 Vitest tests, 476 Python tests, typecheck, format policy, build, 37 compiled-host modules and nine frozen-runtime inert cases. A subsequent private ABI-probe attribute rename was rechecked with all 16 Winsock tests and `git diff --check`. Source constructors and application/worker native-Windows admission remain unchanged in authority: there is still no automatic Windows connect, pairing, radio access or execution. Staged 2.1.1 tree remains `2c3e79eb44a69fc03f128b2094552c7282fee0bc`; Windows work remains unstaged.

This completes the first software transport slice, not usable Windows-native product support. Paired-device discovery, Windows runtime packaging and actual Windows SDK/socket/authorized-device acceptance remain outstanding.

## Remaining implementation and acceptance

1. **Completed:** source audit of macOS helper, channel/crypto interface, worker admission, host discovery/routing and package build boundaries; findings above. No Windows execution acceptance implied.
2. **Software implementation complete:** lazy-loaded Winsock RFCOMM transport, explicit approval, bounded calls, partial-write accounting, cancellation and cleanup. Inert ABI/call/lifecycle regressions pass. **Still required:** real Windows SDK ABI and socket execution, plus authorized device acceptance; current macOS results do not establish those.
3. Implement paired-device discovery and service selection without automatic pairing/scanning/device actions at app startup.
4. Make native helper/runtime packaging and resource discovery work on Windows; retain legacy backend until explicit native acceptance.
5. Admit Windows only after routing, ownership, independent safety gates and full inert initialization/configuration/loading/job/retirement checks pass. Native transport must reuse existing Joy framing/crypto/protocol rather than altering bytes.
6. Execute a Windows build and then deliberately authorized hardware connection/read acceptance before claiming usable Windows-native support. Real load/Go/cut testing needs separate explicit authorization.

Evidence for this start is in the owned scratch directory `kindcut-211-windows`: `check-211.log`, `windows-endpoint-red.log`, `windows-foundation-runtime-green.log`, `staged-211-tree.txt`. Scratch evidence is disposable; this document records the durable boundary.
