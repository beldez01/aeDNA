# Face-API.js Models

This directory needs face-api.js model files for the **Genome Recombiner** to work.

## Required Files:

Download these files from the [face-api.js models repository](https://github.com/justadudewhohacks/face-api.js-models):

### Tiny Face Detector:
- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1.bin`

### Face Landmark 68 Tiny:
- `face_landmark_68_tiny_model-weights_manifest.json`
- `face_landmark_68_tiny_model-shard1.bin`

## How to Get Models:

1. Visit: https://github.com/justadudewhohacks/face-api.js-models
2. Download the files from:
   - `/tiny_face_detector/`
   - `/face_landmark_68_tiny/`
3. Place them directly in this `/public/models/` directory

## File Structure:
```
public/
  models/
    tiny_face_detector_model-weights_manifest.json
    tiny_face_detector_model-shard1.bin
    face_landmark_68_tiny_model-weights_manifest.json
    face_landmark_68_tiny_model-shard1.bin
```

Once these files are in place, the Genome Recombiner will work!

