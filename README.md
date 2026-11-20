<p align="center"><img src="screenshots/banner.png" alt="Mendout" width="100%"></p>

<p align="center"><b>Repair damaged media</b><br>Version 1.0.1 for Windows · Free · Offline · No account</p>

<p align="center"><a href="https://github.com/plawanpawin-byte/mendout/releases/latest"><b>Download Mendout</b></a> · <a href="https://github.com/plawanpawin-byte/Lookout">All Lookout apps</a></p>

---

Mendout checks a video or audio file for problems and repairs it into a new file. It explains what it found in plain language and offers fixes that match the damage. Your original file is never touched.

**Made for:** A recording that stopped early, a file that will not seek or play, or audio that drifts away from the picture.

![Mendout](screenshots/01-file-opened.png)

## See it in action

### Opening a file

![Opening a file](screenshots/01-file-opened.png)

Choose a damaged file and Mendout shows its name and size.

### The check report

![The check report](screenshots/02-check-report-truncated.png)

Mendout reads the whole file and lists what is fine and what is wrong. Here the recording was cut short.

### Repair done

![Repair done](screenshots/03-repaired.png)

A repaired copy was saved, with a button to show it in its folder.

### A file that cannot be recovered

![A file that cannot be recovered](screenshots/04-check-report-corrupt.png)

When the header is unreadable the repair buttons stay off instead of pretending.

### A healthy file

![A healthy file](screenshots/05-check-report-healthy.png)

A clean report means nothing needs fixing.

### Output

![Output](screenshots/06-repaired-video-frame.png)

A frame from the repaired video.

## Everything it can do

### Check

- Reads the header, video and audio streams
- Decodes the whole file to find hidden errors
- Detects a missing length and files cut short

### Repair

- Rebuild the container without re-encoding
- Re-encode and skip bad parts
- Fix audio out of sync
- Save the audio only
- Recover the video picture only

### Safe

- Always writes a new file
- The original is only read

## How to use it

1. Click **Open file**.
2. Click **Check file** to see the report.
3. Choose a repair and click **Repair to new file**.
4. Click **Show in folder** to find the result.

## Files and formats

Common video and audio files such as MP4, MOV, MKV, AVI, WebM, MP3 and WAV.

## Private by design

- No account, no sign-in, no subscription, no ads.
- Mendout works offline. It never uses the network.
- Files are opened and saved only through the Windows file dialogs you use. Mendout cannot browse your disk on its own.
- The app window runs in a locked-down sandbox with a strict content policy.

## Install

1. Open the [latest release](https://github.com/plawanpawin-byte/mendout/releases/latest) and download the file named **Mendout-Setup-** followed by the version number and **.exe**. You can also install it from the [Lookout launcher](https://github.com/${OWNER}/lookout-launcher), which keeps it up to date.
2. Run the installer. It installs just for you, so it does not ask for administrator rights.
3. Windows may show a blue **Windows protected your PC** screen because these installers are not signed with a paid certificate. Click **More info**, then **Run anyway**.
4. Open Mendout from the Start menu.

**Requirements:** Windows 10 or 11, 64-bit. About 500 MB of free disk space. No internet connection is needed to use the app.

## Questions

**Can everything be fixed?**  
No. If the beginning of a file is destroyed there may be nothing to rebuild. Mendout tells you instead of pretending.

## About Lookout

Mendout belongs to the **[Lookout](https://github.com/plawanpawin-byte/Lookout)** family: ten small, private Windows apps for documents and media, all with the same calm grey look and the same promise that your files stay yours. Install and update them together with the [Lookout launcher](https://github.com/plawanpawin-byte/lookout-launcher).

Released under the MIT License.
