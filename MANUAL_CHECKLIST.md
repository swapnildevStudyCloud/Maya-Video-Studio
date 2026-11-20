# Manual QA Checklist — Maya Video Studio (Phase 1)

Use this checklist in desktop Chrome, Edge, and Firefox to verify browser behaviors that unit tests cannot cover.

## 1. File Opening & Validation
- [ ] Verify `"Your video stays on your device."` appears clearly near the file picker and in the source panel.
- [ ] Open browser DevTools Network tab, then open a video and run an export. Confirm **zero** network requests leave the device with video bytes or user filenames (only local static `/ffmpeg/ffmpeg-core.js` and `/ffmpeg/ffmpeg-core.wasm` load on first export).
- [ ] Drag and drop a real `.mp4` and a real `.mov` file; confirm both load and display metadata + video preview.
- [ ] Rename a PNG or text file to `fake.mp4` and try opening it; confirm it is rejected with a clear message about missing `ftyp` header.
- [ ] Try opening a file larger than 200 MB; confirm it is rejected immediately before loading metadata.
- [ ] Try opening a video longer than 10 minutes; confirm it is rejected with a clear duration limit message.

## 2. Timeline & Trim Controls
- [ ] Open a real 30-second MP4 video.
- [ ] Drag the In and Out timeline handles to trim from `5.00` s to `15.00` s (10-second clip) and confirm numeric inputs update in sync.
- [ ] Play the video and click **Set In** and **Set Out** at current playhead positions; confirm handles and inputs update cleanly.
- [ ] Type invalid values into Start/End (empty, negative, `start >= end`, `> duration`, or `< 0.5 s` length); confirm **Export MP4** is disabled and the exact reason is shown.

## 3. Export (Fast & Precise) & Memory Cleanup
- [ ] Confirm `ffmpeg-core.js` and `ffmpeg-core.wasm` are **not** fetched when opening the app or loading a file—only when clicking **Export MP4** for the first time.
- [ ] Trim the 30-second MP4 to 10 seconds in **Fast** mode:
  - [ ] Confirm progress bar advances and completes without errors.
  - [ ] Confirm result preview plays in the sidebar.
  - [ ] Click **Download MP4**, verify filename ends with `-trimmed.mp4`, open in a local media player (VLC/QuickTime/Chrome), and confirm it plays cleanly and is ~10 seconds (nearest keyframe).
- [ ] Trim the same 30-second MP4 to 10 seconds in **Precise** mode:
  - [ ] Confirm progress bar advances smoothly from 0% to 100%.
  - [ ] Download and verify the exported MP4 is frame-accurate and exactly 10.0 seconds long with synced audio.
- [ ] Start a Precise export and click **Cancel Export** mid-way:
  - [ ] Confirm the UI immediately unlocks without an error alert.
  - [ ] Start another export right after cancelling to confirm the worker reloads cleanly.
- [ ] On a narrow/mobile viewport (`< 768px`), confirm the warning note about large files on mobile browsers is visible.
