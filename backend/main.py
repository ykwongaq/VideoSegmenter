"""FastAPI backend for the Video Segmenter review tool.

The frontend reads a project ZIP locally (frames + annotation JSON) and uses
this service only to decode pycocotools compressed RLE segmentation masks into
foreground runs that the browser can draw directly as 1px-wide vertical strips.
"""

from typing import List, Union

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pycocotools import mask as mask_utils
from pydantic import BaseModel

app = FastAPI(title="Video Segmenter backend")

# The frontend talks to this service from the Vite dev origin (or a hosted
# origin), so allow cross-origin requests. No credentials are used.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RleMask(BaseModel):
    """A single pycocotools RLE mask: `size` is [height, width]."""

    size: List[int]
    counts: Union[str, List[int]]


class DecodeRequest(BaseModel):
    masks: List[RleMask]


class ForegroundRun(BaseModel):
    x: int
    y: int
    length: int


class DecodedMask(BaseModel):
    height: int
    width: int
    runs: List[ForegroundRun]


class DecodeResponse(BaseModel):
    masks: List[DecodedMask]


def binary_to_runs(binary: np.ndarray) -> List[ForegroundRun]:
    """Turn a decoded binary mask into 1px-wide vertical foreground strips.

    `pycocotools.mask.decode` returns an array of shape (height, width) whose
    rows are the frame's y axis and columns are the x axis. Each column is
    scanned for contiguous foreground pixels, producing one strip per run.
    """
    height, width = binary.shape
    result: List[ForegroundRun] = []
    for x in range(width):
        column = binary[:, x]
        boundaries = np.diff(np.concatenate(([0], column, [0])))
        starts = np.flatnonzero(boundaries == 1)
        ends = np.flatnonzero(boundaries == -1)
        for start, end in zip(starts, ends):
            result.append(ForegroundRun(x=x, y=int(start), length=int(end - start)))
    return result


def decode_mask(mask: RleMask) -> DecodedMask:
    """Decode a pycocotools RLE mask into drawable foreground runs.

    Compressed counts (a base64 string) are decoded directly by
    `pycocotools.mask.decode`; uncompressed counts (a list of run lengths) are
    first normalised with `frPyObjects` into the compressed form.
    """
    height, width = mask.size
    rle = {"size": [height, width], "counts": mask.counts}
    if isinstance(mask.counts, list):
        rle = mask_utils.frPyObjects(rle, height, width)
    binary = mask_utils.decode(rle)
    return DecodedMask(height=height, width=width, runs=binary_to_runs(binary))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/decode/masks", response_model=DecodeResponse)
def decode_masks(request: DecodeRequest) -> DecodeResponse:
    decoded: List[DecodedMask] = []
    for mask in request.masks:
        if len(mask.size) != 2:
            raise HTTPException(
                status_code=422, detail="`size` must be [height, width]"
            )
        decoded.append(decode_mask(mask))
    return DecodeResponse(masks=decoded)
