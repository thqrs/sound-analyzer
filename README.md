# Relative Noise Room Analyzer

This is a browser-based sound analyzer for room soundproofing work. It focuses on relative frequency behavior rather than calibrated SPL:

- Capture a reference outside the room or before treatment.
- Compare live input against that reference.
- Inspect octave-band leakage, broadband delta, and a rolling spectrogram.
- Save browser-local snapshots for A/B testing.

## Run

Microphone access is most reliable on `http://localhost`, so serve the folder locally:

```powershell
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

You can also run:

```powershell
python -m http.server 4173
```

## Suggested measurement workflow

1. Play pink noise or a repeating sweep from the source side.
2. Capture a reference at the source side or before treatment.
3. Move to the protected side, or add one treatment change.
4. Watch which octave bands remain closest to the reference.
5. Repeat after each change so you can see which fix actually moved the leak.

## Notes

- Browser microphone values are relative and device-dependent.
- For certified SPL, use a calibrated meter and calibration workflow.
- For soundproofing decisions, the relative deltas and persistent weak bands are usually the important part.
