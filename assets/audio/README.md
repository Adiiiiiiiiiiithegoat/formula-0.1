# Background music

The game looks for `assets/audio/music.mp3` and loops it quietly under the engine
in the menus and during races.

No track is committed here: the one used during development had no licensing
metadata, so it is not redistributed. Drop in any `.mp3` you have the right to
use and name it `music.mp3`.

If the file is missing the game runs normally — `audio.js` swallows the failed
`play()` and you simply get the procedural engine with no music.
