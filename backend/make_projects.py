import argparse
import os
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed

# Compression name -> (zipfile constant, compresslevel).
# For ZIP_STORED and ZIP_LZMA the compresslevel is ignored by zipfile.
COMPRESSION_OPTIONS = {
    "stored": (zipfile.ZIP_STORED, None),
    "deflated": (zipfile.ZIP_DEFLATED, 9),
    "bzip2": (zipfile.ZIP_BZIP2, 9),
    "lzma": (zipfile.ZIP_LZMA, None),
}


def create_clip_zip(task):
    """Build a single project zip containing the clip's frames and annotation.

    Layout inside each zip:
        frames/<image files>
        annotations/<clip_name>.json   (only if an annotation exists)

    Returns (clip_name, has_annotation, error_message_or_None).
    """
    frame_dir, annotation_file, output_zip, compression_name = task
    compression, compresslevel = COMPRESSION_OPTIONS[compression_name]

    frames = []
    for name in sorted(os.listdir(frame_dir)):
        path = os.path.join(frame_dir, name)
        if os.path.isfile(path):
            frames.append((path, os.path.join("frames", name)))

    has_annotation = annotation_file is not None and os.path.isfile(annotation_file)

    try:
        with zipfile.ZipFile(
            output_zip,
            "w",
            compression=compression,
            compresslevel=compresslevel,
            allowZip64=True,
        ) as zf:
            for path, arcname in frames:
                zf.write(
                    path,
                    arcname=arcname,
                    compress_type=compression,
                    compresslevel=compresslevel,
                )
            if has_annotation:
                zf.write(
                    annotation_file,
                    arcname=os.path.join(
                        "annotations", os.path.basename(annotation_file)
                    ),
                    compress_type=compression,
                    compresslevel=compresslevel,
                )
    except Exception as exc:  # noqa: BLE001 - report any failure back to the caller
        return os.path.basename(frame_dir), has_annotation, str(exc)

    return os.path.basename(frame_dir), has_annotation, None


def main(args):
    frame_dataset = args.frame_dataset
    annotation_dataset = args.annotation_dataset
    output_dataset = args.output_dataset
    compression = args.compression

    os.makedirs(output_dataset, exist_ok=True)

    frame_dirs = sorted(
        os.path.join(frame_dataset, name)
        for name in os.listdir(frame_dataset)
        if os.path.isdir(os.path.join(frame_dataset, name))
    )

    tasks = []
    skipped = 0
    for frame_dir in frame_dirs:
        name = os.path.basename(frame_dir)
        annotation_file = os.path.join(annotation_dataset, name + ".json")
        if not os.path.isfile(annotation_file):
            annotation_file = None

        output_zip = os.path.join(output_dataset, name + ".zip")
        if os.path.exists(output_zip):
            skipped += 1
            continue

        tasks.append((frame_dir, annotation_file, output_zip, compression))

    if not tasks:
        print(
            f"Nothing to do: {len(frame_dirs)} clip folders found, {skipped} already zipped."
        )
        return

    workers = (
        args.workers if args.workers and args.workers > 0 else (os.cpu_count() or 1)
    )
    total = len(tasks)
    print(f"Found {len(frame_dirs)} clip folders ({skipped} already zipped).")
    print(
        f"Zipping {total} clips with compression={compression} using {workers} worker(s) ..."
    )

    done = 0
    missing_annotations = 0
    errors = 0

    def report(name, has_annotation, error):
        nonlocal done, missing_annotations, errors
        done += 1
        if error is not None:
            errors += 1
            print(f"  ERROR {name}: {error}")
        elif not has_annotation:
            missing_annotations += 1
        if done % 100 == 0 or done == total:
            print(f"  Progress: {done}/{total} clips zipped")

    if workers <= 1:
        for task in tasks:
            name, has_annotation, error = create_clip_zip(task)
            report(name, has_annotation, error)
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(create_clip_zip, task) for task in tasks]
            for future in as_completed(futures):
                name, has_annotation, error = future.result()
                report(name, has_annotation, error)

    print(
        f"Done. {total} zips written to {output_dataset} "
        f"({errors} errors, {missing_annotations} clips without an annotation)."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Bundle each clip's frames (and its annotation, if present) "
        "into a single compressed zip file."
    )
    parser.add_argument(
        "--frame_dataset", type=str, default="/home/davidwong/Downloads/frames"
    )
    parser.add_argument(
        "--annotation_dataset",
        type=str,
        default="/home/davidwong/Downloads/annotations",
    )
    parser.add_argument(
        "--output_dataset",
        type=str,
        default="/home/davidwong/Downloads/output_projects",
    )
    parser.add_argument(
        "--compression",
        type=str,
        choices=sorted(COMPRESSION_OPTIONS),
        default="deflated",
        help="Compression method. Defaults to 'deflated' because the web reviewer can "
        "only read STORED (0) and DEFLATE (8) entries. 'lzma' produces smaller files "
        "but the reviewer cannot open them (Unsupported compression method 14); "
        "'bzip2' is likewise unsupported. 'deflated' (level 9) is the recommended "
        "balance of size vs. speed.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help="Number of parallel processes to use (default: number of CPUs).",
    )

    args = parser.parse_args()
    main(args)
