---
name: recording
description: Capture a physical app walkthrough through iPhone Mirroring and edit real recordings for App Review, removing agent idle time while preserving the app's behavior and readable transitions.
---

# App Review recordings

Use real recordings of the requested device and build. Keep the original captures, the timed edit manifest, and the
render receipt beside the final video in an ignored release directory. Record the physical device, installed build,
and edits in the handoff. Simulator footage must be identified as simulator footage.

Use the task’s existing authorization for demo accounts, friend actions, deletion, and submission. Operate only the
accounts and device within that scope. Keep credentials and unrelated private content out of footage and manifests.

## Reuse

When the user asks to reuse a recording, compare its demonstrated flows with the submitted build before capturing
again. Retain suitable footage and attachments. Review Notes must identify the actual recorded build, device, OS,
and editing disclosure, and explain changes the footage does not show. Reusing footage does not establish a physical
test of the new build; a simulator launch check does not fill that gap.

## Capture

The versioned `swift-factory record capture` helper requires macOS 15 or later, Xcode command-line tools, screen-recording
permission, and exactly one visible iPhone Mirroring window. It captures that window without audio, microphone, cursor,
or window shadow. Keep its size and orientation stable throughout a take.

From the repository root, choose unused output and stop-file names:

```sh
mkdir -p .local/review-recording
pnpm exec swift-factory record capture .local/review-recording/take-01.mp4 \
  .local/review-recording/take-01.stop 600
```

After the helper prints `Recording started`, perform the walkthrough. In another terminal, finish it with:

```sh
touch .local/review-recording/take-01.stop
```

Wait for `Recording saved` before editing. The optional duration defaults to 1,200 seconds and accepts 1–1,200 seconds;
the recording also stops when its stop file appears. It refuses existing outputs and stop files. A failed capture
retains its staging directory for inspection. Stop through the file so the MP4 can finish writing.

Keep a timestamped action journal relative to the helper's start time. It makes idle intervals easier to locate,
but inspect the recording before choosing cuts. Different tool runtimes can have different clocks; align journal
entries to visible actions in the recorded file rather than assuming their wall-clock timestamps match.
With iPhone Mirroring, focus a field, inspect its state, then type.
Avoid clipboard-based paste helpers that immediately restore the previous clipboard: the remote phone can process
the paste after restoration and insert stale contents. Verify entries before submitting. Discard a take containing
unrelated credentials or private content, even when no form was submitted, and start a clean capture.

## Edit

Watch the raw footage and select explicit source intervals. Remove agent deliberation, long stationary pauses between
actions, and typing corrections that add no useful behavior. Keep the tap or other action, its actual animation and
loading, and enough of the resulting screen to read it. A stationary frame can be a meaningful loading state or a
reading hold; do not automatically remove it as idle time.

Retained footage plays at real speed. Do not accelerate it, manufacture screens, replace loading with a completed state,
or splice an action to an unrelated result. Preserve meaningful failures or record a new honest take. Disclose cuts
and separate sessions; an edited walkthrough does not establish uninterrupted runtime or performance.

Measure the crop from the actual raw recording. Crop window chrome consistently while retaining the complete phone
screen and relevant system UI. The editor preserves aspect ratio and pads when source crops differ. Inspect every cut
and hold in the final video; cropping and successful encoding do not establish a useful walkthrough.

Create a JSON manifest beside the captures. All paths resolve from that manifest's directory. For example:

```json
{
  "device": "Physical iPhone, model and iOS version",
  "build": "Example 1.0 (build number)",
  "disclosure": "Real device recordings. Agent idle pauses and typing corrections removed; retained footage plays at real speed.",
  "output": { "path": "review.mp4", "width": 664, "height": 1440, "fps": 30 },
  "sources": {
    "main": { "path": "take-01.mp4", "crop": { "x": 16, "y": 76, "width": 664, "height": 1440 } }
  },
  "segments": [
    {
      "source": "main",
      "start": 4.0,
      "end": 10.5,
      "description": "Launch and readable welcome screen"
    },
    {
      "source": "main",
      "start": 28.0,
      "end": 36.0,
      "description": "Complete an action and show its result"
    }
  ]
}
```

Replace the illustrative crop and times with inspected values. Each source needs its own crop; segments appear in
output order and use seconds from the beginning of that raw file. Widths and heights must be even positive integers.

```sh
pnpm exec swift-factory record edit .local/review-recording/edit.json
```

The packaged editor uses `ffmpeg` from PATH when present; its pinned `imageio-ffmpeg` dependency supplies
the fallback binary. It validates intervals and crop bounds, renders each segment at the requested size and frame rate,
then concatenates H.264/yuv420p MP4 with fast-start metadata and no audio. It never overwrites existing outputs, receipts,
or raw files. The generated `review.edit.json` records source hashes, segment timings, actual durations, device/build,
disclosure, and encoder version. The supplied manifest is preserved unchanged.

Watch the final video, especially cut boundaries, first and last frames, text, transitions, and any loading. Confirm
that no private content remains. Share the real-device/build details and editing disclosure with the video; preserve
raw footage and manifests privately. Upload or submit only within the user's authorized release workflow.
