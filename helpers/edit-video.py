# /// script
# requires-python = ">=3.11"
# dependencies = ["imageio-ffmpeg==0.6.0"]
# ///

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import imageio_ffmpeg


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, label, minimum=0):
    require(type(value) is int and value >= minimum, f"{label} must be an integer >= {minimum}")
    return value


def seconds(value, label):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0,
            f"{label} must be finite, nonnegative seconds")
    return value


def metadata(path):
    reader = imageio_ffmpeg.read_frames(str(path))
    try:
        return next(reader)
    finally:
        reader.close()


def render(manifest_path):
    manifest = json.loads(manifest_path.read_text())
    for field in ("device", "build", "disclosure"):
        require(isinstance(manifest.get(field), str) and manifest[field].strip(), f"Provide {field}")
    output = manifest["output"]
    width = integer(output["width"], "output width", 2)
    height = integer(output["height"], "output height", 2)
    fps = integer(output["fps"], "output fps", 1)
    require(width % 2 == height % 2 == 0, "Output dimensions must be even")
    require(fps <= 60, "Use an output frame rate from 1 to 60")
    destination = (manifest_path.parent / output["path"]).resolve()
    receipt = destination.with_suffix(".edit.json")
    require(destination.suffix.lower() == ".mp4", "Output must be an MP4")
    require(not destination.exists() and not receipt.exists(), "Output or receipt already exists")
    require(destination.parent.is_dir(), "Create the output directory first")
    require(receipt != manifest_path, "Output receipt must differ from the input manifest")
    ffmpeg = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
    os.environ["IMAGEIO_FFMPEG_EXE"] = ffmpeg
    version = subprocess.check_output([ffmpeg, "-version"], text=True).splitlines()[0]

    sources = {}
    require(isinstance(manifest.get("sources"), dict) and manifest["sources"], "Provide raw sources")
    for name, source in manifest["sources"].items():
        path = (manifest_path.parent / source["path"]).resolve()
        require(path.is_file() and path != destination, f"Missing or invalid source: {name}")
        info = metadata(path)
        crop = source["crop"]
        x = integer(crop["x"], f"{name} crop x")
        y = integer(crop["y"], f"{name} crop y")
        crop_width = integer(crop["width"], f"{name} crop width", 2)
        crop_height = integer(crop["height"], f"{name} crop height", 2)
        require(crop_width % 2 == crop_height % 2 == 0, f"{name} crop dimensions must be even")
        source_width, source_height = info["size"]
        require(x + crop_width <= source_width and y + crop_height <= source_height,
                f"{name} crop extends outside the raw video")
        require(info["duration"] > 0, f"{name} must be a completed recording with a duration")
        with path.open("rb") as raw:
            digest = hashlib.file_digest(raw, "sha256").hexdigest()
        sources[name] = {"path": path, "duration": info["duration"], "crop": crop,
                         "sha256": digest, "size": info["size"]}

    segments = manifest.get("segments")
    require(isinstance(segments, list) and segments, "Provide timed segments in output order")
    for index, segment in enumerate(segments):
        require(segment["source"] in sources, f"Unknown source in segment {index + 1}")
        start = seconds(segment["start"], "segment start")
        end = seconds(segment["end"], "segment end")
        require(end > start and end <= sources[segment["source"]]["duration"],
                f"Segment {index + 1} is empty or outside its source duration")
        require(isinstance(segment.get("description"), str) and segment["description"].strip(),
                f"Describe segment {index + 1}")

    rendered = []
    offset = 0.0
    with tempfile.TemporaryDirectory(prefix=".video-edit-", dir=destination.parent) as temporary:
        work = Path(temporary)
        for index, segment in enumerate(segments):
            source = sources[segment["source"]]
            crop = source["crop"]
            clip = work / f"segment-{index:04d}.mp4"
            filters = (
                f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}:exact=1,"
                f"setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=decrease:"
                f"force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                f"fps={fps},setsar=1"
            )
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
                "-ss", str(segment["start"]), "-i", str(source["path"]),
                "-t", str(segment["end"] - segment["start"]), "-map", "0:v:0",
                "-vf", filters, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-pix_fmt", "yuv420p", "-threads", "2", "-video_track_timescale", "90000", str(clip),
            ], check=True)
            duration = metadata(clip)["duration"]
            rendered.append({**segment, "outputStart": offset, "outputDuration": duration})
            offset += duration
        playlist = work / "segments.txt"
        playlist.write_text("".join(f"file 'segment-{index:04d}.mp4'\n" for index in range(len(segments))))
        final = work / "render.mp4"
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
            "-f", "concat", "-safe", "1", "-i", str(playlist),
            "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", str(final),
        ], check=True)
        final_info = metadata(final)
        require(final_info["size"] == (width, height), "Rendered dimensions differ from the manifest")
        require(abs(final_info["fps"] - fps) < 0.1, "Rendered frame rate differs from the manifest")
        with final.open("rb") as video:
            output_digest = hashlib.file_digest(video, "sha256").hexdigest()
        record = {
            "manifest": manifest,
            "encoder": version,
            "playbackSpeed": 1,
            "sources": {name: {"sha256": source["sha256"], "size": source["size"],
                               "duration": source["duration"]} for name, source in sources.items()},
            "segments": rendered,
            "durationSeconds": final_info["duration"],
            "outputSha256": output_digest,
        }
        # A hard link publishes the finished file atomically and refuses an existing destination.
        os.link(final, destination)
        with receipt.open("x") as saved:
            json.dump(record, saved, indent=2)
            saved.write("\n")
    print(f"Saved {destination} ({final_info['duration']:.2f}s) and {receipt.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cut real recordings using an explicit edit manifest.")
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    try:
        render(args.manifest.resolve())
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Edit failed: {error}\n")
