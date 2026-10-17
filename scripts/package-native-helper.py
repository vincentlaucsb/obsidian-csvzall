"""Package one executable deterministically, or extract an exact single-file package."""
import gzip
import io
from pathlib import Path
import sys
import tarfile
import zipfile

command, archive_arg, executable_arg = sys.argv[1:]
archive, executable = Path(archive_arg), Path(executable_arg)
name = executable.name
if name not in ("csvzall", "csvzall.exe"):
    raise ValueError("Expected a csvzall executable")
if command == "pack":
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100755 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, executable.read_bytes())
    else:
        with archive.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as output:
                entry = tarfile.TarInfo(name)
                entry.size = executable.stat().st_size
                entry.mode = 0o755
                output.addfile(entry, io.BytesIO(executable.read_bytes()))
elif command == "extract":
    # Never use extractall: reject extra files, links, and traversal paths.
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as source:
            if source.namelist() != [name]:
                raise ValueError("Helper ZIP must contain only the executable")
            contents = source.read(name)
    else:
        with tarfile.open(archive, "r:gz") as source:
            entries = source.getmembers()
            if len(entries) != 1 or entries[0].name != name or not entries[0].isfile():
                raise ValueError("Helper tar must contain only the executable")
            contents = source.extractfile(entries[0]).read()
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_bytes(contents)
    executable.chmod(0o755)
else:
    raise ValueError("Expected pack or extract")
