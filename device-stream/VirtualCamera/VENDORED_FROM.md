# VirtualCamera — vendored

## Upstream chain

- Original: [tddworks/asc-pro] `SimCam/` — Apache-2.0
- First vendor: [tddworks/baguette] `VirtualCamera/` — preserved `SimCam*` symbol prefix for clean re-sync
- Current vendor: this directory — re-vendored from baguette at commit fb7cc51

## What it is

An iOS-Simulator dylib loaded via `DYLD_INSERT_LIBRARIES` that swizzles `AVCapture*` and `UIImagePickerController` so iOS apps inside the simulator read frames from a shared-memory ring buffer at `/tmp/SimCam.bgra` instead of real camera hardware.

## How to rebuild

```bash
cd device-stream/VirtualCamera
./build.sh
```

Produces `VirtualCamera.dylib` (universal arm64+x86_64, ad-hoc signed by the linker — DO NOT re-sign with `codesign --force --sign -`; iOS 26+ simulator rejects post-build signatures).

## Not in git

`VirtualCamera.dylib` is gitignored. Consumers should run `build.sh` after checkout.
